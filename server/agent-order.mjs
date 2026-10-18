import { createHash, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION = /^cs_(?:live|test)_[a-zA-Z0-9]{16,240}$/;
const KEY = /^tcgp_agent_[0-9a-f]{64}$/;
// Deliberately omit artwork, XML contents, billing details and payment credentials.
const ORDER_FIELDS = 'id,created_at,updated_at,customer_name,customer_email,customer_phone,shipping_address,total_amount_cents,currency,quantity,shipping_cost_cents,discount_amount_cents,status,payment_status,uploaded_xml_filename,metadata,pricing_snapshot,required_prints,wallet_prints_spent,payment_source';
const SHIPMENT_FIELDS = 'id,tracking_number,carrier,created_at,status,accepted_at';

function object(value) {
  try {
    for (let i = 0; i < 2 && typeof value === 'string'; i++) value = JSON.parse(value);
  } catch { return {}; }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
const text = (value, max = 500) => typeof value === 'string' ? value.slice(0, max) : null;
const integer = value => value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const shipmentDetails = row => ({
  id: row.id, tracking_number: text(row.tracking_number, 100), carrier: text(row.carrier, 50),
  saved_at: row.created_at, email_status: text(row.status, 30), email_accepted_at: row.accepted_at || null,
});

function orderDetails(row) {
  const metadata = object(row.metadata), pricing = object(row.pricing_snapshot), address = object(row.shipping_address);
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: text(row.status),
    payment_status: text(row.payment_status),
    payment_source: text(row.payment_source),
    customer: { name: text(row.customer_name), email: text(row.customer_email), phone: text(row.customer_phone) },
    shipping_address: Object.fromEntries(['line1', 'line2', 'city', 'state', 'postal_code', 'country'].map(field => [field, text(address[field])])),
    quantity: integer(row.quantity),
    deck_quantity: integer(metadata.deckQuantity),
    design_name: text(metadata.designName) || text(row.uploaded_xml_filename) || 'Card order',
    order_type: metadata.partnerCartId ? 'partner' : 'standard',
    manufacturing_status: text(metadata.manufacturingStatus),
    amounts: {
      currency: text(row.currency, 10),
      total_cents: integer(row.total_amount_cents),
      shipping_cents: integer(row.shipping_cost_cents),
      discount_cents: integer(row.discount_amount_cents),
      cards_subtotal_cents: integer(pricing.cardsSubtotalCents),
      // Unknown tax must remain unknown; do not infer it from the total.
      tax_cents: integer(pricing.taxAmountCents ?? pricing.taxCents),
    },
    prints: { required: integer(row.required_prints), spent: integer(row.wallet_prints_spent) },
    uploaded_xml_filename: text(row.uploaded_xml_filename),
  };
}

export function createAgentOrderHandler({ createClient, env = process.env, now = () => new Date() }) {
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('CDN-Cache-Control', 'no-store');
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Authorization');
    const send = (status, payload) => { response.statusCode = status; response.end(JSON.stringify(payload)); };
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return send(405, { error: 'Read-only endpoint. Use GET.' });
    }
    // Disabled until an operator configures a dedicated key hash. Never accept
    // dashboard cookies, a public anon key, or credentials from the query string.
    const expected = env.ORDER_AGENT_KEY_SHA256;
    if (!/^[0-9a-f]{64}$/i.test(expected || '')) return send(503, { error: 'Agent order access is not configured.' });
    const authorization = request.headers?.authorization;
    const token = typeof authorization === 'string' ? authorization.match(/^Bearer (\S+)$/i)?.[1] : null;
    if (!KEY.test(token || '') || !timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(expected, 'hex'))) {
      response.setHeader('WWW-Authenticate', 'Bearer realm="order-agent"');
      return send(401, { error: 'A valid order-agent key is required.' });
    }
    const params = new URL(request.url, 'https://dashboard.invalid').searchParams;
    const reference = params.get('order');
    if (params.getAll('order').length !== 1 || [...params.keys()].some(key => key !== 'order')
      || (!UUID.test(reference || '') && !SESSION.test(reference || ''))) {
      return send(400, { error: 'Supply one order parameter containing an order UUID or Stripe checkout session ID.' });
    }
    const databaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    if (!databaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) return send(503, { error: 'Agent order service is unavailable.' });
    try {
      // This client stays on the server. The bot never receives a database key.
      const db = createClient(databaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signal = AbortSignal.timeout(10000);
      const { data: order, error } = await db.from('orders').select(ORDER_FIELDS)
        .eq(UUID.test(reference) ? 'id' : 'stripe_session_id', reference).abortSignal(signal).maybeSingle();
      if (error) return send(502, { error: 'Order details could not be loaded. Try again.' });
      if (!order) return send(404, { error: 'Order not found.' });
      const { data: shipments, error: shipmentError } = await db.from('shipment_tracking_notifications')
        .select(SHIPMENT_FIELDS).eq('order_id', order.id).order('created_at', { ascending: false })
        .limit(101).abortSignal(signal);
      if (shipmentError) return send(502, { error: 'Order tracking could not be loaded. Try again.' });
      const email = typeof order.customer_email === 'string' ? order.customer_email.trim().toLowerCase() : '';
      const unassigned = email ? await db.from('shipment_tracking_notifications').select(SHIPMENT_FIELDS)
        .is('order_id', null).eq('recipient_email', email).order('created_at', { ascending: false })
        .limit(101).abortSignal(signal) : { data: [] };
      if (unassigned.error) return send(502, { error: 'Customer tracking could not be loaded. Try again.' });
      return send(200, {
        version: 1,
        read_only: true,
        retrieved_at: now().toISOString(),
        order: orderDetails(order),
        shipments: (shipments || []).slice(0, 100).map(shipmentDetails),
        shipments_truncated: (shipments || []).length > 100,
        unassigned_customer_shipments: (unassigned.data || []).slice(0, 100).map(row => ({ ...shipmentDetails(row), order_id: null, association: 'email_only' })),
        unassigned_customer_shipments_truncated: (unassigned.data || []).length > 100,
        tracking_note: 'shipments are explicitly linked to this order. unassigned_customer_shipments match the customer email only and are NOT confirmed as belonging to this order. Email status is not carrier delivery status.',
      });
    } catch {
      // Never include database errors, credentials or customer data in errors/logs.
      return send(502, { error: 'Agent order service could not be reached. Try again.' });
    }
  };
}
