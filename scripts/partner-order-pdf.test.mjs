import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createPartnerPdfArtworkClient, PartnerArtworkPendingError, PARTNER_ARTWORK_WAIT_PREFIX, partnerPdfRetryReady } from './partner-order-pdf.mjs';

const orderId = '00000000-0000-4000-a000-000000000001';
const frontId = '00000000-0000-4000-a000-000000000002';
const backId = '00000000-0000-4000-a000-000000000003';
const bytes = Buffer.from('approved-artwork-fixture');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const order = { id: orderId, status: 'PAID', payment_status: 'paid', quantity: 3, deck_quantity: 4,
  metadata: { partnerCartId: 'cart-fixture', source: 'mcp', deckQuantity: 4 }, card_data: [], card_images: [] };
const manifest = { order_id: orderId, cart_id: 'cart-fixture', status: 'paid', ready: true, files: [
  { id: backId, item_index: 0, side: 'back', quantity: 3, state: 'processed' },
  { id: frontId, item_index: 0, side: 'front', quantity: 3, state: 'stored' },
] };

function fixture(options = {}) {
  const calls = [];
  const env = { PARTNER_PLATFORM_ORIGIN: 'https://partner.example', PARTNER_INTERNAL_SECRET: 'fixture-only-'.repeat(4), ...options.env };
  const client = createPartnerPdfArtworkClient({ env, request: async (url, request) => {
    calls.push({ url, request });
    if (url.startsWith('https://artwork.example/')) {
      if (options.downloadError) throw new Error('DO-NOT-LOG-private-download-url');
      return new Response(options.bytes || bytes, { status: options.downloadStatus || 200 });
    }
    assert.equal(url, 'https://partner.example/api/internal/production');
    if (options.networkError) throw new Error('DO-NOT-LOG-internal-secret');
    if (options.httpStatus) return new Response('DO-NOT-LOG-response-body', { status: options.httpStatus });
    const body = JSON.parse(request.body);
    if (body.include_urls === false) return Response.json(options.manifest || manifest);
    if (options.blockFile) return new Response('private-body', { status: 409 });
    const file = manifest.files.find(file => file.id === body.file_id);
    return Response.json({ order_id: orderId, files: [{ ...file, sha256,
      url: `https://artwork.example/${file.id}?token=fixture-private-${calls.length}`, ...options.file }] });
  } });
  return { ...client, calls, env };
}

test('paid API/MCP orders use validated private front/back pairs and exact quantities, including prepaid orders with no card_data', async () => {
  for (const source of ['partner_api', 'mcp']) {
    const f = fixture();
    const prepared = await f.prepareOrder({ ...order, metadata: JSON.stringify({ ...order.metadata, source }) });
    assert.equal(prepared.card_data.length, 1);
    assert.equal(prepared.card_data[0].frontUrl, `partner-artwork:${orderId}/${frontId}`);
    assert.equal(prepared.card_data[0].backUrl, `partner-artwork:${orderId}/${backId}`);
    assert.equal(prepared.card_data[0].quantity, 3);
    assert.equal(prepared.deck_quantity, 1);
    assert.equal(prepared.card_data[0].finish, 'standard');
    assert.ok(!JSON.stringify(prepared).includes('https://'));
    assert.deepEqual(order.card_data, []);
    const body = JSON.parse(f.calls[0].request.body);
    assert.deepEqual(body, { order_id: orderId, include_urls: false, actor: 'daily-pdf-worker' });
  }
});

test('ordinary orders need no partner configuration and original finish is retained', async () => {
  const ordinary = { ...order, metadata: {} };
  const f = fixture({ env: { PARTNER_INTERNAL_SECRET: '' } });
  assert.equal(await f.prepareOrder(ordinary), ordinary);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.prepareOrder(order), /Configure/);
  const prepared = await fixture().prepareOrder({ ...order, card_data: JSON.stringify([{ finish: 'silver' }]) });
  assert.equal(prepared.card_data[0].finish, 'silver');
});

