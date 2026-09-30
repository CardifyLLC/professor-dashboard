import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';

const colors = { pending: '#f59e0b', approved: '#10b981', rejected: '#f43f5e' };
const rejectionReasons = ['Copyrighted artwork', 'Trademark violation', 'Unauthorized branding', 'Inappropriate content', 'Other'];

function imagesFor(request) {
  const fallback = request?.global_back?.processed || request?.global_back?.original || null;
  return (Array.isArray(request?.card_data) ? request.card_data : []).flatMap((card, index) => [
    card?.front ? { key: `${index}-front`, src: card.front, label: `Card ${index + 1} front` } : null,
    (card?.back || fallback) ? { key: `${index}-back`, src: card?.back || fallback, label: `Card ${index + 1} back` } : null,
  ]).filter(Boolean);
}

function ClickToLoadImage({ image }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <figure style={{ margin: 0 }}>
    {!loaded ? <button onClick={() => { setFailed(false); setLoaded(true); }} style={{ width: '100%', minHeight: 100, padding: 12, cursor: 'pointer' }}>
      {failed ? 'Retry image' : 'Load image'} — {image.label}
    </button> : <>
      <a href={image.src} target="_blank" rel="noopener noreferrer" title="Open full-size image">
        <img src={image.src} alt={image.label} decoding="async" onError={() => { setFailed(true); setLoaded(false); }} style={{ width: '100%', aspectRatio: '2.5 / 3.5', objectFit: 'contain', borderRadius: 8 }} />
      </a>
      <button onClick={() => setLoaded(false)}>Hide image</button>
    </>}
    <figcaption style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 12 }}>{image.label}</figcaption>
  </figure>;
}

