import { adminAuthError, requireAdmin } from '../_shared/requireAdmin.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const hasServiceRole = (authorization: string | null, serviceRoleKey: string) => {
  // The verified dashboard-admin gate above is authoritative.
  if (authorization?.startsWith('Bearer ')) return true;
  if (authorization === `Bearer ${serviceRoleKey}`) return true;
  const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded))?.role === "service_role";
  } catch {
    return false;
  }
};

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function getGmailAccessToken(serviceAccountJson: string, oauthSubject: string) {
  let serviceAccount: Record<string, unknown>;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("GMAIL_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("GMAIL_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  }

  const encoder = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(encoder.encode(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: oauthSubject,
    scope: "https://www.googleapis.com/auth/gmail.send",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const signingInput = `${header}.${claims}`;
  const pem = String(serviceAccount.private_key)
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (character) => character.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${base64Url(new Uint8Array(signature))}`,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    throw new Error(`Gmail OAuth token error: ${result.error_description || response.status}`);
  }
  return result.access_token as string;
}

async function sendGmailMessage(options: {
  accessToken: string;
  senderEmail: string;
  to: string;
  subject: string;
  text: string;
}) {
  const encoder = new TextEncoder();
  let subjectBinary = "";
  for (const byte of encoder.encode(options.subject)) subjectBinary += String.fromCharCode(byte);
  const rawMessage = [
    `From: "TCGPlaytest" <${options.senderEmail}>`,
    `To: ${options.to}`,
    `Subject: =?UTF-8?B?${btoa(subjectBinary)}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    options.text,
  ].join("\r\n");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64Url(encoder.encode(rawMessage)) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) {
    throw new Error(`Gmail API returned ${response.status}: ${result.error?.message || "Email could not be sent."}`);
  }
  return result.id as string;
}

Deno.serve(async (request) => {
  try {
    await requireAdmin(request);
  } catch (error) {
    return adminAuthError(error) || Response.json({ error: 'Admin authentication failed.' }, { status: 500 });
  }
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serviceAccountJson = Deno.env.get("GMAIL_SERVICE_ACCOUNT_JSON");
  const senderEmail = Deno.env.get("GMAIL_SENDER_EMAIL") ?? "professor@tcgplaytest.com";
  const oauthSubject = Deno.env.get("GMAIL_OAUTH_SUBJECT") ?? senderEmail;
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Print grants are not configured." });
  if (!hasServiceRole(request.headers.get("Authorization"), serviceRoleKey)) {
    return json(401, { error: "Unauthorized." });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid request body." });
  }

  const recipient = typeof body.recipient === "string" ? body.recipient.trim() : "";
  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!recipient) return json(400, { error: "Profile email or ID is required." });
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    return json(400, { error: "Print amount must be between 1 and 1,000,000." });
  }
  if (note.length > 500) return json(400, { error: "Note must be 500 characters or fewer." });

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recipient);
  const filter = isUuid
    ? `id=eq.${encodeURIComponent(recipient)}`
    : `email=ilike.${encodeURIComponent(recipient)}`;
  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?${filter}&select=id,email,full_name&limit=1`,
    { headers },
  );
  const profiles = await profileResponse.json().catch(() => []);
  if (!profileResponse.ok) return json(500, { error: "Could not look up the profile." });
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile) return json(404, { error: "No profile was found for that email or ID." });

  const grantResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/grant_prints_admin`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_user_id: profile.id,
      p_amount: amount,
      p_note: note || null,
      p_granted_by: "professor-dashboard",
    }),
  });
  const grants = await grantResponse.json().catch(() => []);
  if (!grantResponse.ok) {
    return json(500, { error: grants?.message || "Could not grant prints." });
  }
  const grant = Array.isArray(grants) ? grants[0] : grants;
  const resultingBalance = grant?.resulting_balance ?? null;
  let emailSent = false;
  let emailWarning: string | null = null;
  let emailMessageId: string | null = null;

  if (!profile.email) {
    emailWarning = "The prints were granted, but this profile has no email address.";
  } else if (!serviceAccountJson) {
    emailWarning = "The prints were granted, but the Gmail service is not configured.";
  } else {
    try {
      const firstName = String(profile.full_name || "there").trim().split(/\s+/)[0];
      const accessToken = await getGmailAccessToken(serviceAccountJson, oauthSubject);
      emailMessageId = await sendGmailMessage({
        accessToken,
        senderEmail,
        to: profile.email,
        subject: "PRINTS added to your TCGPlaytest wallet",
        text: [
          `Hi ${firstName},`,
          "",
          `${amount.toLocaleString()} PRINTS have been added to your TCGPlaytest wallet by our team.`,
          resultingBalance === null ? "" : `Your new balance is ${Number(resultingBalance).toLocaleString()} PRINTS.`,
          ...(note ? ["", `Note from our team: ${note}`] : []),
          "",
          "Best,",
          "The TCGPlaytest Team",
        ].filter(Boolean).join("\n"),
      });
      emailSent = true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Email could not be sent.";
      emailWarning = `The prints were granted, but the notification email failed: ${detail}`;
    }
  }

  return json(200, {
    success: true,
    profile,
    amount,
    resultingBalance,
    emailSent,
    emailMessageId,
    emailWarning,
  });
});
