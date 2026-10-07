import { useEffect, useState } from 'react';
import { Building2, RefreshCw, ExternalLink, Download } from 'lucide-react';
import { partnershipRequest } from '../services/partnerships';
import './PartnershipRequests.css';

const count = value => value == null ? '—' : Number(value).toLocaleString('en-US');
const date = value => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) : '—';
const percent = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : '—';
const money = (cents, currency) => currency === 'UNKNOWN' ? `${(cents / 100).toFixed(2)} (currency unknown)` : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
const blankActivity = { carts: 0, cardsSubmitted: 0, converted: 0, affiliateCarts: 0, productionOrders: 0, activeKeys: 0, webhookEvents: 0, webhooksDelivered: 0, webhooksPending: 0, webhooksExhausted: 0, cartStatuses: {}, productionStatuses: {}, validationErrors: {} };
const blankCommerce = { orders: 0, paidOrders: 0, pendingOrders: 0, failedPayments: 0, refundedOrders: 0, cancelledOrders: 0, cardsOrdered: 0, paidCards: 0, customers: 0, repeatCustomers: 0, affiliateOrders: 0, currencies: {}, statuses: {}, countries: {}, trend: {} };
function websiteHref(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function Metrics({ values }) {
  return <dl className="partner-metrics">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
function Breakdown({ title, values }) {
  const entries = Object.entries(values || {}).sort((a, b) => b[1] - a[1]);
  return <section className="partner-breakdown"><h4>{title}</h4>{entries.length ? <dl>{entries.map(([label, value]) => <div key={label}><dt>{label.replaceAll('_', ' ')}</dt><dd>{count(value)}</dd></div>)}</dl> : <p>No activity in this period.</p>}</section>;
}
function Analytics({ activity, commerce, compact = false, testMode = false }) {
  const months = Object.entries(commerce?.trend || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const maximum = Math.max(1, ...months.map(([, item]) => item.orders));
  return <>
    <Metrics values={[
      ['API + widget orders', count(commerce?.orders)], ['Paid orders', count(commerce?.paidOrders)],
      ['Pending payment', count(commerce?.pendingOrders)], ['Paid cards', count(commerce?.paidCards)],
      ['Carts submitted', count(activity?.carts)], ['Cart conversion', activity ? percent(activity.converted, activity.carts) : '—'],
    ]} />
    <details className="partner-analytics-details">
      <summary>{compact ? 'View partner analytics' : 'Revenue, customers and integration health'}</summary>
      {testMode && <p className="partnership-hint">Test keys create carts only; payments and manufacturing orders are disabled.</p>}
      {commerce ? <>
        <Metrics values={[
          ['Unique paying customers', count(commerce.customers)], ['Repeat customers', count(commerce.repeatCustomers)],
          ['Repeat customer rate', percent(commerce.repeatCustomers, commerce.customers)],
          ['Cards ordered (all orders)', count(commerce.cardsOrdered)], ['Cancelled orders', count(commerce.cancelledOrders)],
          ['Refunded orders', count(commerce.refundedOrders)], ['Failed payments', count(commerce.failedPayments)],
          ['Paid orders with a code', count(commerce.affiliateOrders)],
        ]} />
        {Object.entries(commerce.currencies).length ? <div className="partner-table-scroll"><table className="partner-revenue"><caption>Order value by currency</caption><thead><tr><th>Currency</th><th>Gross order value</th><th>Unrefunded order value</th><th>Average paid order</th><th>Refunded order value</th><th>Shipping</th><th>Discounts</th></tr></thead><tbody>{Object.entries(commerce.currencies).map(([currency, value]) => <tr key={currency}><th>{currency}</th>{[value.grossCents, value.retainedCents, value.paidOrders ? value.grossCents / value.paidOrders : 0, value.refundedOrderValueCents, value.shippingCents, value.discountCents].map((amount, i) => <td key={i}>{money(amount, currency)}</td>)}</tr>)}</tbody></table></div> : <p className="partnership-hint">No paid order value in this period.</p>}
        {Object.values(commerce.currencies).some(item => item.unknownAmounts) && <p className="partnership-warning">Some orders have missing amounts and are excluded from monetary totals.</p>}
        <p className="partnership-hint">Gross includes paid orders later refunded, including shipping and tax. Refunded order value is the full value of orders marked refunded, not a Stripe refund ledger. Partial refunds, profit, fees and payouts are not available here. Codes include affiliate and other checkout codes.</p>
        <div className="partner-breakdowns"><Breakdown title="Checkout order status" values={commerce.statuses} /><Breakdown title="Paid orders by destination" values={commerce.countries} /></div>
        {months.length > 0 && <section className="partner-trend"><h4>Order trend · calendar months (UTC)</h4>{months.map(([month, value]) => <div key={month}><span>{month}</span><meter min="0" max={maximum} value={value.orders} aria-label={`${month}: ${value.orders} orders`} /><span>{count(value.orders)} orders · {count(value.paidOrders)} paid</span></div>)}</section>}
        <p className="partnership-hint">First order in period: {date(commerce.firstOrderAt)} · Latest: {date(commerce.lastOrderAt)} (Pacific)</p>
      </> : <p className="partnership-warning">Checkout order analytics are unavailable.</p>}
      {activity ? <>
        <Metrics values={[
          ['Cards submitted', count(activity.cardsSubmitted)], ['Converted carts', count(activity.converted)],
          ['Carts with affiliate code', count(activity.affiliateCarts)], ['Received by production', count(activity.productionOrders)],
          ['Active API keys now', count(activity.activeKeys)], ['Webhook events', count(activity.webhookEvents)],
          ['Webhooks delivered', count(activity.webhooksDelivered)], ['Webhooks awaiting delivery', count(activity.webhooksPending)],
          ['Webhooks exhausted retries', count(activity.webhooksExhausted)], ['Webhook delivery rate', percent(activity.webhooksDelivered, activity.webhookEvents)],
        ]} />
        <div className="partner-breakdowns"><Breakdown title="Cart status" values={activity.cartStatuses} /><Breakdown title="Production status" values={activity.productionStatuses} /><Breakdown title="Artwork validation errors (items)" values={activity.validationErrors} /></div>
        <p className="partnership-hint">First cart in period: {date(activity.firstCartAt)} · Latest: {date(activity.lastCartAt)} (Pacific)</p>
      </> : <p className="partnership-warning">Integration analytics are unavailable.</p>}
    </details>
  </>;
}
function PartnershipCard({ request, activity, commerce, analyticsReady, testMode, onSaved }) {
  const [rejecting, setRejecting] = useState(false), [saving, setSaving] = useState(false);
  const [reason, setReason] = useState(''), [error, setError] = useState('');
  const site = websiteHref(request.website_url);
  const rejected = Boolean(request.api_blocked_at) || request.status === 'declined';
  async function reject(event) {
    event.preventDefault();
    if (saving || reason.trim().length < 3) return;
    setSaving(true); setError('');
    try { onSaved(await partnershipRequest({ action: 'revoke', id: request.id, reason: reason.trim(), expectedUpdatedAt: request.updated_at })); }
    catch (caught) { setError(caught.message); }
    finally { setSaving(false); }
  }
  const emailStatus = request.rejection_email?.status;
  return <article className="partnership-card">
    <div className="partnership-card-heading">
      <div><h2>{request.business_name}</h2><p>{request.full_name} · <a href={`mailto:${request.email}`}>{request.email}</a></p>{site && <a href={site} target="_blank" rel="noopener noreferrer">{request.website_url} <ExternalLink size={13} /></a>}</div>
      <div className="partner-card-actions"><span className={`partnership-badge ${rejected ? 'rejected' : request.status}`}>{rejected ? 'Rejected' : request.status === 'approved' ? 'Active' : 'Pending'}</span>{!rejected && <button className="partnership-decline" disabled={saving} onClick={() => setRejecting(true)}>Reject partner</button>}</div>
    </div>
    <p className="partnership-hint">Joined {date(request.created_at)} (Pacific)</p>
    {rejected && <div className="partner-rejection"><strong>Rejection reason</strong><p>{request.api_block_reason || request.admin_notes || 'No reason recorded.'}</p><p>{request.access_revoked_at && `Rejected ${date(request.access_revoked_at)} (Pacific). `}Email: {emailStatus === 'sent' ? `sent ${date(request.rejection_email.attemptedAt)} (Pacific)` : emailStatus === 'failed' ? 'failed to send — check the partner app’s Gmail configuration' : 'no confirmed sending record'}.{emailStatus === 'sent' && ' Sending is confirmed by Gmail; inbox delivery is not tracked.'}</p></div>}
    {rejecting && !rejected && <form className="partner-reject-form" onSubmit={reject}>
      <label htmlFor={`reason-${request.id}`}>Reason for rejection (included in the email)</label>
      <textarea id={`reason-${request.id}`} autoFocus required minLength={3} maxLength={2000} rows={3} disabled={saving} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why this partner is being rejected" />
      <p className="partnership-hint">This disables API and widget access, holds open carts and unshipped production, and emails the partner. Payments and refunds need a separate review.</p>
      <div className="partnership-actions"><button type="button" disabled={saving} onClick={() => { setRejecting(false); setError(''); }}>Cancel</button><button className="partnership-decline" disabled={saving || reason.trim().length < 3}>{saving ? 'Rejecting…' : 'Reject partner and send email'}</button></div>
      {error && <p role="alert" className="partnership-error">{error}</p>}
    </form>}
    {analyticsReady ? <Analytics activity={activity} commerce={commerce} compact testMode={testMode} /> : <p className="partnership-hint">Partner analytics are loading or unavailable.</p>}
  </article>;
}
export default function PartnershipRequests() {
  const [status, setStatus] = useState('all'), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState('30'), [mode, setMode] = useState('live');
  const [loaded, setLoaded] = useState({ key: null, data: { requests: [], total: 0, pageSize: 25 }, error: '' });
  const [stats, setStats] = useState({ key: null, data: null, error: '' }), [notice, setNotice] = useState(null);
  const key = `${status}:${page}:${revision}`, statsKey = `${period}:${mode}:${revision}`;
  const loading = loaded.key !== key, statsLoading = stats.key !== statsKey;
  const data = loaded.data, analytics = statsLoading ? null : stats.data;
  useEffect(() => {
    const controller = new AbortController();
    partnershipRequest({ action: 'list', status, page }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setLoaded({ key, data: result, error: '' });
    }).catch(error => { if (!controller.signal.aborted) setLoaded(previous => ({ ...previous, key, error: error.message })); });
    return () => controller.abort();
  }, [status, page, key]);
  useEffect(() => {
    const controller = new AbortController();
    partnershipRequest({ action: 'analytics', period, mode }, controller.signal).then(result => {
      if (!controller.signal.aborted) setStats({ key: statsKey, data: result, error: '' });
    }).catch(error => { if (!controller.signal.aborted) setStats({ key: statsKey, data: null, error: error.message }); });
    return () => controller.abort();
  }, [period, mode, statsKey]);
  function saved(result) {
    const sent = result.email?.sent;
    setNotice({ sent, text: `${result.request.business_name}: rejected; API and widget access disabled. ${sent ? 'Rejection email sent.' : result.email?.skipped ? 'This rejection was already saved; no duplicate email sent.' : 'The rejection email was not sent. Check Gmail configuration on the partner app.'}${sent && !result.email.recorded ? ' The email audit record could not be saved.' : ''}` });
    setRevision(value => value + 1);
  }
  function exportCsv() {
    const escape = value => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const rows = [['Partner ID', 'Partner (this page)', 'Period', 'Mode', 'Carts', 'Converted carts', 'Production orders', 'Checkout orders', 'Paid orders', 'Pending orders', 'Paid cards', 'Unique paying customers', 'Repeat customers']];
    const names = Object.fromEntries(data.requests.map(item => [item.id, item.business_name]));
    const ids = new Set([...Object.keys(analytics.partners), ...Object.keys(analytics.commerce?.partners || {})]);
    for (const id of ids) {
      const a = analytics.partners[id] || blankActivity, c = analytics.commerce?.available ? analytics.commerce.partners[id] || blankCommerce : null;
      rows.push([id, names[id] || id, period, mode, a.carts, a.converted, a.productionOrders, c?.orders, c?.paidOrders, c?.pendingOrders, c?.paidCards, c?.customers, c?.repeatCustomers]);
    }
    const url = URL.createObjectURL(new Blob(['\uFEFF', rows.map(row => row.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `partner-analytics-${mode}-${period}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <section className="partnership-page">
    <header className="partnership-heading"><div><h1 className="page-title"><Building2 size={30} /> Partnerships</h1><p>Partners, API + widget performance, and access decisions.</p></div><button className="partnership-refresh" disabled={loading || statsLoading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /> Refresh</button></header>
    {notice && <div role="status" className={notice.sent ? 'partnership-success' : 'partnership-warning'}>{notice.text}</div>}
    <section className="partner-overview" aria-label="All partner analytics">
      <div className="partner-toolbar"><h2>All partners</h2><label>Period<select value={period} onChange={event => setPeriod(event.target.value)}>{[['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 365 days'], ['all', 'All time']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>API mode<select value={mode} onChange={event => setMode(event.target.value)}><option value="live">Live</option><option value="test">Test</option></select></label><button disabled={!analytics} onClick={exportCsv}><Download size={16} /> Export CSV</button></div>
      <p className="partnership-hint">API and widget orders are combined. Dates filter each record’s creation time; statuses reflect its current state. Conversion is the share of carts created in the period that reached a paid order, including later cancellations or holds. Active keys are current, regardless of date. Partner status filters below do not change these totals.</p>
      {statsLoading ? <p role="status">Loading analytics…</p> : stats.error ? <p role="alert" className="partnership-error">{stats.error}</p> : analytics && <>
        {!analytics.commerce?.available && <p className="partnership-warning">{analytics.commerce?.error}</p>}
        {analytics.commerce?.unattributedOrders > 0 && <p className="partnership-warning">{count(analytics.commerce.unattributedOrders)} older orders have no partner ID. They are included in overall order totals but cannot be assigned to a partner.</p>}
        <Analytics activity={analytics.total} commerce={analytics.commerce?.available ? analytics.commerce.total : null} testMode={mode === 'test'} />
        <p className="partnership-hint">Updated {date(analytics.window.until)} (Pacific). Paid orders are counted from checkout records; production totals depend on successful payment handoff.</p>
      </>}
    </section>
    <nav className="partnership-filters" aria-label="Partner status">{[['all', 'All partners'], ['approved', 'Active'], ['rejected', 'Rejected'], ['pending', 'Pending']].map(([value, label]) => <button key={value} aria-pressed={status === value} className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>)}</nav>
    {loading ? <p role="status" className="partnership-empty">Loading partners…</p> : loaded.error ? <p role="alert" className="partnership-error">{loaded.error}</p> : <>
      <p className="partnership-count">{count(data.total)} partner{data.total === 1 ? '' : 's'}</p>
      <div className="partnership-list">{data.requests.map(request => <PartnershipCard key={`${request.id}:${request.updated_at}`} request={request} onSaved={saved} analyticsReady={Boolean(analytics)} testMode={mode === 'test'} activity={analytics ? analytics.partners[request.id] || blankActivity : null} commerce={analytics?.commerce?.available ? analytics.commerce.partners[request.id] || blankCommerce : null} />)}</div>
      {!data.requests.length && <p className="partnership-empty">No partners in this view.</p>}
      {pages > 1 && <div className="partnership-pagination"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} of {pages}</span><button disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div>}
    </>}
  </section>;
}
