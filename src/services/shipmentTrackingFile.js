import { parseTrackingCsv, MAX_CSV_BYTES, MAX_CSV_ROWS } from '../../supabase/functions/_shared/shipment-tracking.mjs';

const elements = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const child = (node, name) => [...node.children].find((item) => item.localName === name);
const text = (node) => elements(node, 't').map((item) => item.textContent).join('');

function xml(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('This workbook contains unsupported XML declarations. Export it again from Pirate Ship.');
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (elements(doc, 'parsererror').length) throw new Error('This Excel file could not be read. Export it again from Pirate Ship.');
  return doc;
}

// Read only shipment values. Never execute formulas, macros or external links.
// Bound decompressed data as well as file size before constructing XML documents.
async function readXml(zip, name, budget) {
  const entry = zip.file(name);
  if (!entry) throw new Error('This Excel file is missing a required worksheet file. Export it again.');
  const bytes = await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const stream = entry.internalStream('uint8array');
    stream.on('data', (chunk) => {
      size += chunk.length; budget.bytes += chunk.length;
      if (size > 8 * 1024 * 1024 || budget.bytes > 16 * 1024 * 1024) {
        stream.pause(); reject(new Error('This workbook expands beyond the import limit. Export a smaller shipment batch.')); return;
      }
      chunks.push(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      const result = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
      resolve(result);
    });
    stream.resume();
  });
  return xml(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

async function readXlsx(file) {
  const { default: JSZip } = await import('jszip');
  let zip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
  catch { throw new Error('Choose an unencrypted .xlsx file exported from Pirate Ship.'); }
  if (Object.keys(zip.files).length > 200) throw new Error('This workbook has too many files. Export just the shipment worksheet.');
  const budget = { bytes: 0 };
  const workbook = await readXml(zip, 'xl/workbook.xml', budget);
  const sheets = elements(workbook, 'sheet');
  if (sheets.length !== 1) throw new Error('Upload a workbook containing one shipment worksheet, or export that worksheet as CSV.');
  const rels = await readXml(zip, 'xl/_rels/workbook.xml.rels', budget);
  const sheetId = sheets[0].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rel = elements(rels, 'Relationship').find((item) => item.getAttribute('Id') === sheetId);
  const target = rel?.getAttribute('Target') || '';
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  if (rel?.getAttribute('TargetMode') === 'External' || !/^xl\/worksheets\/[\w.-]+\.xml$/.test(sheetPath)) throw new Error('This workbook has an unsupported worksheet reference. Export it again.');
  const strings = zip.file('xl/sharedStrings.xml') ? elements(await readXml(zip, 'xl/sharedStrings.xml', budget), 'si').map(text) : [];
  const doc = await readXml(zip, sheetPath, budget);
  const rows = [];
  for (const row of elements(doc, 'row')) {
    const values = [];
    for (const cell of [...row.children].filter((item) => item.localName === 'c')) {
      const address = cell.getAttribute('r') || '';
      const match = /^([A-Z]{1,3})[1-9]\d*$/.exec(address);
      if (!match) throw new Error('This workbook contains an invalid cell address.');
      const column = [...match[1]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      if (column >= 100) throw new Error('Import a worksheet with no more than 100 columns.');
      if (values[column] !== undefined) throw new Error('This workbook contains duplicate cells.');
      if (child(cell, 'f')) throw new Error(`Cell ${address} contains a formula. Upload the original Pirate Ship export with values only.`);
      const type = cell.getAttribute('t');
      const raw = child(cell, 'v')?.textContent || '';
      let value = raw;
      if (type === 's') {
        if (!/^\d+$/.test(raw) || strings[Number(raw)] === undefined) throw new Error('This workbook contains an invalid text reference.');
        value = strings[Number(raw)];
      } else if (type === 'inlineStr') value = child(cell, 'is') ? text(child(cell, 'is')) : '';
      else if (type === 'e') throw new Error(`Cell ${address} contains an Excel error. Export the original data again.`);
      else if (raw && (!type || type === 'n')) {
        // A numeric Excel cell beyond 15 significant digits may already be rounded.
        // Do not silently turn that into a plausible, incorrect tracking number.
        if (/e/i.test(raw) || raw.replace(/^[+-]?0*/, '').replace(/\D/g, '').length > 15) throw new Error(`Cell ${address} contains a long number stored numerically. Export tracking numbers as text from Pirate Ship to preserve every digit.`);
      } else if (type && !['n', 'str', 'b', 'd'].includes(type)) throw new Error(`Cell ${address} has an unsupported value type.`);
      if (value.length > 10000) throw new Error('This workbook contains an unexpectedly large field.');
      values[column] = value;
    }
    if (values.some((value) => value?.trim())) rows.push(values);
    if (rows.length > MAX_CSV_ROWS + 1) throw new Error('Import up to 500 shipments at a time.');
  }
  const width = rows[0]?.length || 0;
  if (rows.some((row) => row.length > width)) throw new Error('Each shipment column must have a heading.');
  // Reuse CSV validation; all values stay strings, including long tracking IDs.
  return parseTrackingCsv(rows.map((row) => Array.from({ length: width }, (_, index) => `"${(row[index] || '').replace(/"/g, '""')}"`).join(',')).join('\n'));
}

export async function readTrackingFile(file) {
  if (file.size > MAX_CSV_BYTES) throw new Error('Choose a CSV or Excel file smaller than 2 MB.');
  if (/\.xlsx$/i.test(file.name)) return readXlsx(file);
  if (!/\.csv$/i.test(file.name)) throw new Error('Choose a .csv or .xlsx file.');
  const content = await file.text();
  if (content.includes('\0')) throw new Error('Choose UTF-8 CSV or the original .xlsx workbook.');
  return parseTrackingCsv(content);
}
