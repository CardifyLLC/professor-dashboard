import assert from 'node:assert/strict';
import test from 'node:test';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { downloadOrderPdfs, getOrderPdfPaths } from '../src/services/orderPdfDownloads.mjs';

const generation = (id = 'order-one', parts = 1) => ({
    order_id: id, status: 'completed', total_parts: parts,
    storage_path: `${id}/part-1.pdf`,
    storage_paths: Array.from({ length: parts }, (_, index) => `${id}/part-${index + 1}.pdf`),
});
function fixture() {
    const events = [];
    return {
        events,
        createUrls: async paths => paths.map(path => `https://storage.example/${path}`),
        fetchFile: async url => { events.push(['fetch', url]); return new Response('%PDF-1.7\ntest'); },
        saveFile: async (blob, filename) => { assert.ok(blob.size); events.push(['save', filename]); },
        recordDownloaded: async ids => { events.push(['record', ids]); return ids.map(order_id => ({ order_id, downloaded_at: '2026-10-05T18:00:00Z' })); },
    };
}

test('single PDF is fetched and saved before its persisted confirmation', async () => {
    const f = fixture();
    const result = await downloadOrderPdfs([generation()], f);
    assert.deepEqual(f.events.map(event => event[0]), ['fetch', 'save', 'record']);
    assert.equal(f.events[1][1], 'order-order-one.pdf');
    assert.equal(result.filesDownloaded, 1);
    assert.equal(result.records[0].downloaded_at, '2026-10-05T18:00:00Z');
});

test('multipart order is recorded once, only after every part has been received and saved', async () => {
    const f = fixture();
    const progress = [];
    await downloadOrderPdfs([generation('multi', 2)], { ...f, onProgress: value => progress.push(value) });
    assert.deepEqual(f.events.map(event => event[0]), ['fetch', 'save', 'fetch', 'save', 'record']);
    assert.deepEqual(f.events.filter(event => event[0] === 'save').map(event => event[1]), ['order-multi-part-1-of-2.pdf', 'order-multi-part-2-of-2.pdf']);
    assert.deepEqual(progress, [{ completed: 1, total: 2 }, { completed: 2, total: 2 }]);
});

test('HTTP failures and interrupted or invalid file bodies never record a download', async () => {
    for (const fetchFile of [
        async () => new Response('denied', { status: 403 }),
        async () => { throw new Error('Connection interrupted'); },
        async () => new Response('<html>Sign in</html>'),
        async () => new Response(''),
        async () => ({ ok: true, blob: async () => { throw new Error('Body interrupted'); } }),
    ]) {
        const f = fixture();
        await assert.rejects(downloadOrderPdfs([generation()], { ...f, fetchFile }));
        assert.equal(f.events.some(event => event[0] === 'record' || event[0] === 'save'), false);
    }
});

test('a failed later part leaves that order unmarked while earlier complete orders remain recorded', async () => {
    const f = fixture();
    await assert.rejects(downloadOrderPdfs([generation('first'), generation('second', 2)], {
        ...f,
        fetchFile: async url => url.endsWith('second/part-2.pdf') ? new Response('failed', { status: 500 }) : f.fetchFile(url),
    }), /HTTP 500/);
    assert.deepEqual(f.events.filter(event => event[0] === 'record'), [['record', ['first']]]);
    assert.equal(f.events.filter(event => event[0] === 'save').length, 2);
});

test('save failures do not mark downloaded; database failures report the unsaved confirmation', async () => {
    const f = fixture();
    await assert.rejects(downloadOrderPdfs([generation()], { ...f, saveFile: async () => { throw new Error('Saving failed'); } }), /Saving failed/);
    assert.equal(f.events.some(event => event[0] === 'record'), false);
    await assert.rejects(downloadOrderPdfs([generation()], { ...fixture(), recordDownloaded: async () => { throw new Error('Permission denied'); } }), /PDF downloaded, but its confirmation could not be saved: Permission denied/);
});

