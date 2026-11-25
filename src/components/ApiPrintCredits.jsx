import { formatApiCreditAmount, getApiPrintCredits } from '../services/apiPrintCredits.mjs';

export default function ApiPrintCredits({ order, detailed = false }) {
  const credits = getApiPrintCredits(order);
  if (!credits) return null;
  const historical = ['refunded', 'cancelled'].includes(credits.state);
  const note = {
    refunded: 'Order refunded · original charge shown',
    cancelled: 'Order cancelled · check refund status',
    pending: 'Payment not confirmed',
  }[credits.state];
  const amount = formatApiCreditAmount(credits.creditCents);

  if (!detailed) return <div className="api-print-credits-summary">
    <span className="api-print-credits-badge">API print credits</span>
    <span>{amount}{credits.creditCents !== null && (credits.state === 'paid' ? ' used' : historical ? ' originally charged' : ' quoted')}</span>
    {note && <span className="api-print-credits-note">{note}</span>}
  </div>;

  return <section className="api-print-credits-detail" aria-label="API print credits">
    <h4>API print credits</h4>
    <p>Partner prepaid balance (USD).</p>
    <dl>
      <div><dt>{historical ? 'Original credit charge' : credits.state === 'paid' ? 'Credits used' : 'Quoted credits'}</dt><dd>{amount}</dd></div>
      {credits.customerPaymentCents !== null && <div><dt>{historical ? 'Original customer payment' : 'Separate customer payment'}</dt><dd>{formatApiCreditAmount(credits.customerPaymentCents)}</dd></div>}
      {credits.partnerId && <div><dt>Partner account ID</dt><dd>{credits.partnerId}</dd></div>}
    </dl>
    {note && <p className="api-print-credits-note">{note}</p>}
  </section>;
}
