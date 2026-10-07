export function emptyCommerceMetrics() {
  return { orders: 0, paidOrders: 0, pendingOrders: 0, failedPayments: 0, refundedOrders: 0, cancelledOrders: 0,
    cardsOrdered: 0, paidCards: 0, customers: 0, repeatCustomers: 0, affiliateOrders: 0,
    currencies: Object.create(null), statuses: Object.create(null), countries: Object.create(null), trend: Object.create(null), firstOrderAt: null, lastOrderAt: null };
}

export function summarizeCommerce(rows) {
  const total = emptyCommerceMetrics(), partners = {}, customers = new Map();
  let unattributedOrders = 0;
  for (const row of rows) {
    if (!row.cart_id) continue;
    const partnerId = row.partner_id;
    if (!partnerId) unattributedOrders++;
    const targets = [total, ...(partnerId ? [partners[partnerId] ||= emptyCommerceMetrics()] : [])];
    const payment = String(row.payment_status || '').toLowerCase();
    const status = String(row.status || '').toLowerCase();
    // Status alone is only a fallback for legacy rows without payment_status.
    const refunded = payment === 'refunded';
    const paid = payment === 'paid' || (!payment && ['paid', 'processing', 'shipped', 'completed'].includes(status));
    const wasPaid = paid || refunded;
    const amount = Number(row.total_amount_cents);
    const quantity = Number(row.quantity) || 0;
    const currency = /^[a-z]{3}$/i.test(row.currency || '') ? row.currency.toUpperCase() : 'UNKNOWN';
    for (const metrics of targets) {
      metrics.orders++;
      metrics.paidOrders += wasPaid ? 1 : 0;
      metrics.pendingOrders += !wasPaid && payment !== 'failed' && status === 'pending' ? 1 : 0;
      metrics.failedPayments += payment === 'failed' ? 1 : 0;
      metrics.refundedOrders += refunded ? 1 : 0;
      metrics.cancelledOrders += status === 'cancelled' ? 1 : 0;
      metrics.cardsOrdered += quantity;
      metrics.paidCards += wasPaid ? quantity : 0;
      metrics.affiliateOrders += wasPaid && row.coupon_code ? 1 : 0;
      metrics.statuses[status] = (metrics.statuses[status] || 0) + 1;
      if (!metrics.firstOrderAt || row.created_at < metrics.firstOrderAt) metrics.firstOrderAt = row.created_at;
      if (!metrics.lastOrderAt || row.created_at > metrics.lastOrderAt) metrics.lastOrderAt = row.created_at;
      const month = String(row.created_at).slice(0, 7);
      const trend = metrics.trend[month] ||= { orders: 0, paidOrders: 0, cards: 0 };
      trend.orders++; trend.paidOrders += wasPaid ? 1 : 0; trend.cards += wasPaid ? quantity : 0;
      if (wasPaid) {
        const key = String(row.customer_email || '').trim().toLowerCase();
        if (key) {
          if (!customers.has(metrics)) customers.set(metrics, new Map());
          const counts = customers.get(metrics);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const country = row.shipping_country || 'Unknown';
        metrics.countries[country] = (metrics.countries[country] || 0) + 1;
        const money = metrics.currencies[currency] ||= { paidOrders: 0, grossCents: 0, retainedCents: 0, refundedOrderValueCents: 0, shippingCents: 0, discountCents: 0, unknownAmounts: 0 };
        if (row.total_amount_cents == null || !Number.isSafeInteger(amount) || amount < 0) { money.unknownAmounts++; continue; }
        money.paidOrders++; money.grossCents += amount;
        if (refunded) money.refundedOrderValueCents += amount;
        else money.retainedCents += amount;
        money.shippingCents += Number(row.shipping_cost_cents) || 0;
        money.discountCents += Number(row.discount_amount_cents) || 0;
      }
    }
  }
  for (const [metrics, counts] of customers) {
    metrics.customers = counts.size;
    metrics.repeatCustomers = [...counts.values()].filter(count => count > 1).length;
  }
  return { total, partners, unattributedOrders };
}

export async function loadCommerceAnalytics(db, window, requestDeadline = Date.now() + 20000) {
  if (window.mode === 'test') return { available: true, ...summarizeCommerce([]) };
  const rows = [], deadline = Math.min(requestDeadline, Date.now() + 20000);
  try {
    for (;;) {
      let query = db.from('orders').select('id,partner_id:metadata->>partnerId,cart_id:metadata->>partnerCartId,status,payment_status,total_amount_cents,currency,quantity,shipping_cost_cents,discount_amount_cents,shipping_country,customer_email,coupon_code,created_at', { count: 'exact' })
        .not('metadata->>partnerCartId', 'is', null).lte('created_at', window.until);
      if (window.since) query = query.gte('created_at', window.since);
      const { data, error, count } = await query.order('id').range(rows.length, rows.length + 999).abortSignal(AbortSignal.timeout(Math.max(1, deadline - Date.now())));
      if (error || count == null || !Array.isArray(data)) throw new Error('Order analytics unavailable');
      rows.push(...data);
      if (rows.length >= count) return { available: true, ...summarizeCommerce(rows) };
      if (!data.length || Date.now() > deadline || rows.length > 250000) throw new Error('Analytics scan incomplete');
    }
  } catch {
    return { available: false, error: 'Checkout order analytics could not be loaded. Refresh or choose a shorter period. No partial totals are shown.' };
  }
}
