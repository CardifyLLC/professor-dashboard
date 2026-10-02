import { readFile } from 'node:fs/promises';

// These screens receive partner-artwork: identifiers as well as ordinary URLs.
// Every preview must resolve through OrderImage before it reaches an <img>.
// Catch a partial source upload (new loader + old grid) before Vercel deploys it.
export function validateArtworkRenderer(source, filename) {
  const importsResolver = /import\s+OrderImage\s+from\s+['"]\.\/OrderImage['"]/.test(source);
  if (!importsResolver || /<img\b/.test(source)) {
    throw new Error(`${filename} still uses the old artwork renderer. Upload the updated component and src/components/OrderImage.jsx together; partner-artwork: references cannot be used directly as image URLs.`);
  }
}

export async function checkArtworkRenderers() {
  for (const name of ['BatcherPRO.jsx', 'OrderDetail.jsx']) {
    const source = await readFile(new URL(`../src/components/${name}`, import.meta.url), 'utf8');
    validateArtworkRenderer(source, name);
  }
}
