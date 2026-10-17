// Shared by the CSV review screen and the authenticated Edge Function.
export const MAX_CSV_ROWS = 500;
export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Asendia'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTrackingCsv(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_CSV_BYTES) throw new Error('Choose a CSV smaller than 2 MB.');
  const text = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ''; closed = false; };
  const finishRow = () => {
    finishCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    if (rows.length > MAX_CSV_ROWS + 1) throw new Error('Import up to 500 shipments at a time.');
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === ',') finishCell();
    else if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && text[index + 1] === '\n') index++;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed && !/\s/.test(char)) throw new Error('Invalid CSV quoting. Upload the original Pirate Ship CSV.');
    else if (!closed) cell += char;
    if (cell.length > 10000 || row.length > 100) throw new Error('This CSV has an unexpectedly large field or too many columns.');
  }
  if (quoted) throw new Error('The CSV ends inside a quoted field. Export it again.');
  if (cell || row.length || closed) finishRow();
  if (rows.length < 2) throw new Error('The CSV needs a header and at least one shipment.');
  const headers = rows.shift().map((value) => value.trim());
  if (headers.length < 2 || headers.some((value) => !value)) throw new Error('Each CSV column must have a heading.');
  if (rows.some((values) => values.length !== headers.length)) throw new Error('CSV rows have different column counts. Upload the original export.');
  return { headers, rows };
}

const headerKey = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
export function suggestColumns(headers) {
  const aliases = {
    reference: ['orderid', 'ordernumber', 'orderreference', 'tcgplaytestorderid', 'tcgporderid'],
    tracking: ['trackingnumber', 'trackingid', 'tracking', 'usps tracking number', 'ups tracking number'],
    carrier: ['carrier', 'shippingcarrier', 'service', 'shippingservice'],
    email: ['email', 'emailaddress', 'recipientemail', 'customeremail'],
  };
  return Object.fromEntries(Object.entries(aliases).map(([field, names]) => {
    const matches = headers.map((name, index) => names.map(headerKey).includes(headerKey(name)) ? index : -1).filter((index) => index >= 0);
    return [field, matches.length === 1 ? String(matches[0]) : ''];
  }));
}

// Some spreadsheet exports wrap text identifiers as ="00123". Never evaluate formulas.
export function identifier(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = /^="([a-zA-Z0-9_-]+)"$/.exec(text);
  return match ? match[1] : text;
}

export function referenceType(value) {
  if (UUID.test(value)) return 'id';
  if (/^cs_(?:test_|live_)?[A-Za-z0-9_]{8,180}$/.test(value)) return 'stripe_session_id';
  if (/^temp_[A-Za-z0-9_-]{8,180}$/.test(value)) return 'metadata->>tempOrderId';
  return null;
}

export function normalizeCarrier(value) {
  const text = String(value || '').trim();
  if (/\bAsendia\b|Simple Export Rate/i.test(text)) return 'Asendia';
  if (/\bUSPS\b|United States Postal/i.test(text)) return 'USPS';
  if (/\bUPS\b|United Parcel/i.test(text)) return 'UPS';
  if (/\bFedEx\b|Federal Express/i.test(text)) return 'FedEx';
  if (/\bDHL\b/i.test(text)) return 'DHL';
  return '';
}

// Detect only recognizable formats. Ambiguous numeric IDs must not be
// assigned to a guessed carrier; they can still be sent as tracking numbers.
export function detectCarrier(tracking) {
  if (/^AHOY[A-Z0-9]+$/.test(tracking)) return 'Asendia';
  if (/^1Z[A-Z0-9]{16}$/.test(tracking)) return 'UPS';
  if (/^9[2345]\d{20}$/.test(tracking) || /^[A-Z]{2}\d{9}US$/.test(tracking)) return 'USPS';
  return '';
}

export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value);
}