test('incomplete PDF parts and missing signed links cannot produce a confirmation', async () => {
    assert.deepEqual(getOrderPdfPaths({ order_id: 'legacy', status: 'completed', storage_path: 'legacy.pdf' }), ['legacy.pdf']);
    for (const broken of [
        { ...generation(), status: 'processing' },
        { ...generation(), total_parts: 2 },
        { ...generation(), storage_path: null, storage_paths: [] },
    ]) assert.throws(() => getOrderPdfPaths(broken), /not fully ready/);
    const f = fixture();
    await assert.rejects(downloadOrderPdfs([generation('multi', 2)], { ...f, createUrls: async () => ['one'] }), /all PDF download links/);
    assert.deepEqual(f.events, []);
});

// Test the actual service against a fake PostgREST response, without live data.
const filename = fileURLToPath(new URL('./pdf-download-service-fixture.cjs', import.meta.url));
const bundled = await build({
    stdin: { contents: `export { markOrderPdfsDownloaded, fetchOrderPdfGenerations, fetchOrderPdfGeneration } from './src/services/orderService.js';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'fake-database', setup(builder) {
        builder.onLoad({ filter: /[/\\]supabaseClient\.js$/ }, () => ({ contents: `
            export const supabase = { from(table) {
                const f = globalThis.pdfDownloadFixture;
                f.calls.push(['from', table]);
                const q = {};
                for (const method of ['update','select','in','eq']) q[method] = (...args) => { f.calls.push([method,...args]); return q; };
                q.maybeSingle = async () => f.result;
                q.then = (resolve,reject) => Promise.resolve(f.result).then(resolve,reject);
                return q;
            } };
            export const supabaseAdmin = supabase;
            export const getAdminAuthHeaders = async () => ({Authorization: 'Bearer fixture-admin'});
        `, loader: 'js' }));
    } }],
});
const module = new Module(filename);
module.filename = filename;
module.paths = Module._nodeModulePaths(fileURLToPath(new URL('..', import.meta.url)));
module.require = createRequire(filename);
module._compile(bundled.outputFiles[0].text, filename);
const service = module.exports;

test('browser records through same-origin POST with admin auth, never a Supabase PATCH', async t => {
    const row = { order_id: 'one', downloaded_at: '2026-10-05T18:00:00Z' };
    const f = globalThis.pdfDownloadFixture = { calls: [] };
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, options });
        return Response.json({ downloads: [row] });
    });
    assert.deepEqual(await service.markOrderPdfsDownloaded(['one', 'one']), [row]);
    assert.equal(requests[0].url, '/api/order-pdf-downloads');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer fixture-admin');
    assert.deepEqual(JSON.parse(requests[0].options.body), { orderIds: ['one'] });
    assert.deepEqual(f.calls, []);
});

test('browser does not invent confirmation after a server error or missing records', async t => {
    for (const response of [Response.json({ error: 'Admin required' }, { status: 403 }), Response.json({ downloads: [] }), Response.json({ downloads: {} }), new Response('<html>Missing endpoint</html>', { status: 404 })]) {
        t.mock.method(globalThis, 'fetch', async () => response);
        await assert.rejects(service.markOrderPdfsDownloaded(['one']));
    }
});

test('list and detail reads include the persisted download timestamp, including after a reload', async () => {
    const rows = [{ order_id: 'one', status: 'completed', downloaded_at: '2026-10-05T18:00:00Z' }];
    const f = globalThis.pdfDownloadFixture = { calls: [], result: { data: rows, error: null } };
    assert.deepEqual(await service.fetchOrderPdfGenerations(['one']), rows);
    f.result = { data: rows[0], error: null };
    assert.deepEqual(await service.fetchOrderPdfGeneration('one'), rows[0]);
    assert.equal(f.calls.filter(call => call[0] === 'select').length, 2);
    for (const call of f.calls.filter(call => call[0] === 'select')) assert.match(call[1], /downloaded_at/);
});
