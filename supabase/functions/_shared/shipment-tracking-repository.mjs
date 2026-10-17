import { referenceType, validEmail } from './shipment-tracking.mjs';

const ORDER_FIELDS = 'id,stripe_session_id,customer_name,customer_email,created_at,quantity,status,payment_status,shipping_address,uploaded_xml_filename,design_name:metadata->>designName,temp_order_id:metadata->>tempOrderId';
const NOTIFICATION_FIELDS = 'id,order_id,tracking_number,carrier,recipient_email,status,attempts,attempted_at,accepted_at,gmail_message_id,error';

export function createTrackingRepository({ url, serviceKey, fetchImpl = fetch }) {
  async function rest(path, params = {}, options = {}) {
    if (!url || !serviceKey) throw new Error('DATABASE_CONFIG');
    const target = new URL(`${url.replace(/\/$/, '')}/rest/v1/${path}`);
    target.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(target, {
      ...options, signal: AbortSignal.timeout(15000),
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers },
    });
    if (!response.ok) {
      let code = 'DATABASE_REQUEST_FAILED';
      try {
        const error = await response.json();
        const known = ['ORDER_CHANGED_REVIEW_AGAIN', 'TRACKING_ALREADY_ASSIGNED', 'ORDER_NOT_ELIGIBLE', 'ORDER_NOT_FOUND'];
        code = known.find((item) => String(error.message).includes(item)) || code;
      } catch { /* Never put database details or customer records into logs. */ }
      throw new Error(code);
    }
    return response.json();
  }
  async function lookup(table, field, values, select) {
    const rows = [];
    for (let offset = 0; offset < values.length; offset += 50) {
      const chunk = values.slice(offset, offset + 50);
      // All identifiers were validated before reaching this adapter; quoted values remain text.
      const found = await rest(table, { select, [field]: `in.(${chunk.map((value) => `"${value}"`).join(',')})`, limit: '1000' });
      if (found.length === 1000) throw new Error('AMBIGUOUS_LOOKUP_LIMIT');
      rows.push(...found);
    }
    return rows;
  }
  return {
    async findOrdersByEmail(email, offset = 0) {
      if (!validEmail(email) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error('INVALID_EMAIL_SEARCH');
      // Anchored, escaped case-insensitive regex: %, _, + and * in an address
      // must not act as search wildcards. The response is cross-checked too.
      const literal = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rows = await rest('orders', { select: ORDER_FIELDS, customer_email: `imatch.^${literal}$`, order: 'created_at.desc,id.desc', offset: String(offset), limit: '51' });
      return { orders: rows.slice(0, 50).filter((order) => order.customer_email?.toLowerCase() === email.toLowerCase()), nextOffset: rows.length > 50 ? offset + 50 : null };
    },
    async lookupOrders(references) {
      const groups = ['id', 'stripe_session_id', 'metadata->>tempOrderId'];
      const results = await Promise.all(groups.map((field) => lookup('orders', field, references.filter((value) => referenceType(value) === field), ORDER_FIELDS)));
      return [...new Map(results.flat().map((row) => [row.id, row])).values()];
    },
    lookupNotifications: (values) => lookup('shipment_tracking_notifications', 'tracking_number', values, NOTIFICATION_FIELDS),
    history: () => rest('shipment_tracking_notifications', { select: NOTIFICATION_FIELDS, order: 'created_at.desc', limit: '100' }),
    claim: (orderId, shipment, expected, actor) => rest('rpc/claim_shipment_tracking_notification', {}, {
      method: 'POST', body: JSON.stringify({ p_order_id: orderId, p_tracking_number: shipment.tracking, p_carrier: shipment.carrier, p_expected: expected, p_actor: actor }),
    }),
    async finish(id, token, outcome) {
      const rows = await rest('shipment_tracking_notifications', { id: `eq.${id}`, attempt_token: `eq.${token}`, status: 'eq.sending' }, { method: 'PATCH', body: JSON.stringify(outcome) });
      if (rows.length !== 1) throw new Error('RECEIPT_NOT_SAVED');
    },
  };
}
