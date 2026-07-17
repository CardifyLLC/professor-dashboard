// Email via Gmail API (service account + domain-wide delegation)
// Replaces nodemailer/SMTP — set GMAIL_SERVICE_ACCOUNT_JSON and GMAIL_SENDER_EMAIL in Supabase secrets

import { adminAuthError, requireAdmin } from '../_shared/requireAdmin.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

// ── Email templates ───────────────────────────────────────────────────────────
const EMAIL_TEMPLATES: Record<string, { subject: string; text: (name: string) => string }> = {
  bleed_settings: {
    subject: "Action needed: fix bleed settings and reorder",
    text: (name) =>
      `Hello${name ? " " + name : ""},\n\nThank you for your order. While reviewing your files, I noticed that the bleed settings need to be corrected before printing.\n\nTo make the process easier, I created a short video tutorial here:\nhttps://www.awesomescreenshot.com/video/50129474?key=0ebf39125c2de4e33f11d8f9c7508e9d\n\nI will go ahead and refund your order for now. Please place the order again once the bleed settings have been corrected.\n\nRegards,\nTyler`,
  },
  official_backs: {
    subject: "Order rejected: official backs not allowed",
    text: (name) =>
      `Hello${name ? " " + name : ""},\n\nI had to reject and refund your order because it included official backs. Please place the order again using an unofficial back.\n\nRegards,\nTyler`,
  },
  payment_issue: {
    subject: "Question about your recent order",
    text: (name) =>
      `Hello${name ? " " + name : ""},\n\nIt looks like the payment associated with your order did not fully process.\n\nI just wanted to check whether you ran into an issue during checkout and make sure there was not an error on our end. Please let us know if you have any questions.\n\nRegards,\nTyler`,
  },
  corner_defects: {
    subject: "Action needed: corner defects found — please reorder",
    text: (name) =>
      `Hello${name ? " " + name : ""},\n\nWhile preparing your order for print, I noticed several defects in the corners of your cards. After adding bleed, each card should be visually reviewed, and the "corner trim" slider should be adjusted as needed to minimize corner defects.\n\nI created a tutorial outlining the process here:\nhttps://www.tcgplaytest.com/tutorial.mp4\n\nI will go ahead and refund your order for now. Please place the order again once the files have been corrected and you are comfortable with the process.\n\nRegards,\nTyler`,
  },
};

const json = (status: number, body: JsonRecord) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const parseJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const parseMaybeJson = (value: unknown): JsonRecord => {
  if (!value) return {};
  if (typeof value === "object") return value as JsonRecord;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as JsonRecord) : {};
  } catch {
    return {};
  }
};

// ── Gmail API via service account ─────────────────────────────────────────────

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
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
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

