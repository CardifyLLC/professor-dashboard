import { useEffect, useState } from 'react';
import { Building2, RefreshCw, ExternalLink, ShoppingBag } from 'lucide-react';
import { partnershipRequest } from '../services/partnerships';
import './PartnershipRequests.css';

const statuses = ['all', 'approved', 'revoked', 'declined'];
const displayDate = value => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) : '—';
const displayCount = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-US') : '—';
function websiteHref(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

function PartnershipCard({ request, onSaved }) {
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const site = websiteHref(request.website_url);
  const accessStatus = request.api_blocked_at ? 'revoked' : request.status;

  async function revoke() {
    if (saving) return;
    if (revokeReason.trim().length < 3) { setError('Enter a reason for revoking access.'); return; }
    setSaving('revoke'); setError('');
    try { onSaved(await partnershipRequest({ action: 'revoke', id: request.id, reason: revokeReason.trim(), expectedUpdatedAt: request.updated_at })); }
    catch (caught) { setError(caught.message); }
    finally { setSaving(''); }
  }

  return <article className="partnership-card">
    <div className="partnership-applicant">
      <div className="partnership-card-heading"><h2>{request.business_name}</h2><span className={`partnership-badge ${accessStatus}`}>{accessStatus}</span></div>
      <p>{request.full_name || 'Applicant'} · <a href={`mailto:${request.email}`}>{request.email}</a></p>
      {site ? <a className="partnership-website" href={site} target="_blank" rel="noopener noreferrer">{request.website_url} <ExternalLink size={14} /></a> : <span>{request.website_url}</span>}
      <div className="partnership-order-count">
        <ShoppingBag size={19} aria-hidden="true" />
        <span>API + widget orders</span>
        <strong>{displayCount(request.order_count)}</strong>
      </div>
      <dl className="partnership-details">
        <div><dt>Submitted (Pacific)</dt><dd>{displayDate(request.created_at)}</dd></div>
        <div><dt>Approval</dt><dd>{request.auto_approved_at ? 'Automatic' : request.status === 'pending' ? 'Activation incomplete' : 'Previously reviewed'}</dd></div>
        <div><dt>Welcome email</dt><dd>{request.welcome_email_sent_at ? `Sent ${displayDate(request.welcome_email_sent_at)}` : request.welcome_email_next_attempt_at ? 'Queued for delivery' : '—'}</dd></div>
        {request.status !== 'pending' && <>
          <div><dt>Reviewed (Pacific)</dt><dd>{displayDate(request.reviewed_at)}</dd></div>
          <div><dt>Reviewed by</dt><dd>{request.reviewed_by || '—'}</dd></div>
        </>}
      </dl>
      {request.audience && <div className="partnership-text"><strong>Audience / application details</strong><p>{request.audience}</p></div>}
      {request.api_block_reason && <div className="partnership-text"><strong>Revocation / enforcement reason</strong><p>{request.api_block_reason}</p></div>}
      {request.access_revoked_at && <p>Revoked {displayDate(request.access_revoked_at)} by {request.access_revoked_by || 'administrator'}.</p>}
      {request.welcome_email_last_error && <p className="partnership-warning">{request.welcome_email_last_error}</p>}
    </div>
    <div className="partnership-review">
        <h3>{accessStatus === 'revoked' ? 'Access revoked' : request.status === 'approved' ? 'Partnership active' : request.status === 'pending' ? 'Activation incomplete' : 'Application declined'}</h3>
        {accessStatus === 'pending' && <p className="partnership-warning">This submission should activate automatically. Apply the pending-partner activation migration to the partner database and deploy the updated registration API.</p>}
        <p className="partnership-hint">{accessStatus === 'revoked' ? 'API keys are revoked and new checkouts and production access are blocked. Signing up again does not restore this account.' : request.status === 'approved' ? 'The partner can copy their widget, accept the manufacturing terms, and create API keys in the partner app.' : 'The partner has not been granted API access.'}</p>
        {request.admin_notes && <div className="partnership-text"><strong>Review notes</strong><p>{request.admin_notes}</p></div>}
        {['approved', 'pending'].includes(accessStatus) && <>
          <label htmlFor={`revoke-${request.id}`}>Reason for revoking access</label>
          <textarea id={`revoke-${request.id}`} value={revokeReason} maxLength={2000} rows={3} disabled={Boolean(saving)} onChange={event => setRevokeReason(event.target.value)} placeholder="Describe the suspicious activity or infringement report" />
          <p className="partnership-hint">Revokes keys and holds open carts, artwork, and unshipped manufacturing orders. Stop physical production and review refunds separately.</p>
          <button className="partnership-decline" type="button" disabled={Boolean(saving) || revokeReason.trim().length < 3} onClick={revoke}>{saving === 'revoke' ? 'Revoking…' : 'Revoke access'}</button>
          {error && <p role="alert" className="partnership-error">{error}</p>}
        </>}
    </div>
  </article>;
}

export default function PartnershipRequests() {
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState({ key: null, data: { requests: [], total: 0, pageSize: 25 }, error: '' });
  const [notice, setNotice] = useState(null);
  const key = `${status}:${page}:${revision}`;
  const loading = loaded.key !== key;
  const data = loaded.data;
  const error = loading ? '' : loaded.error;

  useEffect(() => {
    const controller = new AbortController();
    partnershipRequest({ action: 'list', status, page }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setLoaded({ key, data: result, error: '' });
    }).catch(caught => { if (!controller.signal.aborted) setLoaded(previous => ({ ...previous, key, error: caught.message })); });
    return () => controller.abort();
  }, [status, page, key]);

  function saved(result) {
    setNotice({ sent: true, text: `${result.request.business_name}: access revoked. API keys, open carts, and unshipped production are blocked.` });
    setRevision(value => value + 1);
  }

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <section className="partnership-page">
    <header className="partnership-heading">
      <div><h1 className="page-title"><Building2 size={30} /> Partnerships</h1><p>New applications activate automatically. View approvals, email delivery, and revoke widget and API access when necessary.</p></div>
      <button type="button" className="partnership-refresh" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /> Refresh</button>
    </header>
    <nav className="partnership-filters" aria-label="Application status">
      {statuses.map(value => <button type="button" key={value} aria-pressed={status === value} className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setPage(1); }}>{value}</button>)}
    </nav>
    {notice && <div role="status" className={notice.sent ? 'partnership-success' : 'partnership-warning'}>{notice.text}</div>}
    {error ? <div role="alert" className="partnership-error">{error}</div> : loading ? <p role="status" className="partnership-empty">Loading partnership requests…</p> : <>
      <div className="partnership-order-summary">
        <ShoppingBag size={26} aria-hidden="true" />
        <div><span>API + widget orders</span><p>All partners · all time</p></div>
        <strong>{displayCount(data.totalOrders)}</strong>
      </div>
      {(data.orderCountsUnavailable || data.totalOrders == null) && <p role="status" className="partnership-warning">Order totals are temporarily unavailable. Refresh to try again.</p>}
      <p className="partnership-count">{data.total} {status === 'all' ? '' : `${status} `}application{data.total === 1 ? '' : 's'}</p>
      {data.requests.length ? <div className="partnership-list">{data.requests.map(request => <PartnershipCard key={`${request.id}:${request.updated_at}`} request={request} onSaved={saved} />)}</div>
        : <div className="partnership-empty">No {status === 'all' ? '' : `${status} `}partnership requests.</div>}
      {pages > 1 && <div className="partnership-pagination"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} of {pages}</span><button disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div>}
    </>}
  </section>;
}
