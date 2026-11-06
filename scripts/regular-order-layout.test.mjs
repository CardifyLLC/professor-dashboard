import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { build } from 'esbuild';
import { dailyLayoutForOrder, dailySlotPosition, REGULAR_DAILY_LAYOUT, LEGACY_DAILY_LAYOUT } from './regular-order-layout.mjs';

const run = promisify(execFile);
const pt = mm => mm * 72 / 25.4;
const mm = value => value * 25.4 / 72;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const worker = fileURLToPath(new URL('./generate-order-pdfs.mjs', import.meta.url));
const offsets = [0, 0, 0, 0, 0, 0, 0, -.2, -.1, -.2, -.2, -.2, -.2, -.3, -.4, -.5, -.6, -.6];
const blocks = page => {
  const streams = page.node.Contents();
  const content = Array.from({ length: streams.size() }, (_, i) => Buffer.from(decodePDFRawStream(streams.lookup(i)).decode()).toString()).join('\n');
  return [...content.matchAll(/(?:^|\n)q\n([\s\S]*?)\nQ/g)].map(match => match[1]);
};
const images = page => blocks(page).filter(block => /\sDo\n?$/.test(block));
const transforms = block => [...block.matchAll(/^(.+) cm$/gm)].map(match => match[1].split(' ').map(Number));

test('only wholly regular orders get the new calibration; foil and mixed orders retain their geometry', () => {
  for (const finish of [undefined, 'standard', 'gloss']) {
    assert.equal(dailyLayoutForOrder({ card_data: [{ finish }] }), REGULAR_DAILY_LAYOUT);
  }
  for (const finish of ['silver', 'rainbow', 'silver-gloss', 'silver-rainbow', 'future-finish']) {
    assert.equal(dailyLayoutForOrder({ card_data: [{ finish: 'standard' }, { finish }] }), LEGACY_DAILY_LAYOUT);
  }
  for (const key of ['silverMask', 'spotMask']) {
    assert.equal(dailyLayoutForOrder({ card_data: [{ [key]: 'mask.png' }] }), LEGACY_DAILY_LAYOUT);
  }
  assert.equal(dailyLayoutForOrder({ card_data: JSON.stringify([{ finish: 'silver' }]) }), LEGACY_DAILY_LAYOUT);
  assert.equal(dailyLayoutForOrder({ card_images: JSON.stringify(['front.png', 'back.png', 'mask.png']) }), LEGACY_DAILY_LAYOUT);
  assert.equal(dailyLayoutForOrder({ card_images: ['front.png', 'back.png'] }), REGULAR_DAILY_LAYOUT);
  assert.throws(() => dailySlotPosition(18, REGULAR_DAILY_LAYOUT), /Invalid/);
});

