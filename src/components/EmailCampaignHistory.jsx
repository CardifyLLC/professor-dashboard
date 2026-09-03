import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, MailCheck, RefreshCw, Search, XCircle } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import './EmailCampaignHistory.css';

const PAGE_SIZE = 50;
const STATUSES = ['all', 'accepted', 'failed', 'processing', 'skipped_unsubscribed'];
const formatDate = (value) => value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const formatStatus = (value) => (value || 'unknown').replaceAll('_', ' ');
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

function StatusBadge({ status }) {
  return <span className={`eh-status eh-status--${status}`}>{formatStatus(status)}</span>;
}

export default function EmailCampaignHistory() {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [counts, setCounts] = useState({ all: 0, accepted: 0, failed: 0, processing: 0, skipped_unsubscribed: 0 });
  const [loading, setLoading] = useState(true);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const selected = useMemo(() => campaigns.find(({ id }) => id === selectedId), [campaigns, selectedId]);

  const loadCampaigns = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error: requestError } = await supabase.from('bulk_email_campaigns')
      .select('id, subject, total_recipients, total_batches, status, created_at, completed_at')
      .order('created_at', { ascending: false }).limit(100);
    if (requestError) { setError(requestError.message); setCampaigns([]); }
    else {
      const rows = data || [];
      setCampaigns(rows);
      setSelectedId((current) => rows.some(({ id }) => id === current) ? current : rows[0]?.id || null);
    }
    setLoading(false);
  }, []);

  const loadDeliveries = useCallback(async () => {
    if (!selectedId) { setDeliveries([]); return; }
    setDeliveryLoading(true); setError('');
    let rowsQuery = supabase.from('bulk_email_deliveries')
      .select('id, recipient_email, status, gmail_message_id, error, attempted_at, accepted_at')
      .eq('campaign_id', selectedId).order('attempted_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (status !== 'all') rowsQuery = rowsQuery.eq('status', status);
    if (search.trim()) rowsQuery = rowsQuery.ilike('recipient_email', `%${search.trim()}%`);
    const countQueries = [null, ...STATUSES.slice(1)].map((item) => {
      let query = supabase.from('bulk_email_deliveries').select('id', { count: 'exact', head: true }).eq('campaign_id', selectedId);
      if (item) query = query.eq('status', item);
      return query;
    });
    const [rowsResult, ...countResults] = await Promise.all([rowsQuery, ...countQueries]);
    const requestError = rowsResult.error || countResults.find(({ error: countError }) => countError)?.error;
    if (requestError) { setError(requestError.message); setDeliveries([]); }
    else {
      setDeliveries(rowsResult.data || []);
      setCounts(Object.fromEntries(STATUSES.map((item, index) => [item, countResults[index].count || 0])));
    }
    setDeliveryLoading(false);
  }, [page, search, selectedId, status]);

  useEffect(() => {
    // The callback performs the asynchronous initial database load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCampaigns();
  }, [loadCampaigns]);
  useEffect(() => {
    // The callback performs the asynchronous load for the active filters.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDeliveries();
  }, [loadDeliveries]);

  const exportCsv = async () => {
    let query = supabase.from('bulk_email_deliveries')
      .select('recipient_email, status, gmail_message_id, error, attempted_at, accepted_at')
      .eq('campaign_id', selectedId).order('attempted_at').limit(10000);
    if (status !== 'all') query = query.eq('status', status);
    if (search.trim()) query = query.ilike('recipient_email', `%${search.trim()}%`);
    const { data, error: requestError } = await query;
    if (requestError) { setError(requestError.message); return; }
    const fields = ['recipient_email', 'status', 'gmail_message_id', 'error', 'attempted_at', 'accepted_at'];
    const csv = [fields.join(','), ...(data || []).map((row) => fields.map((field) => csvCell(row[field])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `email-campaign-${selectedId}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(counts[status] / PAGE_SIZE));
  return <div className="email-history">
    <header className="eh-header"><div><p>EMAIL DELIVERY RECORDS</p><h1 className="page-title">Email History</h1><span>Campaign receipts and Gmail acceptance results.</span></div><button onClick={() => { loadCampaigns(); loadDeliveries(); }}><RefreshCw size={16} /> Refresh</button></header>
    {error && <div className="eh-error">{error}</div>}
    <section className="eh-card">
      <div className="eh-title"><div><h2>Campaigns</h2><span>Latest 100 campaigns</span></div><b>{campaigns.length}</b></div>
      {loading ? <div className="eh-empty">Loading campaigns…</div> : campaigns.length === 0 ? <div className="eh-empty">No campaign receipts found.</div> : <div className="eh-campaigns">
        {campaigns.map((campaign) => <button key={campaign.id} className={selectedId === campaign.id ? 'active' : ''} onClick={() => { setSelectedId(campaign.id); setPage(1); }}>
          <div className="eh-campaign-name"><i><MailCheck size={19} /></i><div><strong>{campaign.subject || '(No subject)'}</strong><span>{formatDate(campaign.created_at)}</span></div></div>
          <div className="eh-campaign-meta"><span>{campaign.total_recipients.toLocaleString()} recipients</span><span>{campaign.total_batches} {campaign.total_batches === 1 ? 'batch' : 'batches'}</span><StatusBadge status={campaign.status} /></div>
        </button>)}
      </div>}
    </section>
    {selected && <section className="eh-card">
      <div className="eh-selected"><div><p>SELECTED CAMPAIGN</p><h2>{selected.subject || '(No subject)'}</h2><code>{selected.id}</code></div><button className="eh-export" onClick={exportCsv}><Download size={16} /> Export CSV</button></div>
      <div className="eh-stats"><div><MailCheck /><span>Total</span><strong>{counts.all}</strong></div><div><CheckCircle2 /><span>Accepted</span><strong>{counts.accepted}</strong></div><div><XCircle /><span>Failed</span><strong>{counts.failed}</strong></div><div><RefreshCw /><span>Pending / skipped</span><strong>{counts.processing + counts.skipped_unsubscribed}</strong></div></div>
      <div className="eh-tools"><label><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search recipient email…" /></label><div>{STATUSES.map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => { setStatus(item); setPage(1); }}>{formatStatus(item)}{item !== 'all' ? ` (${counts[item]})` : ''}</button>)}</div></div>
      <div className="eh-table-wrap"><table><thead><tr><th>Recipient</th><th>Status</th><th>Gmail message ID</th><th>Attempted</th><th>Accepted</th><th>Error</th></tr></thead><tbody>
        {deliveryLoading ? <tr><td colSpan="6" className="eh-empty">Loading deliveries…</td></tr> : deliveries.length === 0 ? <tr><td colSpan="6" className="eh-empty">No matching deliveries.</td></tr> : deliveries.map((delivery) => <tr key={delivery.id}><td className="eh-email">{delivery.recipient_email}</td><td><StatusBadge status={delivery.status} /></td><td><code>{delivery.gmail_message_id || '—'}</code></td><td>{formatDate(delivery.attempted_at)}</td><td>{formatDate(delivery.accepted_at)}</td><td className={delivery.error ? 'eh-row-error' : ''}>{delivery.error || '—'}</td></tr>)}
      </tbody></table></div>
      <footer className="eh-footer"><span>Page {page} of {totalPages} · {counts[status]} records</span><div><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer>
      <small>Accepted means Gmail accepted the message for delivery; it does not guarantee inbox placement.</small>
    </section>}
  </div>;
}
