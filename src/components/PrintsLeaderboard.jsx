import { useEffect, useState } from 'react';
import { getAdminAuthHeaders } from '../services/supabaseClient';

export default function PrintsLeaderboard() {
  const [sort, setSort] = useState('prints');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    (async () => {
      try {
        const headers = await getAdminAuthHeaders();
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/prints-leaderboard?sort=${sort}`, { headers, cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load leaderboard.');
        if (!controller.signal.aborted) setRows(data.rows || []);
      } catch (error) {
        if (!controller.signal.aborted) { setRows([]); setError(error.message); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [sort, refresh]);
  return <section>
    <h1 className="page-title">Prints leaderboard</h1>
    <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>All-time referrals and affiliate-earned Prints. Purchases, cash rewards and other bonuses are excluded. Members are anonymous by default and can publish their display name in their profile.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '24px 0', alignItems: 'center' }}>
      <label>Rank by <select value={sort} onChange={event => setSort(event.target.value)} style={{ padding: 10, marginLeft: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 8 }}><option value="prints">Earned Prints</option><option value="referrals">Referrals</option></select></label>
      <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)} style={{ padding: '10px 18px', border: '1px solid var(--border-color)', borderRadius: 8 }}>Refresh</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Loading leaderboard…</p> : !error && <div style={{ overflowX: 'auto' }}><table className="data-table"><caption style={{ textAlign: 'left', padding: 12 }}>Top 50 · ranked by {sort === 'prints' ? 'earned Prints' : 'referrals'}</caption><thead><tr><th>Rank</th><th>Member</th><th>Referrals</th><th>Earned Prints</th></tr></thead><tbody>{rows.map(row => <tr key={row.rank}><td>{row.rank}</td><td>{row.display_name}</td><td>{Number(row.referral_count).toLocaleString()}</td><td>{Number(row.earned_prints).toLocaleString()}</td></tr>)}{rows.length === 0 && <tr><td colSpan={4}>No affiliate rewards recorded yet.</td></tr>}</tbody></table></div>}
    {rows.some(row => Number(row.unidentified_rewards) > 0) && <p>Some older rewards lack customer records; referral counts may be incomplete.</p>}
  </section>;
}
