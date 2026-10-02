export function orderMetadata(order) {
  if (typeof order?.metadata === 'string') {
    try { return JSON.parse(order.metadata) || {}; } catch { return {}; }
  }
  return order?.metadata || {};
}

export const isPartnerOrder = order => Boolean(orderMetadata(order).partnerCartId);
export const isPartnerImage = value => typeof value === 'string' && value.startsWith('partner-artwork:');
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export function parsePartnerImage(value) {
  const match = String(value).match(new RegExp(`^partner-artwork:(${uuid})/(${uuid})$`, 'i'));
  if (!match) throw new Error('Invalid partner artwork reference.');
  return { orderId: match[1], fileId: match[2] };
}

// These references contain identifiers only. Signed URLs are fetched at the
// point of use and never written to orders, localStorage, or project files.
export function partnerCards(orderId, manifest) {
  if (!manifest.ready) return [];
  const items = new Map();
  for (const file of manifest.files || []) {
    if (!['front','back'].includes(file.side) || !['stored','processed'].includes(file.state)) throw new Error('Partner artwork is not ready.');
    const item = items.get(file.item_index) || {};
    if (item[file.side]) throw new Error('Duplicate partner artwork side.');
    item[file.side] = file;
    items.set(file.item_index, item);
  }
  return [...items].sort(([a],[b]) => a-b).map(([index, item]) => {
    if (!item.front || !item.back || !Number.isSafeInteger(item.front.quantity) || item.front.quantity < 1 || item.front.quantity !== item.back.quantity) throw new Error('Incomplete partner front/back pair.');
    const frontUrl = `partner-artwork:${orderId}/${item.front.id}`;
    const backUrl = `partner-artwork:${orderId}/${item.back.id}`;
    parsePartnerImage(frontUrl); parsePartnerImage(backUrl);
    return { frontUrl, backUrl, quantity:item.front.quantity, partnerItemIndex:index, partnerOrderId:orderId };
  });
}

export function attachPartnerArtwork(order, manifest) {
  const cards = partnerCards(order.id, manifest);
  if (manifest.ready && cards.reduce((count,card)=>count+card.quantity,0) !== Number(order.quantity)) throw new Error('Partner artwork quantities do not match this order.');
  return { ...order, partnerArtwork:manifest, card_data:cards, card_images:[] };
}
