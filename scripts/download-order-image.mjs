// Read the body within each attempt so interrupted downloads can also retry.
export async function downloadOrderImage(url, headers, {
  request = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 30_000,
} = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await request(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
      if (!response.ok) {
        await response.body?.cancel();
        if (retryable && attempt < 2) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        return { status: response.status, ok: false };
      }
      return { status: response.status, ok: true, bytes: Buffer.from(await response.arrayBuffer()) };
    } catch (error) {
      const retryable = ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
      if (!retryable || attempt === 2) throw error;
      await sleep(1000 * 2 ** attempt);
    }
  }
}
