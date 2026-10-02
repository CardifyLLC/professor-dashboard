// Vite builds the browser bundle only. Import the Vercel entry points as well
// so a missing server module cannot pass a production build unnoticed.
import { checkArtworkRenderers } from './check-artwork-renderers.mjs';

try {
  await checkArtworkRenderers();
  console.log('Artwork previews OK: BatcherPRO and order details use the private artwork resolver.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

for (const name of ['partnerships', 'partner-orders']) {
  try {
    const { default: handler } = await import(`../api/${name}.js`);
    if (typeof handler !== 'function') throw new Error('Default export must be a request handler.');
    let status, body;
    await handler({ method: 'POST', headers: {}, body: {} }, {
      setHeader() {},
      set statusCode(value) { status = value; },
      end(value) { body = value; },
    });
    // This probe has no token, contacts no external service, and changes no data.
    if (status !== 401 || !JSON.parse(body).error) throw new Error('Unauthenticated startup probe did not return HTTP 401.');
    console.log(`API startup OK: /api/${name}`);
  } catch (error) {
    console.error(`API startup failed: /api/${name}. Upload its api/ entry point and server/ dependencies together.`);
    console.error(error.message);
    process.exitCode = 1;
  }
}
