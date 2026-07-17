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
    const payload = JSON.parse(atob(padded));
    return payload?.role === "service_role";
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
    throw new Error(
      "GMAIL_SERVICE_ACCOUNT_JSON is not valid JSON. Save the complete downloaded Google service-account JSON object as the secret value.",
    );
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
  const affiliateStoreUrl = Deno.env.get("AFFILIATE_STORE_URL") ?? "https://testing123-prof.vercel.app";
  if (!supabaseUrl || !serviceRoleKey || !serviceAccountJson) {
    return json(500, { error: "The affiliate review email service is not configured." });
  }
  if (!hasServiceRole(request.headers.get("Authorization"), serviceRoleKey)) {
    return json(401, { error: "Unauthorized." });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid request body." });
  }

  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const action = body.action === "approved" || body.action === "rejected" ? body.action : "";
  const approvalType = body.approvalType === "link" ? "link" : "code";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const requestedDecisionCode = typeof body.affiliateCode === "string" ? body.affiliateCode.trim().toUpperCase() : "";
  if (!requestId || !action || !message) {
    return json(400, { error: "Request, action, and profile message are required." });
  }
  if (message.length > 2000) {
    return json(400, { error: "The profile message must be 2,000 characters or fewer." });
  }
  if (action === "approved" && requestedDecisionCode && !/^[A-Z0-9_-]{3,32}$/.test(requestedDecisionCode)) {
    return json(400, { error: "Affiliate codes must use 3–32 letters, numbers, hyphens, or underscores." });
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const loadResponse = await fetch(
    `${supabaseUrl}/rest/v1/affiliate_applications?id=eq.${encodeURIComponent(requestId)}&select=*`,
    { headers },
  );
  const rows = await loadResponse.json().catch(() => []);
  if (!loadResponse.ok) return json(500, { error: "Could not load the affiliate application." });

  const application = Array.isArray(rows) ? rows[0] : null;
  if (!application) return json(404, { error: "Affiliate application not found." });
  if (application.status !== "pending") {
    return json(409, { error: "This application has already been reviewed." });
  }
  if (typeof application.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.email)) {
    return json(400, { error: "This application does not have a valid email address." });
  }

  const startedAt = new Date().toISOString();
  const affiliateToken = action === "approved"
    ? requestedDecisionCode || String(application.requested_affiliate_code || "").trim().toUpperCase() || crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()
    : null;
  const affiliateCode = affiliateToken;
  const affiliateLink = affiliateToken && approvalType === "link"
    ? `${affiliateStoreUrl.replace(/\/+$/, "")}/r/${encodeURIComponent(affiliateToken)}`
    : null;
  if (affiliateToken) {
    const encodedCode = encodeURIComponent(affiliateToken);
    const encodedRequestId = encodeURIComponent(requestId);
    const [assignedResponse, reservedResponse] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/affiliate_applications?affiliate_code=ilike.${encodedCode}&id=neq.${encodedRequestId}&select=id&limit=1`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/affiliate_applications?requested_affiliate_code=ilike.${encodedCode}&status=in.(pending,reviewing,approved)&id=neq.${encodedRequestId}&select=id&limit=1`, { headers }),
    ]);
    const [assignedRows, reservedRows] = await Promise.all([
      assignedResponse.json().catch(() => []),
      reservedResponse.json().catch(() => []),
    ]);
    if (!assignedResponse.ok || !reservedResponse.ok) {
      return json(500, { error: "Could not verify affiliate code availability." });
    }
    if ((Array.isArray(assignedRows) && assignedRows.length > 0) || (Array.isArray(reservedRows) && reservedRows.length > 0)) {
      return json(409, { error: "That affiliate code is already taken or reserved by another application." });
    }
  }
  const claimResponse = await fetch(
    `${supabaseUrl}/rest/v1/affiliate_applications?id=eq.${encodeURIComponent(requestId)}&status=eq.pending`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        status: "reviewing",
        decision_email_status: "sending",
        decision_email_error: null,
        updated_at: startedAt,
      }),
    },
  );
  const claimedRows = await claimResponse.json().catch(() => []);
  if (!claimResponse.ok) return json(500, { error: "Could not begin reviewing the application." });
  if (!Array.isArray(claimedRows) || !claimedRows[0]) {
    return json(409, { error: "This application is already being reviewed. Refresh the page." });
  }

  const subject = action === "approved"
    ? "Welcome to the TCGPlaytest Affiliate Program"
    : "Your TCGPlaytest Affiliate Program application";
  const emailText = [
    `Hi ${String(application.name || "there").trim().split(/\s+/)[0]},`,
    "",
    message,
    ...(affiliateLink
      ? ["", "Your affiliate link:", affiliateLink]
      : affiliateCode ? ["", "Your affiliate code:", affiliateCode] : []),
    "",
    "Best,",
    "The TCGPlaytest Team",
  ].join("\n");

  let gmailMessageId: string;
  try {
    const accessToken = await getGmailAccessToken(serviceAccountJson, oauthSubject);
    gmailMessageId = await sendGmailMessage({
      accessToken,
      senderEmail,
      to: application.email,
      subject,
      text: emailText,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Email could not be sent.";
    await fetch(
      `${supabaseUrl}/rest/v1/affiliate_applications?id=eq.${encodeURIComponent(requestId)}&status=eq.reviewing`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "pending",
          decision_email_status: "failed",
          decision_email_error: errorMessage.slice(0, 1000),
          updated_at: new Date().toISOString(),
        }),
      },
    );
    return json(500, { error: errorMessage });
  }

  const reviewedAt = new Date().toISOString();
  const updateResponse = await fetch(
    `${supabaseUrl}/rest/v1/affiliate_applications?id=eq.${encodeURIComponent(requestId)}&status=eq.reviewing`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        status: action === "rejected" ? "declined" : "approved",
        decision_message: message,
        decision_email_status: "sent",
        decision_email_sent_at: reviewedAt,
        decision_email_message_id: gmailMessageId,
        decision_email_error: null,
        reviewed_at: reviewedAt,
        updated_at: reviewedAt,
        ...(affiliateCode ? { affiliate_code: affiliateCode, affiliate_link: affiliateLink } : {}),
      }),
    },
  );
  const updatedRows = await updateResponse.json().catch(() => []);
  if (!updateResponse.ok || !Array.isArray(updatedRows) || !updatedRows[0]) {
    return json(500, {
      error: "The email was sent, but the application status could not be finalized. Refresh before trying again.",
    });
  }

  return json(200, { success: true, request: updatedRows[0] });
});
