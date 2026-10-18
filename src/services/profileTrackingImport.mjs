import { suggestColumns, normalizeShipment } from '../../supabase/functions/_shared/shipment-tracking.mjs';

const storedStatuses = new Set(['saved', 'accepted', 'sending', 'unknown']);
const sameShipment = (a, b) => a?.mode === 'email' && a.email === b.email && a.tracking === b.tracking && a.carrier === b.carrier;
const cancelled = () => Object.assign(new Error('Import cancelled.'), { name: 'AbortError' });
function invalidFile(issues) {
  return Object.assign(new Error('Nothing was saved. Correct the shipment rows listed below and upload the file again.'), { issues });
}

// Preparation only reads data. The one confirmation in the UI authorizes saves.
export async function prepareProfileTracking(parsed, { request, onProgress = () => {}, isCancelled = () => false }) {
  const mapping = suggestColumns(parsed.headers);
  if (mapping.email === '' || mapping.tracking === '') {
    throw new Error('Could not identify one customer email column and one tracking number column. Use the original Pirate Ship export, or name those columns "Email" and "Tracking Number". Nothing was saved.');
  }
  const unique = new Map(), issues = [];
  let duplicates = 0;
  parsed.rows.forEach((values, index) => {
    const read = field => mapping[field] === '' ? '' : values[Number(mapping[field])];
    const { row, error } = normalizeShipment({ mode: 'email', email: read('email'), tracking: read('tracking'), carrier: read('carrier') });
    const item = { row, rowNumber: index + 2 };
    if (error) { issues.push({ ...item, message: error }); return; }
    const prior = unique.get(row.tracking);
    if (prior) {
      if (sameShipment(prior.row, row)) duplicates++;
      else issues.push({ ...item, message: `This tracking number also appears on row ${prior.rowNumber} with a different email or carrier. Correct the conflicting rows.` });
    } else unique.set(row.tracking, item);
  });
  if (issues.length) throw invalidFile(issues);
  const items = [...unique.values()], pending = [];
  let alreadySaved = 0;
  for (let offset = 0; offset < items.length; offset += 100) {
    if (isCancelled()) throw cancelled();
    onProgress(`Checking ${Math.min(offset + 100, items.length).toLocaleString('en-US')} of ${items.length.toLocaleString('en-US')} tracking numbers…`);
    const chunk = items.slice(offset, offset + 100);
    const data = await request({ action: 'preview', rows: chunk.map(item => item.row) });
    if (isCancelled()) throw cancelled();
    if (!Array.isArray(data?.results) || data.results.length !== chunk.length) throw new Error('The tracking check was incomplete. Nothing was saved. Please upload the file again.');
    data.results.forEach((result, index) => {
      const item = chunk[index];
      if (!sameShipment(result.row, item.row)) throw new Error('The tracking check returned different shipment details. Nothing was saved. Please try again.');
      if (storedStatuses.has(result.status)) alreadySaved++;
      else if (result.status === 'ready' && result.snapshot?.customer_email === item.row.email) {
        pending.push({ ...item, snapshot: result.snapshot });
      } else issues.push({ ...item, message: result.message || 'This shipment could not be verified.' });
    });
  }
  if (issues.length) throw invalidFile(issues);
  return { pending, alreadySaved, duplicates, total: items.length };
}

// Save-only is idempotent on the server. On a lost response, stop rather than
// claim success; re-uploading checks existing records before trying again.
export async function saveProfileTracking(batch, { request, onProgress = () => {}, isCancelled = () => false }) {
  let saved = 0;
  for (const item of batch.pending) {
    if (isCancelled()) return { saved, remaining: batch.pending.length - saved, interrupted: true };
    onProgress({ saved, total: batch.pending.length });
    try {
      const result = await request({ action: 'save', row: item.row, snapshot: item.snapshot });
      if (!storedStatuses.has(result?.status)) throw new Error(result?.message || 'The save could not be confirmed.');
      saved++;
    } catch (error) {
      return {
        saved, remaining: batch.pending.length - saved, interrupted: true,
        error: `Row ${item.rowNumber}: ${error.message} Upload the same file again to check what was saved and continue without duplicates.`,
      };
    }
  }
  return { saved, remaining: 0, interrupted: false };
}
