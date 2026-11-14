import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./generate-order-pdfs.mjs', import.meta.url), 'utf8');
const start = source.indexOf('const fetchImage =');
const body = source.slice(start, source.indexOf('\n};', start) + 3);
function loader(response, processingError) {
  const sharp = () => ({ resize() { return this; }, flatten() { return this; }, jpeg() { return this; }, async toBuffer() { if (processingError) throw processingError; return Buffer.from('rendered'); } });
  sharp.kernel = { lanczos3: 'lanczos3' };
  return vm.runInNewContext(`class MissingImageCandidateError extends Error {}\nclass MissingOrderImageError extends Error {}\n${body}\n({fetchImage, MissingOrderImageError})`, {
    Buffer, sharp, downloadOrderImage: async () => response,
    SUPABASE_SERVICE_ROLE_KEY: 'fixture', IMAGE_WIDTH: 10, IMAGE_HEIGHT: 10, IMAGE_QUALITY: 50,
  });
}
test('renderer failures must not ask customers to replace existing artwork', async () => {
  const { fetchImage, MissingOrderImageError } = loader({ok:true, status:200, bytes:Buffer.from('existing')}, new Error('memory allocation failed'));
  await assert.rejects(fetchImage(['https://example.com/image']), error => !(error instanceof MissingOrderImageError) && /temporary download or processing/.test(error.message));
});
test('confirmed missing and empty objects still require artwork recovery', async () => {
  for (const response of [{ok:false,status:404}, {ok:true,status:200,bytes:Buffer.alloc(0)}]) {
    const {fetchImage, MissingOrderImageError} = loader(response);
    await assert.rejects(fetchImage(['https://example.com/image']), MissingOrderImageError);
  }
});
test('storage outages are operational failures and valid images render', async () => {
  const failed = loader({ok:false,status:503});
  await assert.rejects(failed.fetchImage(['https://example.com/image']), error => !(error instanceof failed.MissingOrderImageError));
  const valid = loader({ok:true,status:200,bytes:Buffer.from('existing')});
  assert.equal((await valid.fetchImage(['https://example.com/image'])).toString(), 'rendered');
});
