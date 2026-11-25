import { useEffect, useState } from 'react';
import { getAdminAuthHeaders } from '../services/supabaseClient';
import './PrintPackagePurchases.css';
import './ApiPrintCreditPurchases.css';

const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const date = value => new Date(value).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });

export default function ApiPrintCreditPurchases({ refreshVersion = 0 }) {
  const [mode, setMode] = useState('live');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError('');
      try {
        const headers = await getAdminAuthHeaders();
        const response = await fetch(`/api/print-credit-purchases?mode=${mode}&page=${page}`, {
          headers, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result) throw new Error(result?.error || 'Could not load API print credit purchases.');
        if (!Array.isArray(result.purchases) || result.mode !== mode || result.page !== page
          || !Number.isSafeInteger(result.total) || result.pageSize !== 25) throw new Error('API print credit purchases are unavailable. Update the dashboard API and refresh.');
        if (!controller.signal.aborted) setData(result);
      } catch (loadError) {
        if (!controller.signal.aborted) { setData(null); setError(loadError.message || 'Could not load API print credit purchases.'); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [mode, page, refreshVersion, retry]);

  // Never display stale live rows under a newly selected Test heading (or vice versa).
  const current = !loading && data?.mode === mode && data?.page === page ? data : null;
  const pages = Math.max(1, Math.ceil((current?.total || 0) / 25));
  return <section className="print-purchases api-credit-purchases" aria-labelledby="api-credit-purchases-heading">
    <div className="print-purchases-heading">
      <h2 id="api-credit-purchases-heading">API Print Credit Purchases</h2>
      <div className="api-credit-purchases-controls">
        <label>Payment mode <select aria-label="API credit purchase payment mode" value={mode} onChange={event => { setMode(event.target.value); setPage(1); }}>
          <option value="live">Live purchases</option><option value="test">Test purchases</option>
        </select></label>
        <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>Refresh purchases</button>
      </div>
    </div>
    <p className="api-credit-purchases-description">Partner/API prepaid credit top-ups in USD. Confirmed payments only. Credit after reversals excludes refunds and disputes; order spending does not reduce this figure.</p>
    {mode === 'test' && <p className="api-credit-purchases-test" role="status">Test payments only — no real money collected.</p>}
    {loading ? <p role="status">Loading API print credit purchases...</p> : error ? <p role="alert" className="print-purchases-error">{error}</p> : current && <>
      <p className="api-credit-purchases-count">{current.total.toLocaleString()} confirmed {mode} purchase{current.total === 1 ? '' : 's'}</p>
      {current.purchases.length > 0 ? <div className="print-purchases-scroll"><table className="data-table">
        <thead><tr><th>Started (Pacific)</th><th>Customer / partner</th><th>Purchased</th><th>Reversed</th><th>Credit after reversals</th><th>Status</th><th>Purchase reference</th></tr></thead>
        <tbody>{current.purchases.map(row => <tr key={row.id}>
          <td>{date(row.created_at)}</td>
          <td><strong>{row.customer_name || row.business_name || 'Partner account'}</strong>
            {row.business_name && row.business_name !== row.customer_name && <small>{row.business_name}</small>}
            <small>{row.customer_email || row.partner_id}</small></td>
          <td>{money(row.amount_cents)}</td><td>{money(row.reversed_cents)}</td><td>{money(row.net_credit_cents)}</td>
          <td>{row.status}</td><td className="print-purchases-reference">{row.id}</td>
        </tr>)}</tbody>
      </table></div> : <p>No confirmed {mode} credit purchases{page > 1 ? ' on this page' : ' yet'}.</p>}
      {(pages > 1 || page > 1) && <div className="api-credit-purchases-pagination">
        <span>Page {page} of {pages}</span>
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button>
        <button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button>
      </div>}
    </>}
  </section>;
}
