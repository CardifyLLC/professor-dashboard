import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardAccessRequest } from '../src/services/dashboardAccessClient.mjs';
import { createDashboardAuthorization } from '../server/dashboard-access.mjs';

const oldSession = { access_token: 'old', user: { id: 'approved-user' } };
const newSession = { access_token: 'new', user: { id: 'approved-user' } };
function fixture({ refreshError, refreshSession = newSession, responses = [401, 200] } = {}) {
  let current = oldSession;
  const calls = [], counts = { refreshes: 0 };
  const auth = {
    getSession: async () => ({ data: { session: current } }),
    refreshSession: async () => {
      counts.refreshes++;
      await new Promise(resolve => setTimeout(resolve, 5));
      if (refreshError) return { error: refreshError };
      current = refreshSession;
      return { data: { session: current } };
    },
  };
  const request = createDashboardAccessRequest({ auth, apiKey: 'anon', fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    const status = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Response.json(status === 200 ? { role: 'admin' } : { error: 'Request rejected' }, { status });
  } });
  return { request, auth, calls, counts, setSession: value => { current = value; } };
}

test('an expired access token is refreshed and the request succeeds without signing out', async () => {
  const f = fixture();
  assert.deepEqual(await f.request(), { role: 'admin' });
  assert.equal(f.counts.refreshes, 1);
  assert.deepEqual(f.calls.map(call => call.headers.Authorization), ['Bearer old', 'Bearer new']);
});

test('a second 401 stops after one refresh instead of retrying forever', async () => {
  const f = fixture({ responses: [401] });
  await assert.rejects(f.request(), error => error.status === 401);
  assert.equal(f.calls.length, 2);
  assert.equal(f.counts.refreshes, 1);
});

test('concurrent expired requests share one refresh', async () => {
  const f = fixture({ responses: [401, 401, 200, 200] });
  await Promise.all([f.request(), f.request()]);
  assert.equal(f.counts.refreshes, 1);
  assert.equal(f.calls.length, 4);
});

test('permission denial and service errors never refresh or replay mutations', async () => {
  for (const status of [403, 429, 503]) {
    const f = fixture({ responses: [status] });
    await assert.rejects(f.request('/api/dashboard-access', { action: 'revoke' }), error => error.status === status);
    assert.equal(f.counts.refreshes, 0);
    assert.equal(f.calls.length, 1);
  }
});

test('invalid refresh tokens require sign-in; refresh outages remain temporary', async () => {
  for (const [upstreamStatus, expected] of [[400, 401], [429, 503], [500, 503]]) {
    const f = fixture({ refreshError: { status: upstreamStatus } });
    await assert.rejects(f.request(), error => error.status === expected);
    assert.equal(f.calls.length, 1);
  }
});

test('a request cannot be replayed as a different signed-in user', async () => {
  const f = fixture({ refreshSession: { access_token: 'other-user-token', user: { id: 'another-user' } } });
  await assert.rejects(f.request('/api/dashboard-access', { action: 'revoke' }), error => error.status === 401);
  assert.equal(f.calls.length, 1);
});

test('a missing session and a cancelled request send nothing', async () => {
  const f = fixture();
  f.setSession(null);
  await assert.rejects(f.request(), error => error.status === 401);
  f.setSession(oldSession);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.request(undefined, undefined, controller.signal), error => error.name === 'AbortError');
  assert.equal(f.calls.length, 0);
});

test('server distinguishes invalid tokens from auth timeouts and outages before reading data', async () => {
  for (const [error, expected] of [[{ status: 403, code: 'bad_jwt' }, 401], [{ status: 500 }, 503], [{ status: 429 }, 503], [{ name: 'AuthRetryableFetchError' }, 503]]) {
    const access = createDashboardAuthorization({
      env: { VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'anon' },
      fetchImpl: () => { throw new Error('Unexpected network request'); },
      createClient: () => ({ auth: { getUser: async () => ({ error }) }, from: () => { throw new Error('Unauthorized database read'); } }),
    });
    await assert.rejects(access.authenticate({ headers: { authorization: 'Bearer fixture' } }), error => error.status === expected);
  }
});

test('server rejects unsigned requests and thrown upstream failures without granting access', async () => {
  const access = createDashboardAuthorization({
    env: { VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'anon' },
    createClient: () => ({ auth: { getUser: async () => { throw new Error('Connection timed out'); } } }),
  });
  await assert.rejects(access.authenticate({ headers: {} }), error => error.status === 401);
  await assert.rejects(access.authenticate({ headers: { authorization: 'Bearer fixture' } }), error => error.status === 503);
});
