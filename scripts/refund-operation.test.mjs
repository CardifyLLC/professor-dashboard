import test from 'node:test';
import assert from 'node:assert/strict';
import { runRefund } from '../supabase/functions/_shared/refund-operation.mjs';
function fixture() {
  const request = { order_id: 'o', payment_intent: 'pi', amount_minor: 200, template_key: 'bleed', request_key: 'r' };
  let op = { ...request, id: 'op', status: 'prepared', notification_status: 'pending', created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() };
  let refunds = 0, emails = 0, orderWrites = 0;
  const repository = {
    reserve: async () => ({ ...op }), claimProvider: async (old, timestamp) => { if (op.status !== old.status || op.updated_at !== old.updated_at) return null; op = { ...op, status: 'submitted', updated_at: timestamp }; return { ...op }; },
    recordOutcome: async (_, result) => { op = { ...op, status: result.status, provider_reference: result.id }; return { ...op }; },
    claimNotification: async () => { if (!['pending', 'failed'].includes(op.notification_status)) return null; op.notification_status = 'sending'; return { ...op }; },
    recordNotification: async (_, state) => { op.notification_status = state; return { ...op }; },
    markReview: async () => { op.status = 'needs_reconciliation'; return { ...op }; },
  };
  const deps = { repository, request, now: () => 1000, refund: async () => { refunds++; return { id: 're', status: 'succeeded', amount: 200 }; }, lookupRefund: async () => ({ id: 're', status: 'succeeded' }), applyOrder: async () => { orderWrites++; }, notify: async () => { emails++; return { messageId: 'mail' }; } };
  return { deps, counts: () => ({ refunds, emails, orderWrites }), state: () => op };
}
test('email failure preserves success and retries email without another refund', async () => {
  const f = fixture(); const notify = f.deps.notify;
  f.deps.notify = async () => { throw Object.assign(new Error('mail rejected'), { retrySafe: true }); };
  assert.equal((await runRefund(f.deps)).operation.status, 'succeeded');
  f.deps.notify = notify;
  await runRefund(f.deps); await runRefund(f.deps);
  assert.equal(f.counts().refunds, 1); assert.equal(f.counts().emails, 1);
});
test('database failure after provider success retains the same idempotency key', async () => {
  const f = fixture(); const record = f.deps.repository.recordOutcome; const keys = [];
  f.deps.refund = async input => { keys.push(input.idempotencyKey); return { id: 're', status: 'succeeded' }; };
  f.deps.repository.recordOutcome = async () => { throw new Error('database down'); };
  await assert.rejects(runRefund(f.deps));
  f.deps.repository.recordOutcome = record; f.deps.now = () => 122000;
  await runRefund(f.deps); assert.deepEqual(keys, ['tcgp-refund-op', 'tcgp-refund-op']);
});
test('concurrent requests claim the provider operation once', async () => {
  const f = fixture(); await Promise.all([runRefund(f.deps), runRefund(f.deps)]); assert.equal(f.counts().refunds, 1);
});
test('old unknown requests require reconciliation instead of reuse after Stripe expiry', async () => {
  const f = fixture(); f.deps.now = () => 24 * 3600000; assert.equal((await runRefund(f.deps)).requiresReview, true); assert.equal(f.counts().refunds, 0);
});
test('partial refund amount is persisted and conflicting replay is rejected', async () => {
  const f = fixture(); let amount; f.deps.refund = async input => { amount = input.amount; return { id: 're', status: 'succeeded' }; };
  await runRefund(f.deps); assert.equal(amount, 200); f.deps.request = { ...f.deps.request, amount_minor: 500 }; await assert.rejects(runRefund(f.deps));
});
test('provider timeout stays submitted and does not send email', async () => {
  const f = fixture(); f.deps.refund = async () => { throw new Error('timeout'); }; await assert.rejects(runRefund(f.deps)); assert.equal(f.state().status, 'submitted'); assert.equal(f.counts().emails, 0);
});
