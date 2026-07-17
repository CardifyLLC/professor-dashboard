/**
 * send-bulk-email — sends an email to a list of recipients
 * Uses the same Gmail service account as reject-order
 *
 * POST body: { emails: string[], subject: string, body: string }
 */

import { adminAuthError, requireAdmin } from '../_shared/requireAdmin.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function createJWT(clientEmail: string, privateKeyPem: string, subject: string): Promise<string> {
  const headerB64 = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const now = Math.floor(Date.now() / 1000);
  const payloadB64 = btoa(JSON.stringify({
    iss: clientEmail,
    sub: subject,
    scope: "https://www.googleapis.com/auth/gmail.send",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const signingInput = `${headerB64}.${payloadB64}`;
  const pemContents = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const keyData = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  return `${signingInput}.${sigB64}`;
}

async function getAccessToken(clientEmail: string, privateKey: string, subject: string): Promise<string> {
  const jwt = await createJWT(clientEmail, privateKey, subject);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OAuth token error: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

async function sendEmail(accessToken: string, senderEmail: string, toEmail: string, subject: string, body: string) {
  const emailRaw = [
    `From: "TCGPlaytest" <${senderEmail}>`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join("\r\n");

  const raw = btoa(String.fromCharCode(...new TextEncoder().encode(emailRaw)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Gmail API error: ${JSON.stringify(err)}`);
  }
}

Deno.serve(async (req) => {
  try {
    await requireAdmin(req);
  } catch (error) {
    return adminAuthError(error) || Response.json({ error: 'Admin authentication failed.' }, { status: 500 });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  const serviceAccountJson = Deno.env.get("GMAIL_SERVICE_ACCOUNT_JSON");
  const senderEmail = Deno.env.get("GMAIL_SENDER_EMAIL") ?? "professor@tcgplaytest.com";
  const oauthSubject = Deno.env.get("GMAIL_OAUTH_SUBJECT") ?? "shuffle@cardify.club";

  if (!serviceAccountJson) return json(500, { error: "Missing GMAIL_SERVICE_ACCOUNT_JSON secret." });

  let body: { emails?: unknown; subject?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const emails = Array.isArray(body.emails) ? body.emails.filter((e): e is string => typeof e === "string" && e.includes("@")) : [];
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const emailBody = typeof body.body === "string" ? body.body.trim() : "";

  if (!emails.length) return json(400, { error: "No valid emails provided." });
  if (!subject) return json(400, { error: "Subject is required." });
  if (!emailBody) return json(400, { error: "Body is required." });

  const sa = JSON.parse(serviceAccountJson);
  const accessToken = await getAccessToken(sa.client_email, sa.private_key, oauthSubject);

  let sent = 0;
  let failed = 0;

  for (const email of emails) {
    try {
      await sendEmail(accessToken, senderEmail, email, subject, emailBody);
      sent++;
    } catch {
      failed++;
    }
  }

  return json(200, { success: true, sent, failed, total: emails.length });
});
