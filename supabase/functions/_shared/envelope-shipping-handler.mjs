import { envelopeOrderEligible, buildEnvelopeEmail } from './envelope-shipping.mjs';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const summary = (status, shippedAt) => ({
  status, shippedAt,
  message: status === 'accepted' ? 'Shipped. The customer profile was updated and Gmail accepted the email.'
    : status === 'failed' ? 'Shipped and added to the customer profile, but Gmail rejected the email. You can retry the email.'
    : 'Shipped and added to the customer profile. Email delivery is unconfirmed; check Gmail before any resend.',
});

export function createEnvelopeShippingHandler({ requireAdmin, repository, mailer }) {
  return async request => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return json(405, { error: 'Use POST.' });
    let admin;
    try { admin = await requireAdmin(request); }
    catch (error) { return json(error.message === 'FORBIDDEN' ? 403 : error.message === 'UNAUTHORIZED' ? 401 : 503, { error: 'An enabled administrator must sign in.' }); }
    try {
      const reader = request.body?.getReader();
      if (!reader) return json(400, { error: 'Missing order.' });
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) { await reader.cancel(); return json(413, { error: 'Request too large.' }); }
        chunks.push(value);
      }
      let body;
      try { body = JSON.parse(await new Blob(chunks).text()); } catch { return json(400, { error: 'Invalid JSON.' }); }
      if (!body || !uuid.test(body.orderId || '') || Object.keys(body).some(key => key !== 'orderId')) return json(400, { error: 'Choose a valid order.' });
      const order = await repository.order(body.orderId);
      if (!order) return json(404, { error: 'Order not found.' });
      if (!envelopeOrderEligible(order)) return json(409, { error: 'Only paid, non-cancelled card orders containing 1–44 cards can use Plain White Envelope shipping.' });
      if (order.envelope_shipped_at && ['accepted', 'sending', 'unknown'].includes(order.envelope_email_status)) {
        return json(200, summary(order.envelope_email_status, order.envelope_shipped_at));
      }
      // Verify mail configuration before changing the order. A transaction then
      // rechecks eligibility and claims this order once, including concurrent clicks.
      const sender = await mailer.prepare();
      const claim = await repository.claim(order.id, admin.id, order);
      const receipt = claim.notification;
      if (!claim.claimed) return json(200, summary(receipt.status, receipt.shipped_at));
      let outcome;
      try {
        const messageId = await sender.send(buildEnvelopeEmail(receipt.order_snapshot), receipt.id);
        outcome = { status: 'accepted', messageId };
      } catch (error) {
        outcome = { status: error.definitelyRejected ? 'failed' : 'unknown' };
      }
      try { await repository.finish(receipt.id, receipt.attempt_token, outcome); }
      catch { outcome = { status: 'unknown' }; }
      return json(200, summary(outcome.status, receipt.shipped_at));
    } catch (error) {
      const messages = {
        ADMIN_REQUIRED: 'Administrator access has been removed.',
        ORDER_NOT_FOUND: 'The order no longer exists.',
        ORDER_NOT_ELIGIBLE: 'This order is no longer eligible. Only paid card orders with 1–44 cards qualify.',
        ORDER_CHANGED: 'The order changed. Refresh it before marking it shipped.',
        MAIL_CONFIG: 'Shipping email is not configured. Check the Gmail secrets in Supabase.',
        MAIL_AUTH: 'Gmail authorization failed. Check the delegated sender configuration.',
      };
      return json(messages[error.message] ? 409 : 503, { error: messages[error.message] || 'Shipping could not be confirmed. Refresh the order before trying again.' });
    }
  };
}
