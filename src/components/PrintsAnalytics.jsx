import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Coins, Gift, RefreshCw, RotateCcw, ShoppingCart, Users } from 'lucide-react';
import { getAdminAuthHeaders } from '../services/supabaseClient';

const fmt = (value) => Number(value || 0).toLocaleString();
const labels = {
  admin_grant: 'Individual admin grants', admin_bulk_grant: 'All-user grants',
  admin_new_user_grant: 'New-user grants', cash_purchase_reward: '5% cash rewards',
  award_cash_purchase_reward_for_order: '5% cash rewards',
  award_affiliate_referral_for_order: 'Affiliate rewards', order_debit: 'Used on orders',
  order_credit: 'Returned order PRINTS', manual_adjustment: 'Manual adjustments',
  bonus: 'Bonuses', promo: 'Promotions', refund: 'Refunds', reversal: 'Reversals',
  expiration: 'Expirations', purchase: 'Purchases', other: 'Other',
};
const label = (key) => labels[key] || String(key || 'other').replaceAll('_', ' ');

const StatCard = ({ icon: Icon, title, value, note, color }) => (
  <div style={{ padding: '18px', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
      <div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{title}</div>
        <div style={{ marginTop: '7px', color: 'var(--text-primary)', fontSize: '1.75rem', fontWeight: 800 }}>{fmt(value)}</div>
        <div style={{ marginTop: '5px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{note}</div>
      </div>
      <div style={{ width: '38px', height: '38px', borderRadius: '10px', display: 'grid', placeItems: 'center', background: `${color}20`, color }}>{React.createElement(Icon, { size: 20 })}</div>
    </div>
  </div>
);

const Breakdown = ({ title, rows }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
    <div style={{ padding: '15px 18px', fontWeight: 700, borderBottom: '1px solid var(--border-color)' }}>{title}</div>
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: '520px' }}>
        <thead><tr><th>Category</th><th>Added</th><th>Used/removed</th><th>Net</th><th>Entries</th></tr></thead>
        <tbody>
          {(rows || []).map((row) => <tr key={row.key}>
            <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{label(row.key)}</td>
            <td style={{ color: '#10b981' }}>+{fmt(row.credited)}</td>
            <td style={{ color: '#f59e0b' }}>-{fmt(row.debited)}</td>
            <td style={{ color: Number(row.net) >= 0 ? '#10b981' : '#ef4444' }}>{Number(row.net) >= 0 ? '+' : ''}{fmt(row.net)}</td>
            <td>{fmt(row.transactions)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>
);

export default function PrintsAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const headers = await getAdminAuthHeaders();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/prints-analytics`, { method: 'GET', headers });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not load PRINTS analytics.');
      setData(result);
    } catch (loadError) {
      setError(loadError.message || 'Could not load PRINTS analytics.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const summary = data?.summary || {};

  return <div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', marginBottom: '22px' }}>
      <div><h1 className="page-title" style={{ marginBottom: '5px' }}>PRINTS Analytics</h1><p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Wallet circulation, credits, grants, rewards, and spending.</p></div>
      <button onClick={() => void load()} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: loading ? 'wait' : 'pointer' }}>
        <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
      </button>
    </div>
    {error && <div style={{ padding: '14px', marginBottom: '18px', border: '1px solid #ef4444', borderRadius: '9px', background: '#ef444420', color: '#ef4444' }}>{error}</div>}
    {loading && !data ? <div className="loading">Loading PRINTS data...</div> : data && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <StatCard icon={Coins} title="In circulation" value={summary.circulation} note="Available across active wallets" color="#f59e0b" />
        <StatCard icon={Gift} title="Admin granted" value={summary.granted} note="Individual, all-user and new-user grants" color="#8b5cf6" />
        <StatCard icon={Activity} title="Earned rewards" value={summary.earned} note="Cashback, affiliate and promotional credits" color="#10b981" />
        <StatCard icon={ShoppingCart} title="Used on orders" value={summary.used} note="PRINTS successfully spent at checkout" color="#3b82f6" />
        <StatCard icon={RotateCcw} title="Returned" value={summary.returned} note="Order credits, refunds and reversals" color="#06b6d4" />
        <StatCard icon={Users} title="Wallets" value={summary.activeWallets} note={`${fmt(summary.walletsWithBalance)} currently hold a balance`} color="#ec4899" />
      </div>

      <div style={{ padding: '15px 18px', marginBottom: '18px', borderRadius: '10px', background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.45)', color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.7 }}>
        <strong style={{ color: 'var(--text-primary)' }}>Ledger reconciliation:</strong> {fmt(summary.totalIssued)} total issued − {fmt(summary.used)} used − {fmt(summary.removed)} otherwise removed = {fmt(Number(summary.totalIssued || 0) - Number(summary.used || 0) - Number(summary.removed || 0))} net ledger PRINTS. Current active-wallet circulation is {fmt(summary.circulation)}, with {fmt(summary.reserved)} additionally reserved.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <Breakdown title="Breakdown by transaction type" rows={data.byType} />
        <Breakdown title="Breakdown by source" rows={data.bySource} />
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '15px 18px', fontWeight: 700, borderBottom: '1px solid var(--border-color)' }}>Recent PRINTS activity</div>
        <div style={{ overflowX: 'auto' }}><table className="data-table" style={{ minWidth: '850px' }}>
          <thead><tr><th>Date</th><th>User</th><th>Type</th><th>Source</th><th>Change</th><th>Balance</th><th>Note</th></tr></thead>
          <tbody>{(data.recent || []).map((entry) => <tr key={entry.id}>
            <td>{new Date(entry.created_at).toLocaleString()}</td>
            <td><div style={{ fontWeight: 600 }}>{entry.full_name || 'User'}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{entry.email || entry.user_id?.slice(0, 8)}</div></td>
            <td style={{ textTransform: 'capitalize' }}>{label(entry.entry_type)}</td><td style={{ textTransform: 'capitalize' }}>{label(entry.source)}</td>
            <td style={{ fontWeight: 800, color: Number(entry.prints_delta) > 0 ? '#10b981' : '#f59e0b' }}>{Number(entry.prints_delta) > 0 ? '+' : ''}{fmt(entry.prints_delta)}</td>
            <td>{entry.resulting_print_balance == null ? '—' : fmt(entry.resulting_print_balance)}</td><td>{entry.note || '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </div>
      <div style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '0.72rem' }}>Last calculated {new Date(data.generatedAt).toLocaleString()}. Recent activity shows the latest 50 ledger entries.</div>
    </>}
  </div>;
}
