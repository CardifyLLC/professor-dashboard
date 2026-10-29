import { validEmail } from './shipment-tracking.mjs';

export function envelopeOrderEligible(order) {
  // orders.quantity already includes all deck copies; never use the number of designs.
  const quantity = Number(order?.quantity);
  let metadata = order?.metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { return false; }
  }
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity < 45
    && metadata?.productType !== 'cardstock'
    && ['paid', 'processing', 'completed', 'shipped'].includes(String(order?.status).toLowerCase())
    && String(order?.payment_status).toLowerCase() === 'paid'
    && validEmail(order?.customer_email);
}

export function buildEnvelopeEmail(order) {
  const text = [
    order.customer_name ? `Hi ${order.customer_name},` : 'Hi,', '',
    'Your TCGPlaytest cards have shipped!', '',
    `Order: ${order.id}`, `Cards: ${order.quantity}`, '',
    'Your cards are coming via Plain White Envelope to your mailbox, usually in 3–6 business days.',
    'This shipment does not have a tracking number.', '',
    'You can see this shipping notification in your TCGPlaytest profile. Seven days after shipment, a “Get help with this order” button will appear beneath it.',
    'View your profile: https://www.tcgplaytest.com/profile', '',
    'Support: support@tcgplaytest.com', '', 'TCGPlaytest',
  ].join('\n');
  return { to: order.customer_email, subject: `Your TCGPlaytest order ${order.id} has shipped`, text };
}
