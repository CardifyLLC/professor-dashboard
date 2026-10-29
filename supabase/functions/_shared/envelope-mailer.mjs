import { validEmail } from './shipment-tracking.mjs';

const base64 = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const encoded = text => base64(new TextEncoder().encode(text));
const url64 = text => text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function createEnvelopeMailer({ env, fetchImpl = fetch }) {
  return { async prepare() {
    let account;
    try { account = JSON.parse(env('GMAIL_SERVICE_ACCOUNT_JSON') || 'null'); } catch { throw new Error('MAIL_CONFIG'); }
    const sender = env('GMAIL_SENDER_EMAIL') || 'professor@tcgplaytest.com';
    const subject = env('GMAIL_OAUTH_SUBJECT') || sender;
    if (!account?.client_email || !account?.private_key || !validEmail(sender) || !validEmail(subject)) throw new Error('MAIL_CONFIG');
    let assertion;
    try {
      const now = Math.floor(Date.now() / 1000);
      const input = `${url64(encoded(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${url64(encoded(JSON.stringify({ iss: account.client_email, sub: subject, scope: 'https://www.googleapis.com/auth/gmail.send', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })))}`;
      const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
      const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), char => char.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
      assertion = `${input}.${url64(base64(new Uint8Array(signature)))}`;
    } catch { throw new Error('MAIL_CONFIG'); }
    const auth = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const token = await auth.json().catch(() => ({}));
    if (!auth.ok || !token.access_token) throw new Error('MAIL_AUTH');
    return { async send(email, id) {
      if (!validEmail(email.to) || /[\r\n]/.test(email.subject)) throw Object.assign(new Error('Invalid email'), { definitelyRejected: true });
      const raw = [
        `From: "TCGPlaytest" <${sender}>`, `To: ${email.to}`, 'Reply-To: support@tcgplaytest.com',
        `Subject: =?UTF-8?B?${encoded(email.subject)}?=`, `Message-ID: <envelope-${id}@tcgplaytest.com>`,
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
        encoded(email.text).match(/.{1,76}/g).join('\r\n'),
      ].join('\r\n');
      const response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: url64(encoded(raw)) }),
      });
      // Network timeouts, 5xx and incomplete responses may have been accepted.
      // Never retry these automatically; only definite 4xx rejections are retryable.
      if (!response.ok) throw Object.assign(new Error('Gmail send failed'), { definitelyRejected: [400, 401, 403, 404, 429].includes(response.status) });
      const receipt = await response.json();
      if (!receipt.id) throw new Error('Missing Gmail receipt');
      return receipt.id;
    } };
  } };
}