function RequestArtwork({ id }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setImages([]); setPage(0);
    (async () => {
      try {
        const { data, error: loadError } = await supabase.from('shared_purchase_requests')
          .select('card_data,global_back').eq('request_type', 'share_link').eq('id', id).single();
        if (loadError) throw loadError;
        if (active) setImages(imagesFor(data));
      } catch { if (active) setError('Unable to load artwork details.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [id, attempt]);
  return <div>
    <h3 style={{ marginTop: 24 }}>Uploaded card images{!loading && !error ? ` (${images.length})` : ''}</h3>
    {loading ? <p>Loading artwork details...</p> : error ? <p role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>Retry</button></p> : <>
      <p style={{ color: 'var(--text-muted)' }}>Click Load image to inspect a card, then click its preview to open the full-size image.</p>
      {images.length === 0 && <p>No card images available.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 12 }}>
        {images.slice(page * 12, (page + 1) * 12).map(image => <ClickToLoadImage key={image.key} image={image} />)}
      </div>
      {images.length > 12 && <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous images</button>
        <span>{page * 12 + 1}–{Math.min((page + 1) * 12, images.length)} of {images.length}</span>
        <button disabled={(page + 1) * 12 >= images.length} onClick={() => setPage(value => value + 1)}>Next images</button>
      </div>}
    </>}
  </div>;
}

export default function SharedDeckRequests() {
  const [requests, setRequests] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const reasonInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [query, setQuery] = useState('');
  const [refresh, setRefresh] = useState(0);
  const pageSize = 20;
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(0); setSelectedId(null); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    (async () => {
      try {
        let request = supabase.from('shared_purchase_requests')
          .select('id,design_name,requester_email,requester_name,status,rejection_message,created_at', { count: 'exact' })
          .eq('request_type', 'share_link');
        if (filter !== 'all') request = request.eq('status', filter);
        const term = query.replace(/[,%()"\\]/g, ' ').trim();
        if (term) request = request.or(
          'design_name.ilike.%' + term + '%,requester_email.ilike.%' + term + '%,requester_name.ilike.%' + term + '%');
        const { data, error: loadError, count } = await request.order('created_at', { ascending: false })
          .order('id', { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
        if (loadError) throw loadError;
        if (active) { setRequests(data || []); setTotal(count || 0); }
      } catch (failure) { if (active) setError(failure.message || 'Unable to load requests.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [filter, query, page, refresh]);
  useEffect(() => {
    let active = true;
    Promise.all(['pending', 'approved', 'rejected'].map(async status => {
      const { count, error: countError } = await supabase.from('shared_purchase_requests')
        .select('id', { count: 'exact', head: true }).eq('request_type', 'share_link').eq('status', status);
      if (countError) throw countError;
      return [status, count || 0];
    })).then(result => { if (active) setCounts(Object.fromEntries(result)); })
      .catch(() => { if (active) setError('Unable to load status totals.'); });
    return () => { active = false; };
  }, [refresh]);
  const changeFilter = value => { setFilter(value); setPage(0); setSelectedId(null); };
  const visible = loading ? [] : requests;
  const selected = visible.find(item => item.id === selectedId) || null;

  const decide = async status => {
    const revokingApproval = selected?.status === 'approved' && status === 'rejected';
    if (!selected || (selected.status !== 'pending' && !revokingApproval)) return;
    const rejectionMessage = reason === 'Other' ? otherReason.trim() : reason.trim();
    if (status === 'rejected' && !rejectionMessage) {
      setReasonError('Please enter a rejection message. This message will be emailed to the deck owner.');
      reasonInputRef.current?.focus();
      return;
    }
    if (revokingApproval && !window.confirm(`Revoke sharing approval for "${selected.design_name}"? Its public share link will stop working.`)) return;
    setReasonError('');
    setSaving(true); setError('');
    const { data: sessionData } = await supabase.auth.getSession();
    const storefront = (import.meta.env.VITE_STOREFRONT_URL || 'https://www.tcgplaytest.com').replace(/\/$/, '');
    try {
      const response = await fetch(`${storefront}/api/admin/shared-purchase-requests`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData?.session?.access_token || ''}` }, body: JSON.stringify({ id: selected.id, status, rejectionMessage }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save decision.');
      setSelectedId(null); setPage(0); setRefresh(value => value + 1); setReason(''); setOtherReason('');
      if (data.warning) setError(data.warning);
    } catch (saveError) { setError(saveError.message || String(saveError)); }
    setSaving(false);
  };


  return <div>
    <h1 className="page-title">Share Link Moderation</h1>
    <p style={{ color: 'var(--text-muted)', marginBottom: 22 }}>Review deck artwork before allowing its owner to publish a share link.</p>
    {error && <div style={{ border: '1px solid #ef4444', color: '#fecaca', background: 'rgba(239,68,68,.12)', borderRadius: 8, padding: 12, marginBottom: 16 }}>{error}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12, marginBottom: 18 }}>
      {['pending', 'approved', 'rejected'].map(status => <button key={status} onClick={() => changeFilter(status)} style={{ padding: 18, textAlign: 'left', borderRadius: 12, border: `1px solid ${filter === status ? colors[status] : 'var(--border-color)'}`, background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}><small style={{ color: colors[status], textTransform: 'uppercase', fontWeight: 700 }}>{status}</small><div style={{ fontSize: 28, fontWeight: 800 }}>{counts[status] || 0}</div></button>)}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px,.8fr) minmax(440px,1.2fr)', gap: 16 }}>
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: 14 }}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search requester or deck..." style={{ width: '100%', boxSizing: 'border-box', padding: 11, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} /><button onClick={() => changeFilter('all')} style={{ marginTop: 10, border: 0, background: 'none', color: 'var(--accent-primary)', cursor: 'pointer' }}>Show all</button></div>
        <div style={{ maxHeight: 620, overflowY: 'auto' }}>{visible.length === 0 ? <p style={{ padding: 30, color: 'var(--text-muted)', textAlign: 'center' }}>{loading ? 'Loading requests...' : 'No requests match this view.'}</p> : visible.map(item => <button key={item.id} onClick={() => { setSelectedId(item.id); setReason(''); setOtherReason(''); setReasonError(''); }} style={{ width: '100%', padding: 16, textAlign: 'left', border: 0, borderTop: '1px solid var(--border-color)', background: selected?.id === item.id ? 'rgba(59,130,246,.13)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{item.design_name}</strong><span style={{ color: colors[item.status], fontSize: 11, textTransform: 'uppercase', fontWeight: 800 }}>{item.status}</span></div><div style={{ marginTop: 7, color: 'var(--text-muted)', fontSize: 13 }}>{item.requester_name || 'Customer'} - {item.requester_email}</div></button>)}</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 14 }}>
          <button disabled={loading || saving || page === 0} onClick={() => { setPage(value => value - 1); setSelectedId(null); }}>Previous</button>
          <span>Page {page + 1} of {Math.max(1, Math.ceil(total / pageSize))} · {total} requests</span>
          <button disabled={loading || saving || (page + 1) * pageSize >= total} onClick={() => { setPage(value => value + 1); setSelectedId(null); }}>Next</button>
        </div>
      </section>
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 20 }}>
        {!selected ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 80 }}>Select a request to review.</p> : <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><h2 style={{ margin: 0 }}>{selected.design_name}</h2><p style={{ color: 'var(--text-muted)' }}>{selected.requester_name || 'Customer'} - {selected.requester_email}</p></div><strong style={{ color: colors[selected.status], textTransform: 'uppercase' }}>{selected.status}</strong></div>
          <RequestArtwork key={selected.id} id={selected.id} />
          {(selected.status === 'pending' || selected.status === 'approved') ? <>
            {selected.status === 'approved' && <div style={{ marginTop: 18, padding: 14, borderRadius: 8, border: '1px solid #f59e0b', color: '#fbbf24', background: 'rgba(245,158,11,.08)' }}>This share link is currently approved. Revoking approval will disable public access immediately.</div>}
            <label htmlFor="share-rejection-reason" style={{ display: 'block', marginTop: 18, marginBottom: 7, fontWeight: 700 }}>Rejection reason</label>
            <select ref={reasonInputRef} id="share-rejection-reason" value={reason} onChange={event => { setReason(event.target.value); setReasonError(''); }} aria-invalid={Boolean(reasonError)} style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 8, border: `1px solid ${reasonError ? '#f43f5e' : 'var(--border-color)'}`, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
              <option value="">Select a reason...</option>
              {rejectionReasons.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {reason === 'Other' && <textarea value={otherReason} onChange={event => { setOtherReason(event.target.value); if (event.target.value.trim()) setReasonError(''); }} placeholder="Enter the rejection explanation that will be emailed to the deck owner..." rows={3} style={{ width: '100%', boxSizing: 'border-box', marginTop: 10, padding: 12, borderRadius: 8, border: `1px solid ${reasonError ? '#f43f5e' : 'var(--border-color)'}`, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />}
            {reasonError && <p role="alert" style={{ margin: '7px 0 0', color: '#fb7185', fontWeight: 700 }}>{reasonError}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: selected.status === 'pending' ? '1fr 1fr' : '1fr', gap: 12, marginTop: 12 }}><button disabled={saving} onClick={() => decide('rejected')} style={{ padding: 13, borderRadius: 8, border: '1px solid #f43f5e', background: 'transparent', color: '#fb7185', fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving...' : selected.status === 'approved' ? 'Revoke Approval & Reject' : 'Reject'}</button>{selected.status === 'pending' && <button disabled={saving} onClick={() => decide('approved')} style={{ padding: 13, borderRadius: 8, border: 0, background: '#10b981', color: 'white', fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving...' : 'Approve'}</button>}</div>
          </> : <div style={{ marginTop: 18, padding: 14, borderRadius: 8, border: `1px solid ${colors[selected.status]}`, color: colors[selected.status] }}>Decision recorded{selected.rejection_message ? `: ${selected.rejection_message}` : '.'}</div>}
        </>}
      </section>
    </div>
  </div>;
}
