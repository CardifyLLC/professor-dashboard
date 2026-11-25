import assert from 'node:assert/strict';
import test from 'node:test';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getApiPrintCredits } from '../src/services/apiPrintCredits.mjs';

const order = {
  id: '00000000-0000-4000-a000-000000000001',
  customer_name: 'Credit Fixture Customer', customer_email: 'customer@example.test',
  status: 'paid', payment_status: 'paid', payment_source: 'partner_credit', payment_provider: 'partner_credit',
  created_at: '2026-11-25T12:00:00Z', total_amount_cents: 2475, quantity: 30,
  pricing_snapshot: { credit_cents: 1600, customer_payment_cents: 875 },
  metadata: { partnerCartId: 'cart-fixture', partnerId: 'partner-fixture', prepaidFundingModel: 'cards_credit' },
  shipping_address: { name: 'Credit Fixture Customer', city: 'New York', country: 'US' },
  card_images: [], card_data: [],
};
const filename = fileURLToPath(new URL('./api-credit-fixture.cjs', import.meta.url));
const result = await build({
  stdin: {
    contents: `export { default as OrderList } from './src/components/OrderList.jsx';
      export { default as OrderDetail } from './src/components/OrderDetail.jsx';
      export { default as ApiPrintCredits } from './src/components/ApiPrintCredits.jsx';
      export { fetchOrders } from './src/services/orderService.js';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://fixture.example', VITE_SUPABASE_ANON_KEY: 'fixture' }) },
  plugins: [{ name: 'fixture-order-database', setup(builder) {
    builder.onLoad({ filter: /[/\\]supabaseClient\.js$/ }, () => ({
      contents: `const row = ${JSON.stringify(order)};
        const forbidden = () => { throw new Error('Unexpected service access'); };
        export const supabase = {storage:{from:forbidden},from(table) {
          if (table !== 'orders') return forbidden();
          let fields = [];
          return {select(value) {fields=value.split(',').map(field=>field.trim());return this;},
            order() {return this;},
            range() {return Promise.resolve({data:[Object.fromEntries(fields.map(field=>[field,row[field]]))],count:1,error:null});}};
        }};
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
const { OrderList, OrderDetail, ApiPrintCredits, fetchOrders } = fixture.exports;
const previousWindow = globalThis.window;
test.before(() => { globalThis.window = { location: { href: 'https://dashboard.example.test/' } }; });
test.after(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});
const render = (data, detailed = false) => renderToStaticMarkup(React.createElement(ApiPrintCredits, { order: data, detailed }));

test('orders query supplies credit fields and list identifies the customer and exact credit charge', async () => {
  const { data, count } = await fetchOrders();
  assert.equal(count, 1);
  const html = renderToStaticMarkup(React.createElement(OrderList, {
    orders: data, page: 1, pageSize: 20, totalCount: 1, activeStatus: 'all',
  }));
  assert.match(html, /Credit Fixture Customer/);
  assert.match(html, /customer@example.test/);
  assert.match(html, /API print credits/);
  assert.match(html, /\$16\.00 used/);
  assert.doesNotMatch(html, /\$24\.75 used/);
});

test('order details show split payment and identify the partner account', () => {
  const html = renderToStaticMarkup(React.createElement(OrderDetail, { order }));
  assert.match(html, /Credits used<\/dt><dd>\$16\.00/);
  assert.match(html, /Separate customer payment<\/dt><dd>\$8\.75/);
  assert.match(html, /Partner account ID<\/dt><dd>partner-fixture/);
});

test('ordinary API orders and customer PRINTS wallet orders are not labelled as partner credit', () => {
  for (const source of ['stripe', 'prints', null]) {
    const other = { ...order, payment_source: source, payment_provider: 'stripe', wallet_prints_spent: 1600 };
    assert.equal(getApiPrintCredits(other), null);
    assert.equal(render(other), '');
  }
});

test('legacy all-credit orders use the recorded charge and show a zero customer payment', () => {
  const legacy = { ...order, metadata: {}, payment_source: null,
    pricing_snapshot: { credit_cents: '2475', customer_payment_cents: 0 } };
  assert.match(render(legacy), /\$24\.75 used/);
  assert.match(render(legacy, true), /Separate customer payment<\/dt><dd>\$0\.00/);
});

test('missing and invalid credit amounts stay unknown instead of becoming zero or order total', () => {
  for (const value of [undefined, null, '', ' ', false, {}, -1, 1.25, 'unknown', Infinity]) {
    const html = render({ ...order, pricing_snapshot: { credit_cents: value } });
    assert.match(html, /Amount unavailable/);
    assert.doesNotMatch(html, /\$0\.00|\$24\.75| used/);
  }
  assert.match(render({ ...order, pricing_snapshot: { credit_cents: 0 } }), /\$0\.00 used/);
});

test('refunded orders show original charges, not current credit spending', () => {
  for (const refund of [{ payment_status: 'refunded' }, { refunded_at: '2026-11-25T13:00:00Z' }]) {
    const refunded = { ...order, ...refund };
    assert.match(render(refunded), /\$16\.00 originally charged/);
    assert.match(render(refunded, true), /Original credit charge/);
    assert.match(render(refunded, true), /Order refunded/);
    assert.doesNotMatch(render(refunded), /\$16\.00 used/);
  }
});

test('cancelled and pending orders do not claim a refund or a completed payment', () => {
  const cancelled = render({ ...order, status: 'cancelled' });
  assert.match(cancelled, /Order cancelled · check refund status/);
  assert.doesNotMatch(cancelled, /Order refunded|\$16\.00 used/);
  const pending = render({ ...order, status: 'pending', payment_status: 'pending' });
  assert.match(pending, /\$16\.00 quoted/);
  assert.match(pending, /Payment not confirmed/);
});

test('serialized legacy snapshots and metadata display safely', () => {
  const serialized = { ...order, pricing_snapshot: JSON.stringify(order.pricing_snapshot), metadata: JSON.stringify(order.metadata) };
  assert.match(render(serialized, true), /partner-fixture/);
  assert.match(render(serialized), /\$16\.00 used/);
  assert.match(render({ ...order, pricing_snapshot: 'malformed' }), /Amount unavailable/);
});
