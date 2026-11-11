// Financial outcome and notification state are deliberately independent.
export async function runRefund({ repository, request, refund, lookupRefund, applyOrder, notify, now = () => Date.now() }) {
  let operation = await repository.reserve(request);
  if (operation.payment_intent !== request.payment_intent || operation.amount_minor !== request.amount_minor || operation.order_id !== request.order_id || operation.template_key !== request.template_key) throw new Error('Operation ID already belongs to a different refund');
  if (operation.status === 'needs_reconciliation' || operation.status === 'failed') return { operation, requiresReview: true };
  if (operation.status === 'pending' && operation.provider_reference) {
    const result = await lookupRefund(operation.provider_reference);
    operation = await repository.recordOutcome(operation, result);
  }
  if (['prepared', 'submitted'].includes(operation.status)) {
    const age = now() - Date.parse(operation.created_at);
    // Stripe keys may be evicted after 24 hours. Never blindly repeat an old unknown request.
    if (age >= 23 * 60 * 60 * 1000) {
      operation = await repository.markReview(operation);
      return { operation, requiresReview: true };
    }
    if (operation.status === 'submitted' && now() - Date.parse(operation.updated_at) < 120000) return { operation, inProgress: true };
    const claimed = await repository.claimProvider(operation, new Date(now()).toISOString());
    if (!claimed) return { operation, inProgress: true };
    operation = claimed;
    // Timeout or persistence failure leaves submitted, never falsely failed.
    const result = await refund({ payment_intent: operation.payment_intent, amount: operation.amount_minor, idempotencyKey: 'tcgp-refund-' + operation.id });
    operation = await repository.recordOutcome(operation, result);
  }
  if (operation.status !== 'succeeded') return { operation };
  // Retried after provider success without requesting another refund.
  await applyOrder(operation);
  if (['pending', 'failed'].includes(operation.notification_status)) {
    const claimed = await repository.claimNotification(operation);
    if (claimed) {
      let message;
      try { message = await notify(claimed); }
      catch (error) {
        const state = error?.retrySafe === true ? 'failed' : 'uncertain';
        operation = await repository.recordNotification(claimed, state, null);
        return { operation, notificationWarning: state === 'failed' ? 'Refund recorded. Notification failed; retry notification only.' : 'Refund recorded. Notification delivery is uncertain; check the mail provider before resending.' };
      }
      // If this write fails, sending is retained for manual reconciliation, not automatic re-send.
      operation = await repository.recordNotification(claimed, message?.skipped ? 'skipped' : 'sent', message?.messageId || null);
    }
  }
  return { operation };
}

export function refundRepository({ url, headers, fetchImpl = fetch }) {
  async function call(query, method = 'GET', body, prefer = 'return=representation') {
    const response = await fetchImpl(`${url}/rest/v1/refund_operations${query}`, { method, headers: { ...headers, Prefer: prefer }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error('Refund audit persistence failed; reconcile before retrying');
    return response.json();
  }
  const byId = op => '?id=eq.' + encodeURIComponent(op.id);
  return {
    async reserve(request) {
      await call('?on_conflict=request_key', 'POST', request, 'resolution=ignore-duplicates,return=representation');
      const rows = await call('?request_key=eq.' + encodeURIComponent(request.request_key));
      if (rows.length !== 1) throw new Error('Refund operation unavailable');
      return rows[0];
    },
    async claimProvider(op, updated_at) {
      return (await call(byId(op) + '&status=eq.' + op.status + '&updated_at=eq.' + encodeURIComponent(op.updated_at), 'PATCH', { status: 'submitted', updated_at }))[0];
    },
    async markReview(op) {
      const rows = await call(byId(op) + '&status=eq.' + op.status + '&updated_at=eq.' + encodeURIComponent(op.updated_at), 'PATCH', { status: 'needs_reconciliation', updated_at: new Date().toISOString() });
      return rows[0] || (await call(byId(op)))[0];
    },
    async recordOutcome(op, result) {
      if (!result?.id || !['succeeded', 'pending', 'failed', 'canceled', 'requires_action'].includes(result.status)) throw new Error('Unknown provider outcome; reconciliation required');
      const status = result.status === 'succeeded' ? 'succeeded' : ['failed', 'canceled'].includes(result.status) ? 'failed' : 'pending';
      const rows = await call(byId(op) + '&status=eq.' + op.status + '&updated_at=eq.' + encodeURIComponent(op.updated_at), 'PATCH', { status, provider_reference: result.id, provider_result: { id: result.id, status: result.status, amount: result.amount, currency: result.currency, created: result.created }, updated_at: new Date().toISOString() });
      if (rows[0]) return rows[0];
      const latest = await call(byId(op));
      if (!latest[0] || latest[0].status === 'submitted') throw new Error('Refund outcome not recorded');
      return latest[0];
    },
    async claimNotification(op) { return (await call(byId(op) + '&notification_status=in.(pending,failed)', 'PATCH', { notification_status: 'sending', updated_at: new Date().toISOString() }))[0]; },
    async recordNotification(op, status, reference) {
      const row = (await call(byId(op) + '&notification_status=eq.sending', 'PATCH', { notification_status: status, notification_reference: reference || null, updated_at: new Date().toISOString() }))[0];
      if (!row) throw new Error('Notification outcome not recorded; inspect provider before retrying');
      return row;
    },
  };
}
