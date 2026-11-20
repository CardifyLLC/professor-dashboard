import { createHash } from 'node:crypto';
import { attachPartnerArtwork, isPartnerOrder, orderMetadata, parsePartnerImage } from '../src/services/partnerArtwork.mjs';

export const PARTNER_ARTWORK_WAIT_PREFIX = '[partner-artwork-pending]';
export class PartnerArtworkPendingError extends Error {}

// A payment can arrive before ingestion finishes. Wait for the next scheduled
// run instead of immediately dispatching continuations and exhausting retries.
export function partnerPdfRetryReady(job, now = Date.now()) {
  return !String(job.error_message || '').startsWith(PARTNER_ARTWORK_WAIT_PREFIX)
    || now - new Date(job.started_at).getTime() >= 5 * 60 * 1000;
}

export function createPartnerPdfArtworkClient({ env = process.env, request = (...args) => fetch(...args) } = {}) {
  const allowedFiles = new Map();

  async function production(payload) {
    let origin;
    try { origin = new URL(env.PARTNER_PLATFORM_ORIGIN); } catch { /* handled below */ }
    if (!origin || origin.protocol !== 'https:' || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash || !env.PARTNER_INTERNAL_SECRET
      || env.PARTNER_INTERNAL_SECRET.length < 32) {
      throw new Error('Configure PARTNER_PLATFORM_ORIGIN and PARTNER_INTERNAL_SECRET in the PDF worker.');
    }
    let response;
    try {
      response = await request(`${origin.origin}/api/internal/production`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.PARTNER_INTERNAL_SECRET}` },
        body: JSON.stringify({ ...payload, actor: 'daily-pdf-worker' }),
      });
    } catch {
      // Network errors/response bodies may contain credentials or signed URLs.
      throw new Error('Partner production service request failed.');
    }
    if (response.status === 404 && payload.include_urls === false) {
      throw new PartnerArtworkPendingError('Waiting for the paid order to reach the partner platform.');
    }
    if (!response.ok) throw new Error(`Partner production service returned HTTP ${response.status}.`);
    let data;
    try { data = await response.json(); } catch { throw new Error('Invalid partner production response.'); }
    if (data?.order_id !== payload.order_id) throw new Error('Partner production order identity mismatch.');
    return data;
  }

  async function prepareOrder(order) {
    allowedFiles.clear();
    if (!isPartnerOrder(order)) return order;
    if (!['paid', 'processing'].includes(String(order.status || '').toLowerCase())
      || ['refunded', 'failed', 'cancelled'].includes(String(order.payment_status || '').toLowerCase())) {
      throw new Error('Partner order is not printable.');
    }
    const manifest = await production({ order_id: order.id, include_urls: false });
    if (manifest.cart_id !== orderMetadata(order).partnerCartId) throw new Error('Partner production cart identity mismatch.');
    if (!['paid', 'in_production'].includes(manifest.status)) throw new Error('Partner order is blocked, cancelled, or already shipped.');
    if (manifest.ready !== true) throw new PartnerArtworkPendingError('Waiting for approved partner artwork to finish ingestion.');
    if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Partner artwork manifest is empty.');
    const ids = new Set();
    for (const file of manifest.files) {
      if (!Number.isSafeInteger(file.item_index) || file.item_index < 0 || ids.has(file.id)) {
        throw new Error('Invalid partner artwork manifest.');
      }
      ids.add(file.id);
    }
    // Pairing and total quantities are checked against the paid order. The
    // manifest already contains final copy counts; never multiply by decks.
    const prepared = attachPartnerArtwork(order, manifest);
    let originalCards = order.card_data;
    if (typeof originalCards === 'string') {
      try { originalCards = JSON.parse(originalCards); } catch { originalCards = []; }
    }
    prepared.card_data = prepared.card_data.map(card => ({
      ...card, finish: originalCards?.[card.partnerItemIndex]?.finish || 'standard',
    }));
    prepared.deck_quantity = 1;
    for (const file of manifest.files) allowedFiles.set(`partner-artwork:${order.id}/${file.id}`, file);
    return prepared;
  }

  async function download(reference) {
    const { orderId, fileId } = parsePartnerImage(reference);
    const expected = allowedFiles.get(reference);
    if (!expected) throw new Error('Partner artwork was not approved for this PDF job.');
    // Resolve each file at point of use; production URLs expire after 60s and
    // rendering large orders can take much longer. Never store these URLs.
    const manifest = await production({ order_id: orderId, file_id: fileId });
    const files = manifest.files;
    const file = Array.isArray(files) && files.length === 1 ? files[0] : null;
    if (!file || file.id !== fileId || file.item_index !== expected.item_index
      || file.side !== expected.side || file.quantity !== expected.quantity) {
      throw new Error('Partner artwork file identity mismatch.');
    }
    let url;
    try { url = new URL(file.url); } catch { /* handled below */ }
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error('Invalid partner artwork download URL.');
    }
    let bytes;
    try {
      // The signed URL authorizes this read. Do NOT forward either the main
      // Supabase service key or the partner internal secret to the file host.
      const response = await request(url.href, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error('Download failed');
      bytes = Buffer.from(await response.arrayBuffer());
    } catch { throw new Error('Partner artwork download failed; retry the PDF job.'); }
    if (!bytes.length) throw new Error('Partner artwork download was empty.');
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(file.sha256)
      || createHash('sha256').update(bytes).digest('hex') !== file.sha256.toLowerCase()) {
      throw new Error('Partner artwork checksum mismatch.');
    }
    return bytes;
  }

  return { prepareOrder, download };
}
