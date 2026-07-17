import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../services/supabaseClient';

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const STATUS_COLORS = {
  subscribed: '#10b981',
  unsubscribed: '#ef4444',
  pending: '#f59e0b',
};

const Subscribers = () => {
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from('marketing_subscribers')
          .select('id, email, full_name, source, status, consented_at, created_at')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setSubscribers(data || []);
      } catch (err) {
        setError(err.message || 'Failed to load subscribers');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = subscribers.filter(s => {
    const q = search.toLowerCase();
    return (
      (s.email || '').toLowerCase().includes(q) ||
      (s.full_name || '').toLowerCase().includes(q) ||
      (s.source || '').toLowerCase().includes(q)
    );
  });

  const handleDownload = () => {
    const rows = filtered.map(s => ({
      Email: s.email,
      'Full Name': s.full_name || '',
      Source: s.source || '',
      Status: s.status || '',
      'Consented At': s.consented_at ? new Date(s.consented_at).toLocaleString() : '',
      'Subscribed At': s.created_at ? new Date(s.created_at).toLocaleString() : '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 35 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 25 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Subscribers');
    XLSX.writeFile(wb, `subscribers-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Subscribers</h1>
        <button
          onClick={handleDownload}
          disabled={filtered.length === 0}
          style={{
            padding: '10px 20px',
            background: filtered.length > 0 ? '#10b981' : 'var(--bg-hover)',
            color: filtered.length > 0 ? '#fff' : 'var(--text-muted)',
            border: 'none',
            borderRadius: '8px',
            cursor: filtered.length > 0 ? 'pointer' : 'not-allowed',
            fontWeight: '600',
            fontSize: '0.875rem',
          }}
        >
          ⬇ Download Excel ({filtered.length})
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by email, name or source..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%',
          maxWidth: '400px',
          padding: '9px 14px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          color: 'var(--text-primary)',
          fontSize: '0.875rem',
          outline: 'none',
          marginBottom: '16px',
          boxSizing: 'border-box',
        }}
      />

      {error && (
        <div style={{ padding: '16px', background: '#ef444420', border: '1px solid #ef4444', borderRadius: '8px', color: '#ef4444', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading subscribers...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>No subscribers found.</div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-hover)' }}>
                {['Email', 'Name', 'Source', 'Status', 'Consented At', 'Subscribed At'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                  <td style={{ padding: '12px 16px', color: 'var(--text-primary)', fontWeight: '500' }}>{s.email}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-primary)' }}>{s.full_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.75rem', background: 'var(--bg-hover)', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                      {s.source || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: '600',
                      background: `${STATUS_COLORS[s.status] || '#6b7280'}22`,
                      color: STATUS_COLORS[s.status] || '#6b7280',
                    }}>
                      {s.status || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{formatDate(s.consented_at)}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{formatDate(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Subscribers;
