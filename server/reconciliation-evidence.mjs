// Retain the original order snapshot. Verified provider evidence fills historical
// gaps for reporting without changing fulfillment, balances, or payment status.
export function applyReconciliationEvidence(orders, evidence) {
  const byOrder = new Map();
  for (const row of evidence) {
    const list = byOrder.get(row.order_id) || [];
    list.push(row);
    byOrder.set(row.order_id, list);
  }
  return orders.map(order => {
    const rows = byOrder.get(order.id) || [];
    const metadata = {...order.metadata};
    const sales = rows.filter(row => row.event_kind === 'sale'
      && row.amount_minor === Number(order.total_amount_cents)
      && row.currency === order.currency?.toUpperCase()
      && Number.isFinite(Date.parse(row.occurred_at)));
    if (!metadata.paid_at && sales.length === 1) {
      metadata.paid_at = sales[0].occurred_at;
      metadata.paid_at_evidence = sales[0].provider_reference;
    }
    metadata.refund_evidence = rows.filter(row => row.event_kind === 'refund');
    return {...order, metadata};
  });
}
