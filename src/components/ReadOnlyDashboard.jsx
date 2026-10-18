import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, LogOut, RefreshCw } from 'lucide-react';
import { TEAM_SECTIONS, BATCHER_PERMISSION } from '../../shared/team-permissions.mjs';
import { dashboardAccessRequest } from '../services/dashboardAccess';
import { supabase } from '../services/supabaseClient';
import { orderLink, restoreOrderAfterSignIn, validOrderId } from '../services/orderLinks.mjs';
import './TeamAccess.css';
import TeamOrderDownloads from './TeamOrderDownloads';
import CardBatcherPro from './BatcherPRO';

const date = value => value ? new Date(value).toLocaleString() : '—';
function money(value, currency) {
  if (value === null || value === undefined) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(Number(value) / 100); }
  catch { return (Number(value) / 100).toFixed(2) + ' ' + (currency || ''); }
}
const cell = (row, [field, , format]) => format === 'date' ? date(row[field]) : format === 'money' ? money(row[field], row.currency) : String(row[field] ?? '—');

export default function ReadOnlyDashboard({ access, onAccessLost }) {
  const sections = [...TEAM_SECTIONS, BATCHER_PERMISSION].filter(section => access.permissions.includes(section.id));
  const [section, setSection] = useState(() => access.permissions.includes('orders') && new URL(window.location.href).searchParams.has('order') ? 'orders' : sections[0]?.id);
  const [rows, setRows] = useState([]), [offset, setOffset] = useState(0), [nextOffset, setNextOffset] = useState(null);
  const [search, setSearch] = useState(''), [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [detail, setDetail] = useState(null), [detailError, setDetailError] = useState(''), [detailLoading, setDetailLoading] = useState(false);
  const modal = useRef(null), generation = useRef(0), detailGeneration = useRef(0);
  const definition = sections.find(item => item.id === section);
  const canReadOrders = access.permissions.includes('orders');
  const load = useCallback(async (page = 0) => {
    const version = ++generation.current;
    if (!TEAM_SECTIONS.some(item => item.id === section)) { setLoading(false); return; }
    setLoading(true); setError(''); setRows([]);
    try {
      const result = await dashboardAccessRequest('/api/dashboard-read?' + new URLSearchParams({ section, offset: String(page), q: appliedSearch }));
      if (version === generation.current) { setRows(result.rows); setOffset(page); setNextOffset(result.nextOffset); }
    } catch (err) { if (version === generation.current) { setError(err.message); if ([401, 403].includes(err.status)) onAccessLost(); } }
    finally { if (version === generation.current) setLoading(false); }
  }, [section, appliedSearch, onAccessLost]);
  useEffect(() => { const counter = generation; load(0); return () => { counter.current++; }; }, [load]);
  const openDetail = useCallback(async (id, kind) => {
    const version = ++detailGeneration.current;
    setDetail(null); setDetailError('');
    if (!id) { setDetailLoading(false); return; }
    setDetailLoading(true);
    try {
      if (!validOrderId(id)) throw new Error('This record link is invalid.');
      const result = await dashboardAccessRequest('/api/dashboard-read?' + new URLSearchParams({ section: kind, id }));
      if (version === detailGeneration.current) setDetail(result);
    } catch (err) { if (version === detailGeneration.current) { setDetailError(err.message); if ([401, 403].includes(err.status)) onAccessLost(); } }
    finally { if (version === detailGeneration.current) setDetailLoading(false); }
  }, [onAccessLost]);
  useEffect(() => {
    const counter = detailGeneration;
    restoreOrderAfterSignIn();
    const sync = () => {
      const id = new URL(window.location.href).searchParams.get('order');
      if (id && !canReadOrders) { setDetailError('You do not have permission to view orders. Ask an administrator.'); return; }
      openDetail(id, 'orders');
    };
    sync(); window.addEventListener('popstate', sync);
    return () => { counter.current++; window.removeEventListener('popstate', sync); };
  }, [openDetail, canReadOrders]);
  useEffect(() => { if ((detail || detailError || detailLoading) && modal.current && !modal.current.open) modal.current.showModal(); }, [detail, detailError, detailLoading]);
  const close = () => {
    detailGeneration.current++; modal.current?.close(); setDetail(null); setDetailError(''); setDetailLoading(false);
    window.history.replaceState(null, '', orderLink(null));
  };
  const selectSection = id => { generation.current++; close(); setSection(id); setSearch(''); setAppliedSearch(''); setRows([]); };
  const openRow = row => {
    if (section === 'orders') window.history.pushState(null, '', orderLink(row.id));
    openDetail(row.id, section);
  };
  const order = detail?.order;
  const details = order ? [
    ['Order ID', order.id], ['Design', order.design_name], ['Placed', date(order.created_at)], ['Updated', date(order.updated_at)],
    ['Customer', order.customer_name], ['Email', order.customer_email], ['Phone', order.customer_phone],
    ['Shipping address', order.shipping_address ? Object.values(order.shipping_address).filter(Boolean).join('\n') : '—'],
    ['Cards', order.quantity], ['Decks', order.deck_quantity], ['Order status', order.status], ['Payment status', order.payment_status],
    ['Total', money(order.total_amount_cents, order.currency)], ['Shipping', money(order.shipping_cost_cents, order.currency)], ['Discount', money(order.discount_amount_cents, order.currency)],
    ['PRINTS spent', order.wallet_prints_spent], ['Payment provider', order.payment_provider], ['Payment source', order.payment_source],
    ['Stripe Checkout session', order.stripe_session_id], ['Completed', date(order.completed_at)], ['Refunded', date(order.refunded_at)], ['Refund reason', order.refund_reason_key],
  ] : [];
  if (section === 'batcher') return <CardBatcherPro teamAccess showSidebar={false} onAccessLost={onAccessLost} onBackToDashboard={() => selectSection('welcome')}/>;
  return <div className="ta-viewer"><main className="team-access">
    <header className="ta-heading"><div><p className="ta-eyebrow">TCGPLAYTEST DASHBOARD</p><h1>Your dashboard access</h1><p>{access.email} · Read-only</p></div><button onClick={() => supabase.auth.signOut()}><LogOut size={16}/>Sign out</button></header>
    <div className="ta-info ta-panel"><ShieldCheck/><div><strong>Only the sections approved by your administrator are available.</strong><p>You can view and search records here. Contact an administrator to make changes or request another section.</p></div></div>
    <nav className="ta-navigation" aria-label="Allowed dashboard sections">{sections.map(item => <button key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => selectSection(item.id)}>{item.title}</button>)}</nav>
    {definition ? <section className="ta-panel" aria-label={definition?.title}><div className="ta-heading"><div><h2>{definition?.title}</h2><p>{definition?.description}</p></div><button disabled={loading} onClick={() => load(offset)}><RefreshCw size={16}/>Refresh</button></div>
      {definition?.search && <form className="ta-search" onSubmit={event => { event.preventDefault(); if (appliedSearch === search.trim()) load(0); else setAppliedSearch(search.trim()); }}><label>{definition.search}<input type="search" maxLength={254} value={search} onChange={event => setSearch(event.target.value)}/></label><button type="submit" disabled={loading}>Search</button></form>}
      {error && <p role="alert" className="ta-error">{error}</p>}
      {loading ? <p role="status">Loading records…</p> : rows.length ? <div className="ta-table-wrap"><table><thead><tr>{definition.columns.map(([field, label]) => <th key={field}>{label}</th>)}{['orders', 'email-history'].includes(section) && <th>Details</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id || row.stat_date}>{definition.columns.map(column => <td key={column[0]}>{cell(row, column)}</td>)}{['orders', 'email-history'].includes(section) && <td><button onClick={() => openRow(row)} aria-label={'View ' + (section === 'orders' ? 'order ' + row.id : 'deliveries for ' + row.subject)}>View details</button></td>}</tr>)}</tbody></table></div> : !error && <p>No matching records.</p>}
      <div className="ta-pagination"><button disabled={loading || !offset} onClick={() => load(Math.max(0, offset - 50))}>Previous</button><span>Page {offset / 50 + 1}</span><button disabled={loading || nextOffset === null} onClick={() => load(nextOffset)}>Next</button></div>
    </section> : <p>Choose an available section above.</p>}
    {(detail || detailError || detailLoading) && <dialog ref={modal} className="ta-dialog" aria-labelledby="viewer-detail-title" onCancel={event => { event.preventDefault(); close(); }}><div className="ta-heading"><h2 id="viewer-detail-title">{order ? 'Order details' : 'Record details'}</h2><button onClick={close}>Close</button></div>
      {detailLoading && <p role="status">Loading details…</p>}{detailError && <p className="ta-error" role="alert">{detailError}</p>}
      {order && <><p>Read-only · <a href={orderLink(order.id)}>Direct order link</a></p><dl>{details.map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value === null || value === undefined || value === '' ? '—' : String(value)}</dd></div>)}</dl></>}
      {order && access.permissions.includes('orders') && access.permissions.includes('order-downloads') && <TeamOrderDownloads key={order.id} orderId={order.id} onAccessLost={onAccessLost}/>}
      {detail?.deliveries && <>{detail.truncated && <p>Showing the latest 100 deliveries for this campaign.</p>}<div className="ta-table-wrap"><table><thead><tr><th>Recipient</th><th>Status</th><th>Attempted</th><th>Accepted</th></tr></thead><tbody>{detail.deliveries.map(item => <tr key={item.id}><td>{item.recipient_email}</td><td>{item.status}</td><td>{date(item.attempted_at)}</td><td>{date(item.accepted_at)}</td></tr>)}</tbody></table></div>{!detail.deliveries.length && <p>No deliveries recorded.</p>}</>}
    </dialog>}
  </main></div>;
}
