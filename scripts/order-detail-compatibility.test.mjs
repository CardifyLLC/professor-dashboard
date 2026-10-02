import assert from 'node:assert/strict';
import test from 'node:test';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { attachPartnerArtwork } from '../src/services/partnerArtwork.mjs';

// Render the real components with server-side React. Database/network access
// is forbidden in these fixtures, so ordinary image rendering cannot silently
// acquire a dependency on the partner service.
const filename = fileURLToPath(new URL('./order-detail-fixture.cjs', import.meta.url));
const result = await build({
  stdin: {
    contents: `export { default as OrderDetail } from './src/components/OrderDetail.jsx';
      export { default as OrderImage } from './src/components/OrderImage.jsx';
      export { loadPartnerArtwork, resolveOrderImage } from './src/services/partnerOrders.js';
      export { getOrderImageUrl } from './src/services/orderService.js';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://fixture.example', VITE_SUPABASE_ANON_KEY: 'fixture' }) },
  plugins: [{ name: 'no-live-services', setup(builder) {
    builder.onLoad({ filter: /[/\\]supabaseClient\.js$/ }, () => ({
      contents: `const forbidden = () => { throw new Error('Unexpected service access'); };
        export const supabase = {from:forbidden, storage:{from:forbidden}};
        export const supabaseAdmin = supabase;
        export const getAdminAuthHeaders = forbidden;`, loader: 'js',
    }));
  }}],
});
const fixture = new Module(filename);
fixture.filename = filename;
fixture.paths = Module._nodeModulePaths(fileURLToPath(new URL('..', import.meta.url)));
fixture.require = createRequire(filename);
fixture._compile(result.outputFiles[0].text, filename);
const { OrderDetail, OrderImage, loadPartnerArtwork, resolveOrderImage, getOrderImageUrl } = fixture.exports;

const orderId = '00000000-0000-4000-a000-000000000001';
const regular = {
  id: orderId, status: 'paid', payment_status: 'paid', quantity: 1, total: 7.3,
  created_at: '2026-10-02T12:00:00Z', metadata: {},
  shipping_address: { name: 'Fixture Customer', city: 'New York', country: 'US' },
  card_images: ['https://example.com/front.png', 'https://example.com/back.png'],
  card_data: [{ finish: 'standard', quantity: 1 }],
};

test('regular orders retain their existing card count, show-cards and ZIP controls', () => {
  for (const serialized of [false, true]) {
    const order = serialized ? { ...regular, card_images: JSON.stringify(regular.card_images), card_data: JSON.stringify(regular.card_data) } : regular;
    const html = renderToStaticMarkup(React.createElement(OrderDetail, { order }));
    assert.match(html, /Card Images \(1 Cards\)/);
    assert.match(html, /Show Cards/);
    assert.match(html, /Download Zip/);
    assert.doesNotMatch(html, /Partner API order|Refresh \/ prepare artwork/);
  }
});

test('regular images and orders pass through without contacting the partner API', async () => {
  assert.equal(await loadPartnerArtwork(regular), regular);
  for (const src of ['https://example.com/front.png', 'data:image/png;base64,fixture', 'blob:fixture']) {
    assert.equal(await resolveOrderImage(src), src);
    assert.equal(getOrderImageUrl(src), src);
    const html = renderToStaticMarkup(React.createElement(OrderImage, { src, alt: 'Front', loading: 'lazy', className: 'card-image' }));
    assert.ok(html.includes(`src="${src}"`));
    assert.match(html, /loading="lazy"/);
    assert.match(html, /class="card-image"/);
  }
});

test('API order details show the private card count even with an empty legacy image array', () => {
  const order = attachPartnerArtwork({ ...regular, metadata: { partnerCartId: 'cart_fixture' }, card_images: [] }, {
    ready: true, status: 'paid', files: [
      { id: '00000000-0000-4000-a000-000000000002', item_index: 0, side: 'front', quantity: 1, state: 'stored' },
      { id: '00000000-0000-4000-a000-000000000003', item_index: 0, side: 'back', quantity: 1, state: 'stored' },
    ],
  });
  const html = renderToStaticMarkup(React.createElement(OrderDetail, { order }));
  assert.match(html, /Card Images \(1 Cards\)/);
  assert.match(html, /Partner API order/);
  assert.match(html, /Show Cards/);
  assert.match(html, /Download Zip/);
  assert.doesNotMatch(html, /PDF failed/);
  for (const src of [order.card_data[0].frontUrl, order.card_data[0].backUrl]) {
    const image = renderToStaticMarkup(React.createElement(OrderImage, { src, alt: 'Private artwork' }));
    assert.match(image, /Loading artwork/);
    assert.doesNotMatch(image, /<img|partner-artwork:/);
  }
});
