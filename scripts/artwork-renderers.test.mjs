import assert from 'node:assert/strict';
import test from 'node:test';
import { checkArtworkRenderers, validateArtworkRenderer } from './check-artwork-renderers.mjs';

test('all shipped order and BatcherPRO previews resolve private references', async () => {
  await checkArtworkRenderers();
});

test('build rejects the mixed deployment that caused ERR_UNKNOWN_URL_SCHEME', () => {
  // Loading a manifest can succeed even when an older grid renders its opaque
  // front/back identifiers as browser URLs. Importing the helper alone is not enough.
  const oldGrid = `import OrderImage from './OrderImage';
    const Preview = ({card}) => <img src={card.frontUrl} />;`;
  assert.throws(() => validateArtworkRenderer(oldGrid, 'BatcherPRO.jsx'), /old artwork renderer/);
  assert.throws(() => validateArtworkRenderer('const Preview = () => <img src={image} />;', 'OrderDetail.jsx'), /OrderImage/);
});

test('resolved front and back previews pass the deployment check', () => {
  const grid = `import OrderImage from './OrderImage';
    const Preview = ({card}) => <><OrderImage src={card.frontUrl} /><OrderImage src={card.backUrl} /></>;`;
  assert.doesNotThrow(() => validateArtworkRenderer(grid, 'BatcherPRO.jsx'));
});
