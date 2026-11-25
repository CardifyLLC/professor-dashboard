import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrintCreditPurchasesHandler } from '../server/print-credit-purchases.mjs';

const paid = { id: 'topup-1', partner_id: 'partner-1', amount_cents: 5000, net_credit_cents: 5000, dispute_open: false, created_at: '2026-11-25T10:00:00Z', reconciled_at: '2026-11-25T10:02:00Z', payment_mode: 'live', stripe_session_id: 'must-not-leak', idempotency_key: 'must-not-leak' };
function fixture(options = {}) {
  const reads = [], adminFilters = [];
  let serviceClients = 0, adminChecks = 0;
  const rows = options.rows || [paid, { ...paid, id: 'unpaid', reconciled_at: null }, { ...paid, id: 'test-purchase', payment_mode: 'test' }];
  const env = { VITE_SUPABASE_URL: 'https://project.example', VITE_SUPABASE_ANON_KEY: 'public-fixture', SUPABASE_SERVICE_ROLE_KEY: 'server-fixture' };
  const createClient = (url, key, config) => {
    assert.equal(url, env.VITE_SUPABASE_URL);
    if (key === env.VITE_SUPABASE_ANON_KEY) {
      assert.equal(config.global.headers.Authorization, 'Bearer user-token');
      return {
        auth: { getUser: async () => options.authFailure ? { error: { status: 401 } } : { data: { user: { id: 'admin-id', email: 'admin@example.test' } } } },
        from(table) {
          assert.equal(table, 'dashboard_admins');
          const q = { select() { return q; }, eq(k, v) { adminFilters.push([k, v]); return q; }, async maybeSingle() {
            adminChecks++;
            return { data: options.denied || (options.revoked && adminChecks > 1) ? null : { user_id: 'admin-id' } };
          } }; return q;
        },
      };
    }
    assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY); serviceClients++;
    return { from(table) {
      const call = { table, filters: [], ordering: [] }; reads.push(call);
      let filtered = [...rows];
      const q = {
        select(columns, settings) { call.columns = columns; call.settings = settings; return q; },
        eq(key, value) { call.filters.push(['eq', key, value]); filtered = filtered.filter(row => row[key] === value); return q; },
        not(key, operator, value) { call.filters.push(['not', key, operator, value]); assert.equal(operator, 'is'); filtered = filtered.filter(row => row[key] !== value); return q; },
        order(key, settings) { call.ordering.push([key, settings]); return q; },
        async range(from, to) { call.range = [from, to]; return { data: filtered.slice(from, to + 1), count: options.noCount ? null : filtered.length, error: options.dbError ? { message: 'secret database detail' } : null }; },
        async in(key, ids) { assert.equal(key, 'id'); call.ids = ids; return { data: options.missingPartner ? [] : [{ id: 'partner-1', full_name: 'Buyer', business_name: 'Example Cards', email: 'buyer@example.test', widget_partner_key: 'must-not-leak' }], error: options.partnerError ? {} : null }; },
      }; return q;
    } };
  };
  const handler = createPrintCreditPurchasesHandler({ createClient, env });
  return { reads, adminFilters, get serviceClients() { return serviceClients; }, async request(url = '/api/print-credit-purchases', extra = {}) {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } };
    await handler({ method: 'GET', url, headers: { authorization: 'Bearer user-token' }, ...extra }, res);
    return res;
  } };
}

test('only enabled verified dashboard admins can read purchases; agent/service tokens are rejected', async () => {
  for (const [options, token, status] of [[{}, '', 401], [{ authFailure: true }, 'user-token', 401], [{ denied: true }, 'user-token', 403], [{}, 'tcgp_agent_test', 401], [{}, 'server-fixture', 401]]) {
    const f = fixture(options), response = await f.request(undefined, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, status); assert.equal(f.serviceClients, 0); assert.equal(f.reads.length, 0);
  }
});

