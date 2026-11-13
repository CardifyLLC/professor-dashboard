import { useEffect, useState } from 'react';

function amount(value, currency) {
  if (!Number.isSafeInteger(value)) return 'Unavailable';
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(value / (10 ** digits));
}

export default function FinancialSummary({ financials, loading, error }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  if (loading) return <section className="detail-section" aria-label="Cash reporting"><p role="status">Loading cash reporting…</p></section>;
  if (error || !['business-v2','business-v3'].includes(financials?.version)) return <section className="detail-section" aria-label="Cash reporting"><p role="alert">Cash reporting unavailable. {error || 'The reporting service needs updating.'}</p></section>;
  const fetched = Date.parse(financials.fetched_at);
  const stale = !Number.isFinite(fetched) || now - fetched > 15 * 60 * 1000;
  return <section className="detail-section" aria-label="Cash reporting">
    <h2>Cash reporting</h2>
    <p>{financials.source} · {financials.period.timezone} · {financials.period.start || 'All available history'} to {financials.period.end} (exclusive)</p>
    <p role="status">{stale ? 'Stale — refresh required' : `Refreshed ${financials.fetched_at}`} · {financials.status} · Reconciliation: {financials.reconciliation.status}</p>
    {financials.reconciliation.stripe_and_prints&&<p>Stripe and PRINTS: {stale?'Stale — refresh required':financials.reconciliation.stripe_and_prints.status}. This check excludes PayPal; see overall coverage above.</p>}
    {financials.warnings.map(warning => <p key={warning}>{warning}</p>)}
    <div className="stats-grid">{financials.currencies.map(row => <div className="stat-card" key={row.currency}>
      <h3>{row.currency}</h3>
      <p>Cash collected: <strong>{amount(row.cash_collected_minor, row.currency)}</strong></p>
      <p>Refunds: <strong>{amount(row.refunds_minor, row.currency)}</strong></p>
      <p>Net cash: <strong>{amount(row.net_cash_minor, row.currency)}</strong></p>
    </div>)}</div>
    {!financials.currencies.length && <p>{financials.status==='available'?'No recorded cash movements in this period.':'Cash sources are incomplete; empty results do not mean zero sales.'}</p>}
    <p>PRINTS purchased: {financials.prints?.purchased??'Unavailable'} · Redeemed: {financials.prints?.redeemed??'Unavailable'} · Redemption reversals: {financials.prints?.redemption_reversed??'Unavailable'}</p>
    <details><summary>Reconciliation exceptions ({financials.reconciliation.issues.length})</summary>
      {financials.reconciliation.issues.map((issue, index) => <p key={index}>{issue.provider} · {issue.reference} · {issue.reason}</p>)}
    </details>
    {!!financials.reconciliation.excluded_movements?.length&&<details><summary>Other balance movements ({financials.reconciliation.excluded_movements.length})</summary>
      {financials.reconciliation.excluded_movements.map(item=><p key={item.reference}>{item.provider} · {item.reference} · {item.kind} · {amount(item.amount_minor,item.currency)}</p>)}
    </details>}
  </section>;
}
