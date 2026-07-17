import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../services/supabaseClient';

const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatMoney = (cents) => {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
};

const parseCustomers = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const getCustomerName = (c) => c?.name || c?.customer_name || c?.full_name || '';
const getCustomerEmail = (c) => c?.email || c?.customer_email || '';

const DeletedOrdersStats = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from('order_daily_stats')
          .select('*')
          .order('stat_date', { ascending: false });
        if (error) throw error;
        setRows(data || []);
      } catch (err) {
        setError(err.message || 'Failed to load deleted orders stats');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const enriched = useMemo(() => {
    return (rows || []).map((r) => ({
      ...r,
      _customers: parseCustomers(r.customers),
    }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enriched;
    return enriched.filter((r) => {
      if ((r.stat_date || '').toLowerCase().includes(q)) return true;
      return r._customers.some((c) => {
        const name = getCustomerName(c).toLowerCase();
        const email = getCustomerEmail(c).toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    });
  }, [enriched, search]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        total_orders: acc.total_orders + Number(r.total_orders || 0),
        completed_orders: acc.completed_orders + Number(r.completed_orders || 0),
        paid_orders: acc.paid_orders + Number(r.paid_orders || 0),
        pending_orders: acc.pending_orders + Number(r.pending_orders || 0),
        cancelled_orders: acc.cancelled_orders + Number(r.cancelled_orders || 0),
        gross_revenue_cents: acc.gross_revenue_cents + Number(r.gross_revenue_cents || 0),
        refunded_amount_cents: acc.refunded_amount_cents + Number(r.refunded_amount_cents || 0),
        net_revenue_cents: acc.net_revenue_cents + Number(r.net_revenue_cents || 0),
        total_cards: acc.total_cards + Number(r.total_cards || 0),
        customers: acc.customers + (r._customers?.length || 0),
      }),
      {
        total_orders: 0,
        completed_orders: 0,
        paid_orders: 0,
        pending_orders: 0,
        cancelled_orders: 0,
        gross_revenue_cents: 0,
        refunded_amount_cents: 0,
        net_revenue_cents: 0,
        total_cards: 0,
        customers: 0,
      }
    );
  }, [filtered]);

  const toggleExpanded = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownload = () => {
    const summary = filtered.map((r) => ({
      'Stat Date': r.stat_date || '',
      'Total Orders': r.total_orders ?? 0,
      'Completed': r.completed_orders ?? 0,
      'Paid': r.paid_orders ?? 0,
      'Pending': r.pending_orders ?? 0,
      'Cancelled': r.cancelled_orders ?? 0,
      'Total Cards': r.total_cards ?? 0,
      'Gross Revenue': formatMoney(r.gross_revenue_cents),
      'Refunded': formatMoney(r.refunded_amount_cents),
      'Net Revenue': formatMoney(r.net_revenue_cents),
      'Customers': r._customers?.length ?? 0,
      'Created At': formatDateTime(r.created_at),
      'Updated At': formatDateTime(r.updated_at),
    }));

    const customerRows = [];
    filtered.forEach((r) => {
      (r._customers || []).forEach((c) => {
        customerRows.push({
          'Stat Date': r.stat_date || '',
          'Name': getCustomerName(c),
          'Email': getCustomerEmail(c),
          'Status': c?.status || '',
          'Amount': c?.amount_cents != null ? formatMoney(c.amount_cents) : (c?.amount || ''),
          'Order ID': c?.order_id || c?.id || '',
        });
      });
    });

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(summary);
    ws1['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
      { wch: 11 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 20 }, { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Daily Stats');

    if (customerRows.length) {
      const ws2 = XLSX.utils.json_to_sheet(customerRows);
      ws2['!cols'] = [{ wch: 12 }, { wch: 25 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 36 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Customers');
    }

    XLSX.writeFile(wb, `deleted-orders-stats-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const STAT_CARDS = [
    { label: 'Days', value: filtered.length },
    { label: 'Total Orders', value: totals.total_orders },
    { label: 'Cancelled', value: totals.cancelled_orders, color: '#ef4444' },
    { label: 'Total Cards', value: totals.total_cards },
    { label: 'Gross Revenue', value: formatMoney(totals.gross_revenue_cents), color: '#10b981' },
    { label: 'Refunded', value: formatMoney(totals.refunded_amount_cents), color: '#f59e0b' },
    { label: 'Net Revenue', value: formatMoney(totals.net_revenue_cents), color: '#10b981' },
    { label: 'Customers', value: totals.customers },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Deleted Orders Stats</h1>
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

      {/* Summary stat cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px',
        marginBottom: '20px',
      }}>
        {STAT_CARDS.map((c) => (
          <div key={c.label} style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '14px 16px',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600', marginBottom: '6px' }}>
              {c.label}
            </div>
            <div style={{ color: c.color || 'var(--text-primary)', fontSize: '1.25rem', fontWeight: '700' }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by date, customer name or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
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
        <div className="loading">Loading deleted orders stats...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
          No deleted orders stats found.
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', minWidth: '1100px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-hover)' }}>
                {[
                  '', 'Date', 'Total', 'Completed', 'Paid', 'Pending', 'Cancelled',
                  'Cards', 'Gross', 'Refunded', 'Net', 'Customers', 'Updated',
                ].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 14px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const rowKey = r.id ?? r.idx ?? r.stat_date ?? i;
                const isOpen = expanded.has(rowKey);
                const hasCustomers = (r._customers?.length || 0) > 0;
                return (
                  <React.Fragment key={rowKey}>
                    <tr
                      onClick={() => hasCustomers && toggleExpanded(rowKey)}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        cursor: hasCustomers ? 'pointer' : 'default',
                      }}
                    >
                      <td style={{ padding: '12px 14px', color: 'var(--text-muted)', width: '24px' }}>
                        {hasCustomers ? (isOpen ? '▾' : '▸') : ''}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-primary)', fontWeight: '500', whiteSpace: 'nowrap' }}>
                        {formatDate(r.stat_date)}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-primary)' }}>{r.total_orders ?? 0}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-primary)' }}>{r.completed_orders ?? 0}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-primary)' }}>{r.paid_orders ?? 0}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-primary)' }}>{r.pending_orders ?? 0}</td>
                      <td style={{ padding: '12px 14px', color: (r.cancelled_orders > 0) ? '#ef4444' : 'var(--text-primary)' }}>
                        {r.cancelled_orders ?? 0}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-primary)' }}>{r.total_cards ?? 0}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                        {formatMoney(r.gross_revenue_cents)}
                      </td>
                      <td style={{ padding: '12px 14px', color: r.refunded_amount_cents > 0 ? '#f59e0b' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {formatMoney(r.refunded_amount_cents)}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#10b981', fontWeight: '600', whiteSpace: 'nowrap' }}>
                        {formatMoney(r.net_revenue_cents)}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: '99px', fontSize: '0.72rem', fontWeight: '600',
                          background: hasCustomers ? '#3b82f622' : 'var(--bg-hover)',
                          color: hasCustomers ? '#3b82f6' : 'var(--text-muted)',
                        }}>
                          {r._customers?.length || 0}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        {formatDateTime(r.updated_at)}
                      </td>
                    </tr>
                    {isOpen && hasCustomers && (
                      <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={13} style={{ padding: '0' }}>
                          <div style={{ padding: '12px 24px' }}>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600', marginBottom: '8px' }}>
                              Customers ({r._customers.length})
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                              <thead>
                                <tr>
                                  {['Name', 'Email', 'Status', 'Amount', 'Order ID'].map((h) => (
                                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {r._customers.map((c, ci) => (
                                  <tr key={ci} style={{ borderTop: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>
                                      {getCustomerName(c) || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                    </td>
                                    <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>
                                      {getCustomerEmail(c) || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                    </td>
                                    <td style={{ padding: '8px 10px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                                      {c?.status || '—'}
                                    </td>
                                    <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>
                                      {c?.amount_cents != null ? formatMoney(c.amount_cents) : (c?.amount ?? '—')}
                                    </td>
                                    <td style={{ padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                                      {c?.order_id || c?.id || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DeletedOrdersStats;
