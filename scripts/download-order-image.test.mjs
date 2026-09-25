import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadOrderImage } from './download-order-image.mjs';

test('retries timeout then downloads successfully', async () => {
  let calls = 0;
  const result = await downloadOrderImage('https://example.com/image', {}, {
    sleep: async () => {}, request: async () => {
      if (++calls === 1) throw new DOMException('timed out', 'TimeoutError');
      return new Response('image');
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.bytes.toString(), 'image');
});
test('missing image is not retried', async () => {
  let calls = 0;
  const result = await downloadOrderImage('https://example.com/image', {}, {
    request: async () => { calls++; return new Response('', { status: 404 }); },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 404);
});
test('temporary server failures stop after three attempts', async () => {
  let calls = 0;
  const result = await downloadOrderImage('https://example.com/image', {}, {
    sleep: async () => {}, request: async () => { calls++; return new Response('', { status: 503 }); },
  });
  assert.equal(calls, 3);
  assert.equal(result.ok, false);
});
test('interrupted response body is retried', async () => {
  let calls = 0;
  const result = await downloadOrderImage('https://example.com/image', {}, {
    sleep: async () => {}, request: async () => ++calls === 1
      ? { ok: true, status: 200, arrayBuffer: async () => { throw new TypeError('terminated'); } }
      : new Response('complete'),
  });
  assert.equal(calls, 2);
  assert.equal(result.bytes.toString(), 'complete');
});
