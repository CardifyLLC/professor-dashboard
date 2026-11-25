function record(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cents(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

const normalized = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

// Partner prepaid USD credits are separate from the customer's PRINTS wallet.
// Use the recorded credit charge, never the order total: shipping/tax may have
// been paid separately, and legacy orders can have no recorded breakdown.
export function getApiPrintCredits(order) {
  if (![order?.payment_source, order?.payment_provider].some(value => normalized(value) === 'partner_credit')) return null;
  const snapshot = record(order.pricing_snapshot);
  const metadata = record(order.metadata);
  const paymentStatus = normalized(order.payment_status);
  const status = normalized(order.status);
  const refunded = paymentStatus === 'refunded' || Boolean(order.refunded_at);
  const cancelled = status === 'cancelled' || status === 'canceled';
  const paid = paymentStatus === 'paid' || (!paymentStatus && ['paid', 'processing', 'shipped', 'completed'].includes(status));
  return {
    creditCents: cents(snapshot.credit_cents),
    customerPaymentCents: cents(snapshot.customer_payment_cents),
    partnerId: typeof metadata.partnerId === 'string' ? metadata.partnerId : null,
    state: refunded ? 'refunded' : cancelled ? 'cancelled' : paid ? 'paid' : 'pending',
  };
}

export function formatApiCreditAmount(value) {
  return value === null ? 'Amount unavailable' : new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
  }).format(value / 100);
}