test('each image obtains a fresh URL, verifies its hash and sends no secret to storage', async () => {
  const f = fixture();
  const prepared = await f.prepareOrder(order);
  const reference = prepared.card_data[0].frontUrl;
  for (let i = 0; i < 2; i++) assert.deepEqual(await f.download(reference), bytes);
  assert.equal(f.calls.length, 5);
  const downloads = f.calls.filter(call => call.url.startsWith('https://artwork.example'));
  assert.notEqual(downloads[0].url, downloads[1].url);
  for (const call of downloads) {
    assert.equal(call.request.headers, undefined);
    assert.equal(call.request.redirect, 'error');
  }
  for (const call of f.calls.filter(call => call.url.startsWith('https://partner.example'))) {
    assert.equal(call.request.headers.Authorization, `Bearer ${f.env.PARTNER_INTERNAL_SECRET}`);
    assert.equal(call.request.redirect, 'error');
    assert.equal(call.request.headers.apikey, undefined);
  }
  await f.prepareOrder({ ...order, metadata: {} });
  await assert.rejects(f.download(reference), /not approved/);
});

test('rejects mismatched order/cart, quantities, incomplete pairs and duplicate or invalid slots', async () => {
  for (const invalid of [
    { ...manifest, order_id: backId }, { ...manifest, cart_id: 'wrong-cart' },
    { ...manifest, files: [] }, { ...manifest, files: manifest.files.slice(1) },
    { ...manifest, files: manifest.files.map(file => ({ ...file, quantity: 2 })) },
    { ...manifest, files: [...manifest.files, manifest.files[0]] },
    { ...manifest, files: manifest.files.map(file => ({ ...file, item_index: -1 })) },
  ]) await assert.rejects(fixture({ manifest: invalid }).prepareOrder(order));
  for (const payment_status of ['refunded', 'failed', 'cancelled']) {
    const f = fixture();
    await assert.rejects(f.prepareOrder({ ...order, payment_status }), /not printable/);
    assert.equal(f.calls.length, 0);
  }
  for (const status of ['shipped', 'cancelled', 'awaiting_payment']) {
    await assert.rejects(fixture({ manifest: { ...manifest, ready: false, status } }).prepareOrder(order), /blocked/);
  }
});

test('pending ingestion waits without an immediate continuation; errors never include response bodies or credentials', async () => {
  await assert.rejects(fixture({ manifest: { ...manifest, ready: false } }).prepareOrder(order), PartnerArtworkPendingError);
  await assert.rejects(fixture({ httpStatus: 404 }).prepareOrder(order), PartnerArtworkPendingError);
  const now = Date.now();
  const waiting = { error_message: `${PARTNER_ARTWORK_WAIT_PREFIX} waiting`, started_at: new Date(now).toISOString() };
  assert.equal(partnerPdfRetryReady(waiting, now), false);
  assert.equal(partnerPdfRetryReady(waiting, now + 300_000), true);
  assert.equal(partnerPdfRetryReady({ status: 'failed', error_message: 'ordinary failure' }, now), true);
  for (const options of [{ networkError: true }, { httpStatus: 500 }]) {
    await assert.rejects(fixture(options).prepareOrder(order), error => !error.message.includes('DO-NOT-LOG'));
  }
});

test('file-side blocks, wrong identity, bad checksums and failed downloads cannot produce a PDF image', async () => {
  for (const options of [
    { blockFile: true }, { file: { id: backId } }, { file: { item_index: 1 } },
    { file: { side: 'back' } }, { file: { quantity: 2 } }, { file: { sha256: null } },
    { bytes: Buffer.from('tampered bytes') }, { file: { url: 'http://artwork.example/insecure' } },
    { downloadError: true }, { downloadStatus: 403 },
  ]) {
    const f = fixture(options);
    await f.prepareOrder(order);
    await assert.rejects(f.download(`partner-artwork:${orderId}/${frontId}`), error =>
      !error.message.includes('DO-NOT-LOG') && !error.message.includes('token='));
  }
});