export function normalizeShipment(input = {}) {
  const reference = identifier(input.reference);
  const rawTracking = identifier(input.tracking);
  const tracking = rawTracking.replace(/[\s-]/g, '').toUpperCase();
  const carrier = normalizeCarrier(input.carrier) || detectCarrier(tracking);
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const row = { reference: UUID.test(reference) ? reference.toLowerCase() : reference, tracking, carrier, email };
  if (!referenceType(reference)) return { row, error: 'Enter the full TCGPlaytest order ID (UUID), saved Stripe Checkout session ID, or tempOrderId. Email is not an order ID.' };
  if (/^[-+]?\d+(?:\.\d+)?e[-+]?\d+$/i.test(rawTracking) || !/^[A-Z0-9]{8,40}$/.test(tracking)) return { row, error: 'Invalid tracking number. Use the original CSV; spreadsheet rounding or scientific notation cannot be recovered.' };
  if (tracking.startsWith('AHOY') && carrier !== 'Asendia') return { row, error: 'AHOY tracking conflicts with the carrier in this file. Correct or remove the Carrier / Service column.' };
  if (email && !validEmail(email)) return { row, error: 'The CSV email is invalid. Check the column mapping.' };
  return { row, error: null };
}

export function trackingUrl(carrier, tracking) {
  const id = encodeURIComponent(tracking);
  const urls = {
    USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${id}`,
    UPS: `https://www.ups.com/track?tracknum=${id}`,
    FedEx: `https://www.fedex.com/fedextrack/?trknbr=${id}`,
    DHL: `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${id}`,
    Asendia: `https://a1.asendiausa.com/tracking/?trackingnumber=${id}`,
  };
  return urls[carrier] || '';
}

export function orderSnapshot(order) {
  return {
    customer_name: order.customer_name ?? null,
    customer_email: order.customer_email ?? null,
    quantity: order.quantity ?? null,
    status: order.status ?? null,
    payment_status: order.payment_status ?? null,
    shipping_address: order.shipping_address ?? null,
    uploaded_xml_filename: order.uploaded_xml_filename ?? null,
    design_name: order.design_name ?? null,
  };
}

export function orderProblem(order, row) {
  if (!validEmail(order.customer_email)) return 'This order has no valid customer email.';
  if (!['paid', 'processing', 'shipped', 'completed'].includes(order.status) || order.payment_status !== 'paid') return 'Only paid, non-cancelled orders can receive tracking emails.';
  if (row.email && row.email !== order.customer_email.toLowerCase()) return 'CSV email differs from the customer email on this order. Verify the order ID.';
  return null;
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function buildTrackingEmail(order, shipment) {
  const address = order.shipping_address?.address || order.shipping_address || {};
  const destination = [address.city, address.state, address.postal_code || address.zip, address.country].filter(Boolean).join(', ');
  const date = new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const details = [
    ['Order', order.id], ['Order date', date], ['Cards', order.quantity],
    ...(order.design_name || order.uploaded_xml_filename ? [['Design', order.design_name || order.uploaded_xml_filename]] : []),
    ...(destination ? [['Destination', destination]] : []),
    ...(shipment.carrier ? [['Carrier', shipment.carrier]] : []), ['Tracking number', shipment.tracking],
  ];
  const url = trackingUrl(shipment.carrier, shipment.tracking);
  const greeting = order.customer_name ? `Hi ${order.customer_name},` : 'Hi,';
  const note = 'A shipping label has been created for this order. Tracking updates appear after the carrier scans your package.';
  const subject = `Tracking for your TCGPlaytest order ${order.id}`;
  const trackingText = url ? `Track your package: ${url}` : 'Use the tracking number above on your carrier’s tracking website. If you need help finding the carrier, reply to this email.';
  const trackingHtml = url ? `<p style="margin:28px 0"><a href="${escapeHtml(url)}" style="background:#123459;color:white;padding:14px 20px;border-radius:8px;text-decoration:none">Track your package</a></p>` : `<p>${escapeHtml(trackingText)}</p>`;
  const text = `${greeting}\n\nYour order tracking is ready.\n\n${details.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\n${trackingText}\n\n${note}\n\nQuestions? Reply to this email or contact support@tcgplaytest.com.\n\nTCGPlaytest`;
  const html = `<div style="font:16px/1.6 Arial,sans-serif;color:#172033;max-width:620px;margin:auto;padding:24px"><h1 style="font-size:24px">Your order tracking is ready</h1><p>${escapeHtml(greeting)}</p><table style="width:100%;border-collapse:collapse">${details.map(([label, value]) => `<tr><th align="left" style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(label)}</th><td style="padding:8px;border-bottom:1px solid #ddd;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('')}</table>${trackingHtml}<p>${note}</p><p>Questions? Reply to this email or contact <a href="mailto:support@tcgplaytest.com">support@tcgplaytest.com</a>.</p><p>TCGPlaytest</p></div>`;
  return { to: order.customer_email, subject, text, html };
}
