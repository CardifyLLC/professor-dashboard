import { normalizeShipment, orderProblem, orderSnapshot, buildTrackingEmail, validEmail } from './shipment-tracking.mjs';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const stable = (value) => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item;
});

export async function reviewShipments(inputs, repository) {
  const normalized = inputs.map(normalizeShipment);
  const valid = normalized.filter((item) => !item.error).map((item) => item.row);
  const [orders, notifications] = await Promise.all([
    repository.lookupOrders([...new Set(valid.map((row) => row.reference))]),
    repository.lookupNotifications([...new Set(valid.map((row) => row.tracking))]),
  ]);
  const counts = new Map();
  for (const { row } of normalized) if (row.tracking) counts.set(row.tracking, (counts.get(row.tracking) || 0) + 1);
  return normalized.map(({ row, error }) => {
    const result = { row, status: 'blocked', message: error, order: null };
    if (error) return result;
    if (counts.get(row.tracking) > 1) return { ...result, message: 'Tracking number appears more than once in this batch. Keep one verified row.' };
    const matches = orders.filter((order) => [order.id, order.stripe_session_id, order.temp_order_id].includes(row.reference));
    if (matches.length !== 1) return { ...result, message: matches.length ? 'This reference matches multiple orders. Use the full order UUID.' : 'No exact order match. Enter the full order ID from the dashboard.' };
    const order = matches[0];
    result.order = order;
    const problem = orderProblem(order, row);
    if (problem) return { ...result, message: problem };
    const notification = notifications.find((item) => item.tracking_number === row.tracking);
    if (notification) {
      if (notification.order_id !== order.id || notification.carrier !== row.carrier) return { ...result, message: 'This tracking number is already assigned to a different order or carrier.' };
      if (notification.status === 'accepted') return { ...result, status: 'accepted', message: 'Already accepted by Gmail. This email will not be sent again.' };
      if (notification.status !== 'failed') return { ...result, status: notification.status, message: 'Sending or delivery outcome unconfirmed. Check Gmail and the history before attempting any resend.' };
    }
    return { ...result, status: 'ready', message: notification ? 'Previous attempt was rejected by Gmail. Review before retrying.' : 'Exact order match. Ready for your review.', snapshot: orderSnapshot(order), email: buildTrackingEmail(order, row) };
  });
}

export function createShipmentTrackingHandler({ requireAdmin, repository, mailer }) {
  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return json(405, { error: 'Use POST.' });
    let admin;
    try { admin = await requireAdmin(request); }
    catch (error) { return json(error.message === 'FORBIDDEN' ? 403 : error.message === 'UNAUTHORIZED' ? 401 : 500, { error: 'An enabled dashboard administrator must sign in.' }); }
    try {
      // Bound the stream too: Content-Length can be absent or forged.
      const reader = request.body?.getReader();
      if (!reader) return json(400, { error: 'Missing request body.' });
      let size = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 200000) { await reader.cancel(); return json(413, { error: 'Request too large. Review at most 100 rows at a time.' }); }
        chunks.push(value);
      }
      let body;
      try { body = JSON.parse(await new Blob(chunks).text()); }
      catch { return json(400, { error: 'Invalid JSON.' }); }
      if (!body || typeof body !== 'object') return json(400, { error: 'Invalid request.' });
      if (body.action === 'history') return json(200, { notifications: await repository.history() });
      if (body.action === 'candidates') {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const offset = body.offset ?? 0;
        if (!validEmail(email) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return json(400, { error: 'Choose a valid customer email and search page.' });
        const page = await repository.findOrdersByEmail(email, offset);
        // Suggestions never become a selected order. Sending still requires an exact
        // reference, reviewed snapshot and an atomic claim, just like CSV imports.
        const orders = page.orders.filter((order) => order.customer_email?.toLowerCase() === email).map((order) => {
          const reason = orderProblem(order, { email });
          return { ...order, eligible: !reason, reason };
        });
        return json(200, { orders, nextOffset: page.nextOffset });
      }
      if (body.action === 'preview') {
        if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 100 || body.rows.some((row) => !row || typeof row !== 'object')) return json(400, { error: 'Review 1–100 shipments per request.' });
        return json(200, { results: await reviewShipments(body.rows, repository) });
      }
      if (body.action !== 'send' || !body.row || !body.snapshot || !body.orderId) return json(400, { error: 'Review the order before sending.' });
      const [review] = await reviewShipments([body.row], repository);
      if (review.status === 'accepted') return json(200, { status: 'accepted', message: review.message });
      if (review.status !== 'ready') return json(409, { error: review.message });
      if (review.order.id !== body.orderId || stable(body.snapshot) !== stable(review.snapshot)) return json(409, { error: 'Order details changed. Review this shipment again.' });
      // Check credentials before creating a send claim. No Gmail request is retried automatically.
      const preparedMailer = await mailer.prepare();
      const claim = await repository.claim(review.order.id, review.row, review.snapshot, admin.id);
      const record = claim.notification;
      if (!claim.claimed) return json(200, { status: record.status, message: 'This shipment was already submitted. Check its history.' });
      let outcome;
      try {
        const email = buildTrackingEmail(record.order_snapshot, review.row);
        const messageId = await preparedMailer.send(email, record.id);
        outcome = { status: 'accepted', gmail_message_id: messageId, accepted_at: new Date().toISOString(), error: null };
      } catch (error) {
        outcome = { status: error.definitelyRejected ? 'failed' : 'unknown', error: error.definitelyRejected ? 'Gmail rejected this request. Check the sender configuration or quota, then review and retry.' : 'Gmail acceptance could not be confirmed. Check Gmail before any resend.' };
      }
      try { await repository.finish(record.id, record.attempt_token, outcome); }
      catch { return json(200, { status: 'unknown', message: 'The email request completed, but its receipt could not be saved. Check Gmail and history; do not resend automatically.' }); }
      return json(200, { status: outcome.status, message: outcome.status === 'accepted' ? 'Gmail accepted the tracking email.' : outcome.error });
    } catch (error) {
      const messages = {
        ORDER_CHANGED_REVIEW_AGAIN: 'Order details changed. Review again.',
        TRACKING_ALREADY_ASSIGNED: 'This tracking number belongs to another order or carrier.',
        ORDER_NOT_ELIGIBLE: 'This order is no longer eligible for a tracking email.',
        ORDER_NOT_FOUND: 'The order no longer exists.',
        MAIL_CONFIG: 'Tracking email is not configured. Check the existing Gmail secrets in Supabase.',
        MAIL_AUTH: 'Gmail authorization failed. Check the service account and delegated sender.',
      };
      const known = Object.entries(messages).find(([code]) => String(error.message).includes(code));
      return json(known ? 409 : 503, { error: known ? known[1] : 'Tracking service unavailable. Check the migration and Edge Function deployment, then refresh the review/history.' });
    }
  };
}
