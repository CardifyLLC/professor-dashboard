import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import sharp from 'sharp';
import { PDFDocument, decodePDFRawStream } from 'pdf-lib';

const orderId = '00000000-0000-4000-a000-000000000001';
const frontId = '00000000-0000-4000-a000-000000000002';
const backId = '00000000-0000-4000-a000-000000000003';
const mm = value => value * 25.4 / 72;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

async function runWorker(t, scenario) {
  const image = async (label, color) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="670" height="920"><rect width="670" height="920" fill="${color}"/><text x="40" y="80" font-size="36" fill="white">PARTNER ${label}</text><text x="40" y="150" font-size="28" fill="white">SYNTHETIC PDF TEST</text></svg>`)).png().toBuffer();
  const images = new Map([[frontId, await image('FRONT', '#165c88')], [backId, await image('BACK', '#6d451d')]]);
  const f = globalThis.partnerPdfWorkerFixture = {
    order: { id: orderId, status: 'paid', payment_status: 'paid', quantity: 20, deck_quantity: 3,
      customer_name: 'API / MCP TEST - NOT A CUSTOMER ORDER', metadata: { partnerCartId: 'test-cart', source: 'mcp' }, card_data: [], card_images: [] },
    jobs: scenario === 'completed' ? [{ order_id: orderId, status: 'completed', attempt_count: 1, storage_path: 'existing.pdf' }] : [],
    updates: [], inserts: [], uploads: [], requests: [],
  };
  const env = { SUPABASE_URL: 'https://main-fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only-not-a-real-key',
    PARTNER_PLATFORM_ORIGIN: 'https://partner.example', PARTNER_INTERNAL_SECRET: 'fixture-only-'.repeat(4),
    GITHUB_WORKFLOW_TOKEN: undefined, GITHUB_REPOSITORY_NAME: undefined, ORDER_PDF_WEBHOOK_SECRET: 'test-no-customer-emails', MAX_ORDERS: '3', MAX_ATTEMPTS: '5' };
  const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const directory = await mkdtemp(join(tmpdir(), 'partner-pdf-worker-test-'));
  const entry = join(directory, 'worker.mjs');
  t.after(async () => {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    delete globalThis.partnerPdfWorkerFixture;
    await unlink(entry).catch(() => {}); await rmdir(directory);
  });
  const files = [frontId, backId].map((id, index) => ({ id, item_index: 0, side: index ? 'back' : 'front', quantity: 20, state: 'stored' }));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    f.requests.push({ url, options });
    if (url === 'https://partner.example/api/internal/production') {
      assert.equal(options.headers.Authorization, `Bearer ${env.PARTNER_INTERNAL_SECRET}`);
      const body = JSON.parse(options.body);
      assert.equal(body.order_id, orderId);
      if (body.include_urls === false) return Response.json({ order_id: orderId, cart_id: 'test-cart', status: 'paid', ready: scenario !== 'waiting', files });
      const file = files.find(file => file.id === body.file_id);
      assert.ok(file);
      const bytes = images.get(file.id);
      return Response.json({ order_id: orderId, files: [{ ...file, sha256: createHash('sha256').update(bytes).digest('hex'), url: `https://artwork.example/${file.id}?signed=fixture-only` }] });
    }
    if (url.startsWith('https://artwork.example/')) {
      assert.equal(options.headers, undefined);
      return new Response(images.get(new URL(url).pathname.slice(1)));
    }
    throw new Error('Unexpected network request: no real services are permitted in this test');
  });
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('./generate-order-pdfs.mjs', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'partner-pdf-fixture', setup(builder) {
      builder.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'db', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export function createClient() {
          const f = globalThis.partnerPdfWorkerFixture;
          return {
            async rpc(name) { if (name !== 'allocate_promo_run') throw Error('Unexpected RPC'); return { data: { cards: [] }, error: null }; },
            from(table) {
              if (!['orders', 'order_pdf_generations'].includes(table)) throw Error('Unexpected table');
              let changes, inserted, excludeCompleted = false, ids, maxAttempts;
              const q = {};
              for (const name of ['select', 'ilike', 'or', 'order', 'limit', 'eq']) q[name] = () => q;
              q.in = (key, values) => { ids = values; return q; };
              q.lt = (key, value) => { maxAttempts = value; return q; };
              q.neq = (key, value) => { excludeCompleted = key === 'status' && value === 'completed'; return q; };
              q.insert = rows => { inserted = rows; return q; };
              q.update = value => { changes = value; return q; };
              q.maybeSingle = async () => ({ data: f.jobs[0] ? { ...f.jobs[0] } : null, error: null });
              q.single = async () => ({ data: f.order, error: null });
              q.then = (resolve, reject) => {
                if (inserted) { f.inserts.push(...inserted); f.jobs.push(...inserted.map(job => ({ ...job, attempt_count: 0, processed_cards: 0 }))); }
                if (changes) { f.updates.push(structuredClone(changes)); Object.assign(f.jobs[0], changes); }
                const data = table === 'orders' ? [f.order] : f.jobs.filter(job => (!ids || ids.includes(job.order_id)) && (!excludeCompleted || job.status !== 'completed') && (maxAttempts === undefined || job.attempt_count < maxAttempts));
                return Promise.resolve({ data: structuredClone(data), error: null }).then(resolve, reject);
              };
              return q;
            },
            storage: { from(bucket) { if (bucket !== 'order-pdfs') throw Error('Unexpected bucket');
              return { async upload(path, bytes) { f.uploads.push({ path, bytes }); return { error: null }; } };
            } },
          };
        }
      `, loader: 'js' }));
      builder.onResolve({ filter: /^(pdf-lib|sharp)$/ }, args => ({ path: import.meta.resolve(args.path), external: true }));
    } }],
  });
  await writeFile(entry, compiled.outputFiles[0].text);
  await import(pathToFileURL(entry).href);
  return f;
}

test('automatic worker discovers an unqueued paid API/MCP order, renders real duplex PDF, uploads and marks it complete', async t => {
  const f = await runWorker(t, 'ready');
  assert.equal(f.inserts.length, 1);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.jobs[0].status, 'completed');
  assert.equal(f.jobs[0].total_cards, 20); // Manifest copies, never 20 * deck_quantity.
  assert.equal(f.jobs[0].processed_cards, 20);
  assert.equal(f.jobs[0].completed_parts, 1);
  assert.deepEqual(f.jobs[0].storage_paths, f.uploads.map(file => file.path));
  assert.equal(f.requests.filter(call => call.url.startsWith('https://artwork.example')).length, 2);
  assert.ok(!JSON.stringify(f.updates).includes('signed='));
  const pdf = await PDFDocument.load(f.uploads[0].bytes);
  assert.equal(pdf.getPageCount(), 4);
  const offsets = [0, 0, 0, 0, 0, 0, 0, -.2, -.1, -.2, -.2, -.2, -.2, -.3, -.4, -.5, -.6, -.6];
  for (const [pageIndex, page] of pdf.getPages().entries()) {
    close(mm(page.getWidth()), 457.2); close(mm(page.getHeight()), 304.8);
    const streams = page.node.Contents();
    const content = Array.from({ length: streams.size() }, (_, i) => Buffer.from(decodePDFRawStream(streams.lookup(i)).decode()).toString()).join('\n');
    const blocks = [...content.matchAll(/(?:^|\n)q\n([\s\S]*?)\nQ/g)].map(match => match[1]);
    const placements = blocks.filter(block => /\sDo\n?$/.test(block));
    assert.equal(placements.length, pageIndex < 2 ? 18 : 2);
    placements.forEach((block, slot) => {
      const [position, rotation, scale] = [...block.matchAll(/^(.+) cm$/gm)].map(match => match[1].split(' ').map(Number));
      const back = pageIndex % 2 === 1;
      const x = 9.7 + (slot % 6) * 69.6 + offsets[slot], top = 15.5 + Math.floor(slot / 6) * 98.4;
      close(mm(position[4]), x + (back ? 67 : 0));
      close(mm(position[5]), back ? top + 92 : 304.8 - top - 92);
      close(rotation[0], back ? -1 : 1); close(rotation[3], back ? -1 : 1);
      close(mm(scale[0]), 67); close(mm(scale[3]), 92);
    });
    const bar = blocks.find(block => !block.includes(' Do') && !block.includes('BT'));
    const position = [...bar.matchAll(/^(.+) cm$/gm)][0][1].split(' ').map(Number);
    close(mm(position[4]), 7); close(mm(position[5]), pageIndex % 2 ? 60.4 : 184.4);
  }
  if (process.env.PARTNER_PDF_TEST_OUTPUT_DIR) {
    await mkdir(process.env.PARTNER_PDF_TEST_OUTPUT_DIR, { recursive: true });
    await writeFile(join(process.env.PARTNER_PDF_TEST_OUTPUT_DIR, 'partner-api-mcp-sample.pdf'), f.uploads[0].bytes);
  }
});

test('pending partner ingestion keeps the job retryable without upload, repair email, or immediate continuation', async t => {
  const f = await runWorker(t, 'waiting');
  assert.equal(f.jobs[0].status, 'processing');
  assert.equal(f.jobs[0].attempt_count, 0);
  assert.equal(f.jobs[0].repair_required, false);
  assert.match(f.jobs[0].error_message, /^\[partner-artwork-pending\]/);
  assert.equal(f.uploads.length, 0);
  assert.equal(f.requests.length, 1);
});

test('a completed partner PDF is untouched: no queue insert, artwork access, updates or uploads', async t => {
  const f = await runWorker(t, 'completed');
  assert.equal(f.jobs[0].storage_path, 'existing.pdf');
  assert.equal(f.inserts.length, 0);
  assert.equal(f.updates.length, 0);
  assert.equal(f.uploads.length, 0);
  assert.equal(f.requests.length, 0);
});
