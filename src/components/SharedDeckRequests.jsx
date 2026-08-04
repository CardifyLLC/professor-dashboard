import React, { useEffect, useMemo, useRef, useState } from 'react';
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

  const load = async () => {
    setLoading(true); setError('');
    const { data, error: loadError } = await supabase.from('shared_purchase_requests').select('*').eq('request_type', 'share_link').order('created_at', { ascending: false });
    if (loadError) setError(loadError.message); else {
      const next = data || []; setRequests(next);
      setSelectedId(current => next.some(item => item.id === current) ? current : next.find(item => item.status === 'pending')?.id || next[0]?.id || null);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => requests.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false;
    const query = search.trim().toLowerCase();
    return !query || [item.design_name, item.requester_email, item.requester_name].some(value => String(value || '').toLowerCase().includes(query));
  }), [requests, filter, search]);
  const selected = requests.find(item => item.id === selectedId) || visible[0] || null;
  const images = imagesFor(selected);
  const counts = ['pending', 'approved', 'rejected'].reduce((result, status) => ({ ...result, [status]: requests.filter(item => item.status === status).length }), {});

  const decide = async status => {
    if (!selected || selected.status !== 'pending') return;
    const rejectionMessage = reason === 'Other' ? otherReason.trim() : reason.trim();
    if (status === 'rejected' && !rejectionMessage) {
      setReasonError('Please enter a rejection message. This message will be emailed to the deck owner.');
      reasonInputRef.current?.focus();
      return;
    }
    setReasonError('');
    setSaving(true); setError('');
    const { data: sessionData } = await supabase.auth.getSession();
    const storefront = (import.meta.env.VITE_STOREFRONT_URL || 'https://testing123-prof.vercel.app').replace(/\/$/, '');
    try {
      const response = await fetch(`${storefront}/api/admin/shared-purchase-requests`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData?.session?.access_token || ''}` }, body: JSON.stringify({ id: selected.id, status, rejectionMessage }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save decision.');
      setRequests(current => current.map(item => item.id === selected.id ? data.request : item)); setReason(''); setOtherReason('');
      if (data.warning) setError(data.warning);
    } catch (saveError) { setError(saveError.message || String(saveError)); }
    setSaving(false);
  };

  if (loading) return <div className="loading">Loading shared-deck requests...</div>;
  return <div>
    <h1 className="page-title">Share Link Moderation</h1>
    <p style={{ color: 'var(--text-muted)', marginBottom: 22 }}>Review deck artwork before allowing its owner to publish a share link.</p>
    {error && <div style={{ border: '1px solid #ef4444', color: '#fecaca', background: 'rgba(239,68,68,.12)', borderRadius: 8, padding: 12, marginBottom: 16 }}>{error}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12, marginBottom: 18 }}>
      {['pending', 'approved', 'rejected'].map(status => <button key={status} onClick={() => setFilter(status)} style={{ padding: 18, textAlign: 'left', borderRadius: 12, border: `1px solid ${filter === status ? colors[status] : 'var(--border-color)'}`, background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}><small style={{ color: colors[status], textTransform: 'uppercase', fontWeight: 700 }}>{status}</small><div style={{ fontSize: 28, fontWeight: 800 }}>{counts[status] || 0}</div></button>)}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px,.8fr) minmax(440px,1.2fr)', gap: 16 }}>
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: 14 }}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search requester or deck..." style={{ width: '100%', boxSizing: 'border-box', padding: 11, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} /><button onClick={() => setFilter('all')} style={{ marginTop: 10, border: 0, background: 'none', color: 'var(--accent-primary)', cursor: 'pointer' }}>Show all</button></div>
        <div style={{ maxHeight: 620, overflowY: 'auto' }}>{visible.length === 0 ? <p style={{ padding: 30, color: 'var(--text-muted)', textAlign: 'center' }}>No requests match this view.</p> : visible.map(item => <button key={item.id} onClick={() => { setSelectedId(item.id); setReason(item.rejection_message || ''); }} style={{ width: '100%', padding: 16, textAlign: 'left', border: 0, borderTop: '1px solid var(--border-color)', background: selected?.id === item.id ? 'rgba(59,130,246,.13)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{item.design_name}</strong><span style={{ color: colors[item.status], fontSize: 11, textTransform: 'uppercase', fontWeight: 800 }}>{item.status}</span></div><div style={{ marginTop: 7, color: 'var(--text-muted)', fontSize: 13 }}>{item.requester_name || 'Customer'} - {item.requester_email}</div></button>)}</div>
      </section>
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 20 }}>
        {!selected ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 80 }}>Select a request to review.</p> : <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><h2 style={{ margin: 0 }}>{selected.design_name}</h2><p style={{ color: 'var(--text-muted)' }}>{selected.requester_name || 'Customer'} - {selected.requester_email}</p></div><strong style={{ color: colors[selected.status], textTransform: 'uppercase' }}>{selected.status}</strong></div>
          <h3 style={{ marginTop: 24 }}>Uploaded card images ({images.length})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 12, maxHeight: 430, overflowY: 'auto' }}>{images.map(image => <figure key={image.key} style={{ margin: 0 }}><img src={image.src} alt={image.label} style={{ width: '100%', aspectRatio: '2.5 / 3.5', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-color)' }} /><figcaption style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>{image.label}</figcaption></figure>)}</div>
          {selected.status === 'pending' ? <>
            <label htmlFor="share-rejection-reason" style={{ display: 'block', marginTop: 18, marginBottom: 7, fontWeight: 700 }}>Rejection reason</label>
            <select ref={reasonInputRef} id="share-rejection-reason" value={reason} onChange={event => { setReason(event.target.value); setReasonError(''); }} aria-invalid={Boolean(reasonError)} style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 8, border: `1px solid ${reasonError ? '#f43f5e' : 'var(--border-color)'}`, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
              <option value="">Select a reason...</option>
              {rejectionReasons.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {reason === 'Other' && <textarea value={otherReason} onChange={event => { setOtherReason(event.target.value); if (event.target.value.trim()) setReasonError(''); }} placeholder="Enter the rejection explanation that will be emailed to the deck owner..." rows={3} style={{ width: '100%', boxSizing: 'border-box', marginTop: 10, padding: 12, borderRadius: 8, border: `1px solid ${reasonError ? '#f43f5e' : 'var(--border-color)'}`, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />}
            {reasonError && <p role="alert" style={{ margin: '7px 0 0', color: '#fb7185', fontWeight: 700 }}>{reasonError}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}><button disabled={saving} onClick={() => decide('rejected')} style={{ padding: 13, borderRadius: 8, border: '1px solid #f43f5e', background: 'transparent', color: '#fb7185', fontWeight: 700, cursor: 'pointer' }}>Reject</button><button disabled={saving} onClick={() => decide('approved')} style={{ padding: 13, borderRadius: 8, border: 0, background: '#10b981', color: 'white', fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Saving...' : 'Approve'}</button></div>
          </> : <div style={{ marginTop: 18, padding: 14, borderRadius: 8, border: `1px solid ${colors[selected.status]}`, color: colors[selected.status] }}>Decision recorded{selected.rejection_message ? `: ${selected.rejection_message}` : '.'}</div>}
        </>}
      </section>
    </div>
  </div>;
}
