export function createEnvelopeRepository({ url, serviceKey, fetchImpl = fetch }) {
  async function rest(path, params = {}, body) {
    if (!url || !serviceKey) throw new Error('DATABASE_CONFIG');
    const target = new URL(`${url.replace(/\/$/, '')}/rest/v1/${path}`);
    target.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(target, {
      method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15000),
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const known = ['ADMIN_REQUIRED', 'ORDER_NOT_FOUND', 'ORDER_NOT_ELIGIBLE', 'ORDER_CHANGED', 'RECEIPT_NOT_SAVED'];
      throw new Error(known.find(code => String(result.message).includes(code)) || 'DATABASE_UNAVAILABLE');
    }
    return response.json();
  }
  return {
    async order(id) {
      const rows = await rest('orders', { id: `eq.${id}`, select: 'id,customer_name,customer_email,quantity,status,payment_status,metadata,envelope_shipped_at,envelope_email_status', limit: '1' });
      return rows[0] || null;
    },
    claim: (id, actor, expected) => rest('rpc/claim_envelope_shipment', {}, { p_order_id: id, p_actor: actor, p_expected_quantity: expected.quantity, p_expected_email: expected.customer_email }),
    finish: (id, token, outcome) => rest('rpc/finish_envelope_shipment', {}, {
      p_id: id, p_token: token, p_status: outcome.status, p_message_id: outcome.messageId || null,
    }),
  };
}
