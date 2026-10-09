import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import './PrintPackagePurchases.css';

const money = (amount, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
const PAGE_SIZE = 20;

export default function PrintPackagePurchases({ data, loading, error }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.purchases || []).filter(row => [row.customer_name, row.customer_email, row.package_id, row.id].some(value => String(value || '').toLowerCase().includes(term)));
  }, [data, search]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);

  return <section className="print-purchases" aria-label="PRINTS package purchases">
    <div className="print-purchases-heading"><h2>PRINTS Package Purchases</h2><span>{data && !loading && !error ? `${data.count.toLocaleString()} paid purchases` : ''}</span></div>
    {loading ? <p role="status">Loading package purchases...</p> : error ? <p role="alert" className="print-purchases-error">{error}</p> : !data ? <p role="alert">Package purchase data is unavailable. Update the Stripe analytics function and refresh.</p> : <>
      <div className="print-purchases-totals">{data.currencies.map(summary => <div key={summary.currency}>
        <strong>{summary.currency}</strong>
        <span>Gross <b>{money(summary.gross_cents, summary.currency)}</b></span>
        <span>Refunds <b>{money(summary.refunded_cents, summary.currency)}</b></span>
        <span>Net <b>{money(summary.net_cents, summary.currency)}</b></span>
      </div>)}</div>
      <label className="print-purchases-search"><Search size={17} aria-hidden="true" /><input aria-label="Search package purchases" placeholder="Search customer, package or reference" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
      <div className="print-purchases-scroll"><table className="data-table">
        <thead><tr><th>Date</th><th>Customer</th><th>Package</th><th>PRINTS</th><th>Paid</th><th>Refunded</th><th>Status</th><th>Reference</th></tr></thead>
        <tbody>{rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(row => <tr key={row.id}>
          <td>{new Date(row.created_at).toLocaleString()}</td>
          <td><strong>{row.customer_name || 'Customer'}</strong><small>{row.customer_email || '-'}</small></td>
          <td>{row.package_id}</td><td>{row.immediate_prints.toLocaleString()}<small>+{row.locked_prints.toLocaleString()} delayed bonus</small></td>
          <td>{money(row.amount_cents, row.currency)}</td><td>{money(row.refunded_cents, row.currency)}</td><td>{row.status}</td><td className="print-purchases-reference">{row.id}</td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <p>{search ? 'No matching purchases.' : 'No paid PRINTS package purchases in this period.'}</p>}
      {pages > 1 && <div className="print-purchases-pagination"><span>Page {currentPage} of {pages}</span><button type="button" aria-label="Previous purchases" title="Previous purchases" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><button type="button" aria-label="Next purchases" title="Next purchases" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div>}
    </>}
  </section>;
}