const sendRejectionEmail = async ({
  serviceAccountJson,
  senderEmail,
  oauthSubject,
  toEmail,
  subject,
  text,
}: {
  serviceAccountJson: string;
  senderEmail: string;
  oauthSubject: string;
  toEmail: string;
  subject: string;
  text: string;
}) => {
  const sa = JSON.parse(serviceAccountJson);
  const accessToken = await getAccessToken(sa.client_email, sa.private_key, oauthSubject);

  const emailRaw = [
    `From: "Tyler" <${senderEmail}>`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    text,
  ].join("\r\n");

  const raw = btoa(String.fromCharCode(...new TextEncoder().encode(emailRaw)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );

  const result = await res.json();
  if (!res.ok) throw new Error(`Gmail API error: ${JSON.stringify(result)}`);
  return { messageId: result.id as string };
};

// ── Stripe helpers ────────────────────────────────────────────────────────────

const stripeRequest = async (
  stripeSecretKey: string,
  path: string,
  init: RequestInit = {},
) => {
  const response = await fetch(`https://api.stripe.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(init.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `Stripe request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  return payload;
};

const findPaymentIntentId = async (
  stripeSecretKey: string,
  order: JsonRecord,
  metadata: JsonRecord,
) => {
  const directCandidates = [
    order.payment_intent_id,
    order.stripe_payment_intent_id,
    metadata.payment_intent_id,
    metadata.stripe_payment_intent_id,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const sessionId = typeof order.stripe_session_id === "string"
    ? order.stripe_session_id.trim()
    : "";

  if (!sessionId) {
    throw new Error("Missing Stripe session id on the order.");
  }

  const session = await stripeRequest(
    stripeSecretKey,
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`,
  );

  const paymentIntent = session?.payment_intent;
  if (typeof paymentIntent === "string" && paymentIntent.trim()) return paymentIntent.trim();
  if (paymentIntent?.id && typeof paymentIntent.id === "string") return paymentIntent.id;

  throw new Error("Unable to resolve a Stripe payment intent for this order.");
};

// ── Handler ───────────────────────────────────────────────────────────────────

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
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const serviceAccountJson = Deno.env.get("GMAIL_SERVICE_ACCOUNT_JSON");
  const senderEmail = Deno.env.get("GMAIL_SENDER_EMAIL") ?? "professor@tcgplaytest.com";
  const oauthSubject = Deno.env.get("GMAIL_OAUTH_SUBJECT") ?? "shuffle@cardify.club";

  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Missing Supabase server configuration." });
  if (!stripeSecretKey) return json(500, { error: "Missing STRIPE_SECRET_KEY." });

  const body = await parseJson(request);
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const templateKey = typeof body?.templateKey === "string" ? body.templateKey.trim() : "";
  const adminNote = typeof body?.adminNote === "string" ? body.adminNote.trim() : "";

  if (!orderId || !templateKey) return json(400, { error: "orderId and templateKey are required." });

  const authHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const orderResponse = await fetch(
    `${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`,
    { headers: authHeaders },
  );
  const orderRows = await orderResponse.json().catch(() => []);
  if (!orderResponse.ok) return json(500, { error: "Failed to load order from Supabase." });

  const order = Array.isArray(orderRows) ? orderRows[0] : null;
  if (!order) return json(404, { error: "Order not found." });

  const currentPaymentStatus = String(order.payment_status || "").toLowerCase();
  if (currentPaymentStatus === "refunded") return json(409, { error: "This order is already marked as refunded." });

  const template = EMAIL_TEMPLATES[templateKey];
  if (!template) return json(404, { error: `Unknown templateKey: ${templateKey}` });

  const customerFirstName = (String(order.customer_name || "")).split(" ")[0];
  const metadata = parseMaybeJson(order.metadata);

  try {
    const skipRefund = templateKey === "payment_issue";
    let refund: JsonRecord = { id: null, status: "skipped" };

    if (!skipRefund) {
      const paymentIntentId = await findPaymentIntentId(stripeSecretKey, order, metadata);
      const refundPayload = new URLSearchParams();
      refundPayload.set("payment_intent", paymentIntentId);
      refundPayload.set("metadata[order_id]", String(order.id));
      refundPayload.set("metadata[template_key]", templateKey);
      if (adminNote) refundPayload.set("metadata[admin_note]", adminNote);

      refund = await stripeRequest(stripeSecretKey, "/v1/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: refundPayload.toString(),
      });
    }

    let emailStatus = "skipped";
    let emailResult: JsonRecord = { status: "skipped" };

    if (serviceAccountJson && typeof order.customer_email === "string" && order.customer_email.trim()) {
      const emailResponse = await sendRejectionEmail({
        serviceAccountJson,
        senderEmail,
        oauthSubject,
        toEmail: order.customer_email.trim(),
        subject: template.subject,
        text: template.text(customerFirstName),
      });
      emailStatus = "sent";
      emailResult = { status: "sent", provider: "gmail-api", messageId: emailResponse?.messageId ?? null };
    }

    const nextMetadata = {
      ...metadata,
      rejection_flow: {
        template_key: templateKey,
        refund_id: refund.id ?? null,
        email_status: emailStatus,
        processed_at: new Date().toISOString(),
      },
    };

    const orderUpdatePayload = {
      status: "cancelled",
      payment_status: skipRefund ? order.payment_status : "refunded",
      refund_reason_key: templateKey,
      refunded_at: skipRefund ? null : new Date().toISOString(),
      refund_reference: refund.id ?? null,
      rejection_email_status: emailStatus,
      rejection_email_sent_at: emailStatus === "sent" ? new Date().toISOString() : null,
      metadata: nextMetadata,
    };

    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
      {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify(orderUpdatePayload),
      },
    );
    const updatedOrders = await updateResponse.json().catch(() => []);
    if (!updateResponse.ok) return json(500, { error: "Stripe refund succeeded but updating the order failed." });

    await fetch(`${supabaseUrl}/rest/v1/order_rejection_actions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        order_id: orderId,
        template_key: templateKey,
        refund_status: "succeeded",
        email_status: emailStatus,
        refund_reference: refund.id ?? null,
        admin_note: adminNote || null,
        action_metadata: {
          stripe_refund_status: refund.status ?? null,
          email: emailResult,
        },
      }),
    });

    return json(200, {
      success: true,
      order: Array.isArray(updatedOrders) ? updatedOrders[0] : null,
      refund: { id: refund.id ?? null, status: refund.status ?? null },
      email: emailResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected reject-order failure.";

    await fetch(`${supabaseUrl}/rest/v1/order_rejection_actions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        order_id: orderId,
        template_key: templateKey,
        refund_status: "failed",
        email_status: "skipped",
        admin_note: adminNote || null,
        error_message: message,
      }),
    }).catch(() => null);

    return json(500, { error: message });
  }
});
