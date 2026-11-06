// Daily worker calibration; independent of browser-local BatcherPRO settings.
// Professor confirmed unlabeled X/Y zeros on 2026-11-06.
// A 100% duplex print proof still needs approval before deployment.
const zeroOffsets = Object.freeze(Array(18).fill(0));
export const LEGACY_DAILY_LAYOUT = Object.freeze({
  marginTop: 15.5, marginLeft: 9.7, gapX: 2.45, gapY: 6.4,
  offsetX: zeroOffsets, offsetY: zeroOffsets,
});
export const REGULAR_DAILY_LAYOUT = Object.freeze({
  ...LEGACY_DAILY_LAYOUT,
  gapX: 2.6,
  offsetX: Object.freeze([
    0, 0, 0, 0, 0, 0,
    0, -0.2, -0.1, -0.2, -0.2, -0.2,
    -0.2, -0.3, -0.4, -0.5, -0.6, -0.6,
  ]),
});

const array = value => {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};
const object = value => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch { return {}; }
};

export function dailyLayoutForOrder(order) {
  // This production worker predates stock-separated PDF generation. Do not
  // transfer regular calibration to foil/mixed/unknown-finish orders. Preserve
  // their existing geometry, rather than inventing a new foil configuration.
  const cards = array(order.card_data).map(object);
  const nonRegular = cards.some(card => {
    const finish = String(card.finish || 'standard').toLowerCase();
    return !['standard', 'gloss'].includes(finish) || card.silverMask || card.spotMask;
  });
  const legacyMask = !cards.length && array(order.card_images)
    .some(path => /mask|silver/i.test(String(path || '')));
  return nonRegular || legacyMask ? LEGACY_DAILY_LAYOUT : REGULAR_DAILY_LAYOUT;
}

// index is the position on ONE sheet, not a card/order identifier. Each full,
// partial, or new file-part sheet starts at slot zero. Coordinates are mm,
// measured right/down from the front's top-left. Positive Y moves down.
export function dailySlotPosition(index, layout) {
  if (!Number.isInteger(index) || index < 0 || index >= 18) throw new Error('Invalid daily sheet slot');
  return {
    x: layout.marginLeft + (index % 6) * (67 + layout.gapX) + layout.offsetX[index],
    top: layout.marginTop + Math.floor(index / 6) * (92 + layout.gapY) + layout.offsetY[index],
  };
}
