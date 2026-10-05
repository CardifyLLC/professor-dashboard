import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrderPdfDownloadsHandler } from '../server/order-pdf-downloads.mjs';
import deployedHandler from '../api/order-pdf-downloads.js';

const orderId = '00000000-0000-4000-a000-000000000001';
const adminId = '00000000-0000-4000-a000-000000000002';
const timestamp = '2026-10-05T18:30:00.000Z';
function fixture(options = {}) {
    const calls = [], updates = [];
    const createClient = (url, key, settings) => {
        calls.push({ url, key, settings });
        return {
            auth: { getUser: async token => {
                assert.equal(token, 'admin-token');
                return options.invalidToken ? { error: new Error('Invalid token') } : { data: { user: { id: adminId } } };
            } },
            from(table) {
                const filters = {}; let changes;
                const result = () => {
                    if (table === 'dashboard_admins') {
                        assert.equal(filters.user_id, adminId);
                        assert.equal(filters.enabled, true);
                        return { data: options.nonAdmin ? null : { user_id: adminId } };
                    }
                    assert.equal(table, 'order_pdf_generations');
                    updates.push({ filters, changes });
                    return { data: options.noRows ? [] : [{ order_id: orderId, downloaded_at: timestamp }], error: options.dbError };
                };
                const q = {
                    select() { return q; },
                    eq(name, value) { filters[name] = value; return q; },
                    in(name, values) { filters[name] = values; return q; },
                    update(value) { changes = value; return q; },
                    maybeSingle: async () => result(),
                    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
                };
                return q;
            },
        };
    };
    const handler = createOrderPdfDownloadsHandler({ createClient, now: () => new Date(timestamp), env: { VITE_SUPABASE_URL: 'https://db.example', VITE_SUPABASE_ANON_KEY: 'public-key', ...options.env } });
    return { calls, updates, request: (body = { orderIds: [orderId] }, extra = {}) => invoke(handler, { method: 'POST', headers: { authorization: 'Bearer admin-token' }, body, ...extra }) };
}
async function invoke(handler, request) {
    const headers = {}; let status, body;
    await handler(request, { setHeader: (key, value) => { headers[key] = value; }, set statusCode(value) { status = value; }, end: value => { body = JSON.parse(value); } });
    return { status, body, headers };
}

test('deployed entry point starts and rejects unauthenticated requests without database access', async () => {
    const response = await invoke(deployedHandler, { method: 'POST', headers: {}, body: {} });
    assert.equal(response.status, 401);
});

test('rejects wrong method, absent or expired token, and non-admin users before updating', async () => {
    for (const [options, extra, status] of [[{}, { method: 'GET' }, 405], [{}, { headers: {} }, 401], [{ invalidToken: true }, {}, 401], [{ nonAdmin: true }, {}, 403]]) {
        const f = fixture(options);
        assert.equal((await f.request(undefined, extra)).status, status);
        assert.deepEqual(f.updates, []);
    }
});

test('keeps user RLS, uses server time, and only updates completed PDFs for the supplied IDs', async () => {
    const f = fixture();
    const result = await f.request({ orderIds: [orderId, orderId], userId: 'forged', downloaded_at: '1900-01-01', status: 'completed', table: 'orders' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.equal(f.calls[0].key, 'public-key');
    assert.equal(f.calls[0].settings.global.headers.Authorization, 'Bearer admin-token');
    assert.deepEqual(f.updates, [{ filters: { order_id: [orderId], status: 'completed' }, changes: { downloaded_at: timestamp, updated_at: timestamp } }]);
    assert.deepEqual(result.body.downloads, [{ order_id: orderId, downloaded_at: timestamp }]);
});

test('rejects invalid input and oversized batches or bodies without updates', async () => {
    for (const [body, status] of [[null, 400], [{}, 400], [{ orderIds: [] }, 400], [{ orderIds: ['not-an-id'] }, 400], [{ orderIds: [123] }, 400], [{ orderIds: Array(201).fill(orderId) }, 400], ['invalid JSON', 400], [{ orderIds: [orderId], excess: 'x'.repeat(16000) }, 413]]) {
        const f = fixture();
        assert.equal((await f.request(body)).status, status);
        assert.deepEqual(f.updates, []);
    }
    assert.equal((await fixture().request(JSON.stringify({ orderIds: [orderId] }))).status, 200);
});

test('database errors, missing completed rows and missing configuration never report success', async () => {
    for (const [options, status] of [[{ noRows: true }, 409], [{ dbError: { code: '42501' } }, 403], [{ dbError: new Error('database unavailable') }, 502], [{ env: { VITE_SUPABASE_URL: '' } }, 503]]) {
        const result = await fixture(options).request();
        assert.equal(result.status, status);
        assert.ok(result.body.error);
        assert.equal(result.body.downloads, undefined);
    }
});
