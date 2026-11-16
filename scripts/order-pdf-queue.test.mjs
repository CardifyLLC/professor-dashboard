import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { readPdfJobsForOrders } from './order-pdf-queue.mjs';

const ids = Array.from({ length: 1000 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
function client(fetch) {
  return createClient('https://queue-test.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
  });
}
function selectedIds(url) {
  return url.searchParams.get('order_id').slice(4, -1).split(',');
}

test('414 and 1000 orders use bounded URLs and return every job', async () => {
  for (const count of [414, 1000]) {
    const requested = [];
    const db = client(async input => {
      const url = new URL(input);
      assert.ok(url.href.length < 5000, `Oversized PDF queue request: ${url.href.length} bytes`);
      assert.equal(url.searchParams.get('select'), 'order_id');
      const batch = selectedIds(url);
      requested.push(...batch);
      return Response.json(batch.map(order_id => ({ order_id })));
    });
    const jobs = await readPdfJobsForOrders(db, ids.slice(0, count), { select: 'order_id' });
    assert.deepEqual(requested, ids.slice(0, count));
    assert.deepEqual(jobs.map(job => job.order_id), ids.slice(0, count));
  }
});

test('pending lookups retain completed-job and retry exclusions on every batch', async () => {
  const requested = [];
  const db = client(async input => {
    const url = new URL(input);
    assert.ok(url.href.length < 5000);
    assert.equal(url.searchParams.get('status'), 'neq.completed');
    assert.equal(url.searchParams.get('attempt_count'), 'lt.5');
    const batch = selectedIds(url);
    requested.push(...batch);
    return Response.json(batch.map(order_id => ({ order_id, status: 'processing', attempt_count: 0 })));
  });
  const jobs = await readPdfJobsForOrders(db, [...ids.slice(0, 205), ids[0]], { maxAttempts: 5 });
  assert.deepEqual(requested, ids.slice(0, 205));
  assert.equal(jobs.length, 205);
});

test('a later batch failure stops discovery instead of returning an incomplete queue', async () => {
  let requests = 0;
  const db = client(async input => {
    if (++requests === 2) return Response.json({ message: 'Queue unavailable', code: 'TEST' }, { status: 403 });
    return Response.json(selectedIds(new URL(input)).map(order_id => ({ order_id })));
  });
  await assert.rejects(readPdfJobsForOrders(db, ids), /PDF queue lookup failed: Queue unavailable/);
  assert.equal(requests, 2);
});

test('an empty order list makes no database request', async () => {
  const db = client(() => { throw new Error('Unexpected request'); });
  assert.deepEqual(await readPdfJobsForOrders(db, []), []);
});
