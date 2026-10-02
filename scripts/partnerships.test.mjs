import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartnershipsHandler } from '../server/partnerships.mjs';

const userId = '11111111-1111-4111-a111-111111111111';
function fixture(options = {}) {
  const calls = [], filters = [];
  const env = { VITE_SUPABASE_URL: 'https://main.example', VITE_SUPABASE_ANON_KEY: 'public-key', PARTNER_PLATFORM_ORIGIN: 'https://partner.example/', PARTNER_INTERNAL_SECRET: 's'.repeat(64), ...options.env };
  const handler = createPartnershipsHandler({ env, createClient: (url, key, settings) => {
    assert.equal(url, env.VITE_SUPABASE_URL); assert.equal(key, 'public-key');
    assert.equal(settings.global.headers.Authorization, 'Bearer user-token');
    return {
      auth: { getUser: async token => { assert.equal(token, 'user-token'); return { data: { user: options.expired ? null : { id: userId, email: 'admin@example.com' } } }; } },
      from(table) {
        assert.equal(table, 'dashboard_admins');
        const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, maybeSingle: async () => ({ data: options.denied ? null : { user_id: userId } }) };
        return query;
      },
    };
  }, fetchImpl: async (url, request) => {
    calls.push({ url, request, body: JSON.parse(request.body) });
    const status = options.remoteStatus || 200;
    return { status, ok: status === 200, json: async () => status === 200 ? { requests: [], total: 0, pageSize: 25 } : { error: { message: 'Partnership admin access required.' } } };
  } });
  return { calls, filters, env, async request(body = { action: 'list' }, extra = {}) {
    const headers = {}; let result;
    await handler({ method: 'POST', headers: { authorization: 'Bearer user-token' }, body, ...extra }, {
      setHeader: (key, value) => { headers[key] = value; }, set statusCode(value) { headers.status = value; }, end: value => { result = JSON.parse(value); },
    });
    return { status: headers.status, headers, body: result };
  } };
}

test('only a verified, enabled dashboard administrator can contact the partner service', async () => {
  for (const [options, extra, status] of [[{}, { headers: {} }, 401], [{ expired: true }, {}, 401], [{ denied: true }, {}, 403], [{}, { method: 'GET' }, 405]]) {
    const f = fixture(options); assert.equal((await f.request(undefined, extra)).status, status); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); assert.equal((await f.request()).status, 200);
  assert.deepEqual(f.filters, [['user_id', userId], ['enabled', true]]);
});

test('list requests forward server configuration and verified identity, never browser supplied credentials', async () => {
  const f = fixture();
  const result = await f.request({ action: 'list', status: 'approved', page: 2, reviewer: { userId: 'forged', email: 'owner@example.com' }, origin: 'https://attacker.example', secret: 'forged' });
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(f.calls[0].url, 'https://partner.example/api/internal/partnerships');
  assert.deepEqual(f.calls[0].body, { action: 'list', status: 'approved', page: 2, reviewer: { userId, email: 'admin@example.com' } });
  assert.equal(f.calls[0].request.headers.Authorization, `Bearer ${f.env.PARTNER_INTERNAL_SECRET}`);
  assert.equal(f.calls[0].request.redirect, 'error');
  assert.ok(!JSON.stringify(result.body).includes(f.env.PARTNER_INTERNAL_SECRET));
});

test('reviews preserve zero percent and the application revision and strip unrelated fields', async () => {
  const f = fixture();
  await f.request({ action: 'review', id: 'application-id', status: 'approved', approvedPercentage: 0, adminNotes: 'Reviewed', expectedUpdatedAt: 'revision', api_blocked_at: null, reviewed_by: 'forged' });
  assert.deepEqual(f.calls[0].body, { action: 'review', id: 'application-id', status: 'approved', approvedPercentage: 0, adminNotes: 'Reviewed', expectedUpdatedAt: 'revision', reviewer: { userId, email: 'admin@example.com' } });
});

test('revocation forwards only the requested partner, reason, revision and verified operator',async()=>{
  const f=fixture();await f.request({action:'revoke',id:'partner-id',reason:'Reported infringement',expectedUpdatedAt:'revision',reviewer:{email:'forged@example.com'},api_blocked_at:null});
  assert.deepEqual(f.calls[0].body,{action:'revoke',id:'partner-id',reason:'Reported infringement',expectedUpdatedAt:'revision',reviewer:{userId,email:'admin@example.com'}});
  const denied=fixture({denied:true});assert.equal((await denied.request({action:'revoke',id:'partner-id',reason:'Reported infringement'})).status,403);assert.equal(denied.calls.length,0);
});

test('missing configuration and invalid or oversized bodies fail without making a remote request', async () => {
  for (const [options, body, status] of [
    [{ env: { PARTNER_INTERNAL_SECRET: '' } }, { action: 'list' }, 503],
    [{}, { action: 'delete' }, 400], [{}, '{bad', 400], [{}, null, 400],
    [{}, { action: 'review', adminNotes: 'a'.repeat(16000) }, 413],
  ]) {
    const f = fixture(options); assert.equal((await f.request(body)).status, status); assert.equal(f.calls.length, 0);
  }
});

test('partner permission failures and missing deployment errors are visible to the operator', async () => {
  assert.equal((await fixture({ remoteStatus: 403 }).request()).status, 403);
  const missing = await fixture({ remoteStatus: 404 }).request();
  assert.equal(missing.status, 503); assert.match(missing.body.error, /Deploy the updated partner app/);
});
