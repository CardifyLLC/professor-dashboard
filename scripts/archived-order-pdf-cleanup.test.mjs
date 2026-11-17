import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { cleanQueueRow, cleanupAuthorized } from '../supabase/functions/storage_cleanup_queue/cleanup.mjs';
const id = '00000000-0000-4000-8000-000000000001';
const row = { id: 1, bucket_id: 'order-pdfs', path_prefix: id };

test('alternate service JWT must pass a server check; unsigned claims never grant access', async () => {
  const token = claims => `test.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  let probes = 0;
  const options = { url: 'https://project.supabase.co', key: 'runtime-key', fetchImpl: async () => { probes++; return new Response('[]', { status: 401 }); } };
  const req = role => new Request('https://local.test', { headers: { Authorization: `Bearer ${token({ role, ref: 'project' })}` } });
  assert.equal(await cleanupAuthorized(req('authenticated'), options), false);
  assert.equal(probes, 0);
  assert.equal(await cleanupAuthorized(req('service_role'), options), false);
  assert.equal(probes, 1);
  assert.equal(await cleanupAuthorized(req('service_role'), { ...options, fetchImpl: async () => new Response('[]') }), true);
});

function fake({ archive = { order_id: id, status: 'completed' }, active = false, lookupError = false, restoreOnCheck = 0, count = 3, failDelete = false, failSave = false } = {}) {
  let checks = 0, saved = false;
  const removed = [];
  const objects = new Map(Array.from({ length: count }, (_, i) => [`${id}/${String(i).padStart(5, '0')}.pdf`, 10]));
  objects.set(`${id}/front.png`, 20);
  objects.set(`${id}/manifest.json`, 30);
  objects.set('unrelated-order/keep.pdf', 50);
  const db = {
    from(table) {
      return {
        select() { return this; }, eq() { return this; },
        maybeSingle() {
          if (lookupError) return { data: null, error: { message: 'offline' } };
          if (table === 'deleted_orders_archive') return { data: archive };
          checks++;
          return { data: active || (restoreOnCheck && checks >= restoreOnCheck) ? { id } : null };
        },
        update() { return this; },
        is() { saved = !failSave; return { error: failSave ? new Error('offline') : null }; },
      };
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'order-pdfs');
      return {
        list(prefix, { offset = 0, limit }) {
          const names = [...objects.keys()].filter(p => p.startsWith(prefix + '/')).sort();
          return { data: names.slice(offset, offset + limit).map(path => ({ id: path, name: path.slice(prefix.length + 1), metadata: { size: objects.get(path) } })) };
        },
        remove(paths) {
          if (failDelete) return { error: new Error('offline') };
          assert(paths.length <= 100);
          paths.forEach(p => { assert(p.startsWith(id + '/') && p.endsWith('.pdf')); objects.delete(p); removed.push(p); });
          return { data: paths.map(name => ({ name })) };
        },
      };
    } },
  };
  return { db, objects, removed, saved: () => saved };
}

test('removes only archived PDFs, preserves images, manifests and other folders', async () => {
  const f = fake();
  assert.equal((await cleanQueueRow(f.db, row)).deleted, 3);
  assert.equal(f.objects.size, 3);
  assert.equal(f.saved(), true);
});
for (const [label, options] of Object.entries({ active: { active: true }, unarchived: { archive: null }, incomplete: { archive: { status: 'paid' } }, offline: { lookupError: true } })) {
  test(`fails closed for ${label} order`, async () => {
    const f = fake(options);
    await assert.rejects(cleanQueueRow(f.db, row));
    assert.equal(f.removed.length, 0);
    assert.equal(f.saved(), false);
  });
}
test('rechecks restoration immediately before deletion', async () => {
  const f = fake({ restoreOnCheck: 2 });
  await assert.rejects(cleanQueueRow(f.db, row), /still exists/);
  assert.equal(f.removed.length, 0);
});
test('dry run does not remove objects or complete the queue entry', async () => {
  const f = fake();
  assert.deepEqual(await cleanQueueRow(f.db, row, { dryRun: true }), { id: 1, candidates: 3, bytes: 30, deleted: 0 });
  assert.equal(f.removed.length, 0);
  assert.equal(f.saved(), false);
});
test('lists all pages before deleting and respects Storage batch limits', async () => {
  const f = fake({ count: 1205 });
  assert.equal((await cleanQueueRow(f.db, row)).deleted, 1205);
  assert.equal(f.objects.size, 3);
});
test('failed removal never completes the queue entry', async () => {
  const f = fake({ failDelete: true });
  await assert.rejects(cleanQueueRow(f.db, row), /not confirmed/);
  assert.equal(f.saved(), false);
});
test('retries after a failed completion write without deleting unrelated files', async () => {
  const f = fake({ failSave: true });
  await assert.rejects(cleanQueueRow(f.db, row), /record cleanup/);
  assert.equal(f.objects.size, 3);
  await assert.rejects(cleanQueueRow(f.db, row), /record cleanup/);
  assert.equal(f.removed.length, 3);
});
test('rejects broad or traversing PDF prefixes', async () => {
  for (const prefix of ['', '../', id + '/..', id + '/', 'anything']) {
    const f = fake();
    await assert.rejects(cleanQueueRow(f.db, { ...row, path_prefix: prefix }));
    assert.equal(f.removed.length, 0);
  }
});

test('migration preserves retention and analytics, archives before deletion, and backfills only proven PDF folders', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA storage;
      CREATE FUNCTION public.is_dashboard_admin() RETURNS boolean LANGUAGE sql AS 'SELECT false';
      CREATE TABLE storage.objects (bucket_id text, name text, metadata jsonb);
      CREATE TABLE public.orders (id uuid PRIMARY KEY, stripe_session_id text, status text,
        payment_status text,total_amount_cents int,currency text,customer_email text,customer_name text,
        quantity int,metadata jsonb,created_at timestamptz,completed_at timestamptz);
      CREATE TABLE public.order_daily_stats (stat_date date PRIMARY KEY,total_orders int,completed_orders int,
        cancelled_orders int,paid_orders int,pending_orders int,gross_revenue_cents bigint,
        refunded_amount_cents bigint,net_revenue_cents bigint,total_cards int,customers jsonb,updated_at timestamptz);
    `);
    const migration = await readFile(new URL('../supabase/migrations/20261116210801_archived_order_pdf_cleanup.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(`INSERT INTO orders VALUES ('${id}',null,'completed','paid',100,'usd','test@example.invalid','Test',2,
      '{"tempOrderId":"guest-folder"}', now()-interval '30 days',now()-interval '15 days');
      INSERT INTO orders SELECT '00000000-0000-4000-8000-000000000002',null,'completed','paid',200,'usd',
      'test2@example.invalid','Test',3,'{}',now()-interval '30 days',now()-interval '1 day';
      INSERT INTO storage.objects VALUES ('order-pdfs','${id}/part.pdf','{}'),
      ('order-pdfs','unknown/part.pdf','{}'),('order-images','guest-folder/front.png','{}');`);
    await db.query('SELECT public.purge_completed_orders()');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM deleted_orders_archive')).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM storage_cleanup_queue WHERE bucket_id='order-pdfs'")).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM storage.objects')).rows[0].n, 3);
    await db.exec(migration); // Safe to reapply; no duplicate queue rows.
    await db.query('SELECT public.purge_completed_orders()');
    assert.equal((await db.query('SELECT sum(total_orders)::int AS n FROM order_daily_stats')).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM storage_cleanup_queue WHERE bucket_id='order-pdfs'")).rows[0].n, 1);
    // Even with an archive, a restored active order must not be backfilled.
    await db.exec(`DELETE FROM storage_cleanup_queue WHERE bucket_id='order-pdfs';
      INSERT INTO orders(id,status) VALUES ('${id}','paid'); SELECT public.enqueue_archived_order_pdfs();`);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM storage_cleanup_queue WHERE bucket_id='order-pdfs'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT has_function_privilege('anon','public.purge_completed_orders()','EXECUTE') AS allowed")).rows[0].allowed, false);
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.deleted_orders_archive','SELECT') AS allowed")).rows[0].allowed, true);
  } finally { await db.close(); }
});