test('real daily worker PDF geometry: repeated sheets, partial sheet, duplex, cut lines, bar, and foil isolation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'regular-layout-proof-'));
  const standardPath = join(directory, 'standard.pdf'), foilPath = join(directory, 'foil.pdf');
  t.after(async () => { for (const path of [standardPath, foilPath]) await unlink(path).catch(() => {}); await rmdir(directory); });
  const cleanEnv = { ...process.env };
  for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_WORKFLOW_TOKEN', 'GITHUB_REPOSITORY_NAME', 'ORDER_PDF_WEBHOOK_SECRET']) delete cleanEnv[name];
  await Promise.all([
    run(process.execPath, [worker, '--sample', standardPath, '52', 'standard'], { env: cleanEnv }),
    run(process.execPath, [worker, '--sample', foilPath, '18', 'silver'], { env: cleanEnv }),
  ]);
  const standardBytes = await readFile(standardPath), foilBytes = await readFile(foilPath);
  const standard = await PDFDocument.load(standardBytes), foil = await PDFDocument.load(foilBytes);
  assert.equal(standard.getPageCount(), 6);
  assert.equal(foil.getPageCount(), 2);
  assert.deepEqual(standard.getPages().map(page => images(page).length), [18, 18, 18, 18, 16, 16]);
  for (const [kind, pdf] of [['standard', standard], ['foil', foil]]) {
    for (const [pageIndex, page] of pdf.getPages().entries()) {
      const back = pageIndex % 2 === 1;
      close(mm(page.getWidth()), 457.2); close(mm(page.getHeight()), 304.8);
      const placements = images(page);
      placements.forEach((block, slot) => {
        const [translate, rotate, scale] = transforms(block);
        const x = 9.7 + (slot % 6) * (67 + (kind === 'standard' ? 2.6 : 2.45)) + (kind === 'standard' ? offsets[slot] : 0);
        const top = 15.5 + Math.floor(slot / 6) * 98.4;
        close(mm(translate[4]), x + (back ? 67 : 0));
        close(mm(translate[5]), back ? top + 92 : 304.8 - top - 92);
        close(rotate[0], back ? -1 : 1); close(rotate[3], back ? -1 : 1);
        close(rotate[1], 0); close(rotate[2], 0);
        close(mm(scale[0]), 67); close(mm(scale[3]), 92);
        const resourceName = block.match(/\/([^\s]+) Do/)[1];
        const image = page.node.Resources().lookup(PDFName.of('XObject')).lookup(PDFName.of(resourceName));
        assert.equal(image.dict.lookup(PDFName.of('Width')).asNumber(), 3166);
        assert.equal(image.dict.lookup(PDFName.of('Height')).asNumber(), 4347);
      });
      const rectangles = blocks(page).filter(block => !block.includes(' Do') && !block.includes('BT'));
      assert.equal(rectangles.length, placements.length + 1);
      const bar = rectangles[0], [barTranslation] = transforms(bar);
      close(mm(barTranslation[4]), 7); close(mm(barTranslation[5]), back ? 60.4 : 184.4);
      const lineEnds = [...bar.matchAll(/^([^\n]+) l$/gm)].map(match => match[1].split(' ').map(Number));
      assert.ok(lineEnds.some(([x, y]) => Math.abs(mm(x) - 3.3) < 1e-6 && Math.abs(mm(y) - 60) < 1e-6));
      rectangles.slice(1).forEach((block, slot) => {
        const [cut] = transforms(block), [image] = transforms(placements[slot]);
        close(cut[4], image[4] - (back ? pt(67) : 0));
        close(cut[5], image[5] - (back ? pt(92) : 0));
      });
    }
  }
  // Measured edge-to-edge gaps differ where individual X corrections differ.
  const x = images(standard.getPage(0)).map(block => mm(transforms(block)[0][4]));
  const expectedGaps = [[2.6, 2.6, 2.6, 2.6, 2.6], [2.4, 2.7, 2.5, 2.6, 2.6], [2.5, 2.5, 2.5, 2.5, 2.6]];
  expectedGaps.forEach((row, r) => row.forEach((gap, c) => close(x[r * 6 + c + 1] - x[r * 6 + c] - 67, gap)));
  if (process.env.REGULAR_PDF_PROOF_DIR) {
    await writeFile(join(process.env.REGULAR_PDF_PROOF_DIR, 'regular-order-calibration-provisional.pdf'), standardBytes, { flag: 'wx' });
    await writeFile(join(process.env.REGULAR_PDF_PROOF_DIR, 'foil-legacy-regression.pdf'), foilBytes, { flag: 'wx' });
    await writeFile(join(process.env.REGULAR_PDF_PROOF_DIR, 'regular-order-measurements.json'), JSON.stringify({
      approval: 'Unlabeled X/Y zeros confirmed; physical duplex print proof pending',
      sheetMm: [457.2, 304.8], cardMm: [67, 92], baseGapMm: [2.6, 6.4],
      frontSlotsMm: x.map((value, slot) => ({ slot: slot + 1, x: Number(value.toFixed(6)), top: 15.5 + Math.floor(slot / 6) * 98.4 })),
      horizontalGapsByRowMm: expectedGaps, sheetCardCounts: [18, 18, 16],
      registrationBarMm: { x: 7, frontTop: 60.4, backTop: 184.4, width: 3.3, height: 60 },
      verification: 'PDF content transforms, image raster dimensions, cut outlines and registration bars checked',
    }, null, 2), { flag: 'wx' });
  }
});

test('worker skips a queued order that has completed before processing, without uploads or updates', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'regular-worker-completed-'));
  const entry = join(directory, 'worker.mjs');
  const fixture = globalThis.regularWorkerFixture = { writes: [], reads: 0 };
  const envNames = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_WORKFLOW_TOKEN', 'GITHUB_REPOSITORY_NAME'];
  const original = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  process.env.SUPABASE_URL = 'https://fixture.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  delete process.env.GITHUB_WORKFLOW_TOKEN; delete process.env.GITHUB_REPOSITORY_NAME;
  t.after(async () => {
    for (const name of envNames) if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name];
    delete globalThis.regularWorkerFixture; await unlink(entry).catch(() => {}); await rmdir(directory);
  });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
  const compiled = await build({ entryPoints: [worker], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'completed-job-fixture', setup(builder) {
    builder.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'db', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export function createClient() {
      const f = globalThis.regularWorkerFixture;
      return { from(table) {
        const q = {}; let filtered = false;
        for (const name of ['select','ilike','order','limit','in','eq','lt']) q[name] = () => q;
        q.neq = () => { filtered = true; return q; };
        q.maybeSingle = async () => ({ data: { status: 'completed' } });
        q.update = q.insert = value => { f.writes.push(value); throw new Error('Must not write completed order'); };
        q.single = async () => { throw new Error('Must not load completed customer artwork'); };
        q.then = (resolve, reject) => {
          const data = table === 'orders' ? [{ id: 'completed-order', metadata: {} }] :
            filtered && f.reads++ > 0 ? [] : [{ order_id: 'completed-order', status: 'processing', attempt_count: 0, processed_cards: 0 }];
          return Promise.resolve({ data }).then(resolve, reject);
        };
        return q;
      }, storage: { from() { throw new Error('Must not upload completed order'); } } };
    }`, loader: 'js' }));
    builder.onResolve({ filter: /^(pdf-lib|sharp)$/ }, args => ({ path: import.meta.resolve(args.path), external: true }));
  } }] });
  await writeFile(entry, compiled.outputFiles[0].text);
  await import(pathToFileURL(entry).href);
  assert.deepEqual(fixture.writes, []);
});