test('confirmed live purchases include purchaser identity and safe fields only', async () => {
  const f = fixture(), response = await f.request();
  assert.equal(response.statusCode, 200); assert.equal(response.body.total, 1);
  assert.equal(response.body.purchases[0].customer_name, 'Buyer');
  assert.equal(response.body.purchases[0].business_name, 'Example Cards');
  assert.equal(response.body.purchases[0].amount_cents, 5000);
  assert.equal(response.body.purchases[0].status, 'Paid');
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak|server-fixture|unpaid/);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.ok(f.adminFilters.some(([k, v]) => k === 'enabled' && v === true));
  assert.equal(f.reads[0].columns.includes('*'), false);
});

test('test mode is isolated from live payments and unpaid attempts are excluded', async () => {
  const f = fixture(), response = await f.request('/api/print-credit-purchases?mode=test');
  assert.equal(response.body.mode, 'test'); assert.equal(response.body.total, 1);
  assert.deepEqual(response.body.purchases.map(row => row.id), ['test-purchase']);
  assert.deepEqual(f.reads[0].filters, [['eq', 'payment_mode', 'test'], ['not', 'reconciled_at', 'is', null]]);
});

test('history is paginated beyond 1000 rows with exact count and stable ordering', async () => {
  const f = fixture({ rows: Array.from({ length: 1012 }, (_, i) => ({ ...paid, id: `topup-${i}` })) });
  const response = await f.request('/api/print-credit-purchases?page=41');
  assert.equal(response.body.total, 1012); assert.equal(response.body.purchases.length, 12);
  assert.deepEqual(f.reads[0].range, [1000, 1024]);
  assert.deepEqual(f.reads[0].ordering, [['created_at', { ascending: false }], ['id', { ascending: false }]]);
});

test('refunds and disputes keep the original purchase and calculate reversals correctly', async () => {
  const f = fixture({ rows: [{ ...paid, net_credit_cents: 3000 }, { ...paid, id: 'full', net_credit_cents: 0 }, { ...paid, id: 'dispute', net_credit_cents: 0, dispute_open: true }] });
  const response = await f.request();
  assert.deepEqual(response.body.purchases.map(row => [row.amount_cents, row.reversed_cents, row.net_credit_cents, row.status]), [
    [5000, 2000, 3000, 'Partly reversed'], [5000, 5000, 0, 'Fully reversed'], [5000, 5000, 0, 'Disputed'],
  ]);
});

test('bad filters, duplicate parameters and writes fail before any purchase reads', async () => {
  for (const query of ['page=0', 'page=1.5', 'page=100000', 'mode=all', 'page=1&page=2', 'table=auth.users', 'mode=live&mode=test']) {
    const f = fixture(); assert.equal((await f.request(`/api/print-credit-purchases?${query}`)).statusCode, 400); assert.equal(f.reads.length, 0);
  }
  const f = fixture(); assert.equal((await f.request(undefined, { method: 'POST' })).statusCode, 405); assert.equal(f.serviceClients, 0);
});

test('database failures, missing counts and invalid money never look like empty purchase history', async () => {
  for (const options of [{ dbError: true }, { partnerError: true }, { noCount: true }, { rows: [{ ...paid, net_credit_cents: 99999 }] }]) {
    const response = await fixture(options).request(); assert.equal(response.statusCode, 503);
    assert.equal(response.body.purchases, undefined); assert.doesNotMatch(JSON.stringify(response.body), /secret database detail/);
  }
  const empty = await fixture({ rows: [] }).request(); assert.equal(empty.statusCode, 200); assert.deepEqual(empty.body.purchases, []);
});

test('missing partner profile preserves purchase and access revoked mid-request blocks response', async () => {
  const missing = await fixture({ missingPartner: true }).request();
  assert.equal(missing.statusCode, 200); assert.equal(missing.body.purchases[0].partner_id, 'partner-1'); assert.equal(missing.body.purchases[0].customer_email, null);
  const revoked = await fixture({ revoked: true }).request(); assert.equal(revoked.statusCode, 403); assert.equal(revoked.body.purchases, undefined);
});
