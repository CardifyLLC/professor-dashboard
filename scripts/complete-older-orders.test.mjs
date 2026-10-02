import test from 'node:test';
import assert from 'node:assert/strict';
import { completeOlderOrders } from '../supabase/functions/complete-older-orders/update.mjs';
test('bulk completion filters paid/shipped at inclusive 14-day cutoff without page limits', async () => {
 const calls=[];const client={from(v){calls.push(['from',v]);return this},update(...a){calls.push(['update',...a]);return this},in(...a){calls.push(['in',...a]);return this},lte(...a){calls.push(['lte',...a]);return {count:12,error:null}}};
 assert.equal(await completeOlderOrders(client,new Date('2026-09-25T19:00:00Z')),12);
 assert.deepEqual(calls,[['from','orders'],['update',{status:'completed',completed_at:'2026-09-25T19:00:00.000Z'},{count:'exact'}],['in','status',['paid','shipped']],['lte','created_at','2026-09-11T19:00:00.000Z']]);
});
test('database failures are surfaced', async () => {
 const client={from(){return this},update(){return this},in(){return this},lte(){return {error:new Error('permission denied')}}};
 await assert.rejects(completeOlderOrders(client),/permission denied/);
});


test('browser sends authenticated POST instead of PATCH', async () => {
 const { completeOlderOrders: call } = await import('../src/services/completeOlderOrders.mjs');
 const count = await call('https://example.com/functions/v1/complete-older-orders', { Authorization: 'Bearer test' }, async (url, options) => {
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer test');
  assert.equal(options.body, '{}');
  return new Response(JSON.stringify({ count: 3 }));
 });
 assert.equal(count, 3);
});
