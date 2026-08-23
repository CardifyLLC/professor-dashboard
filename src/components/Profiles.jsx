import React, { useState, useEffect } from 'react';
import { getAdminAuthHeaders, supabaseAdmin } from '../services/supabaseClient';

const formatCurrency = (cents) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const getInitials = (name, email) => {
  if (name) {
    const parts = name.trim().split(' ');
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  }
  return (email || '?').slice(0, 2).toUpperCase();
};

const avatarColors = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
];
const avatarColor = (str) => {
  const s = str || '';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
};

const escapeCsvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const AvatarCircle = ({ avatarUrl, initials, color }) => {
  const [imgFailed, setImgFailed] = React.useState(false);
  const showImg = avatarUrl && !imgFailed;
  return (
    <div style={{
      width: '40px', height: '40px', borderRadius: '50%',
      background: showImg ? 'transparent' : color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: '700', fontSize: '0.875rem', color: '#fff',
      flexShrink: 0, overflow: 'hidden',
    }}>
      {showImg
        ? <img src={avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setImgFailed(true)} />
        : initials}
    </div>
  );
};

const ORDER_STATUS_COLORS = {
  paid: '#f59e0b',
  processing: '#3b82f6',
  shipped: '#8b5cf6',
  completed: '#10b981',
  rejected: '#ef4444',
  refunded: '#6b7280',
};

const Profiles = () => {
  const [profiles, setProfiles] = useState([]);
  const [orders, setOrders] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [bulkGrant, setBulkGrant] = useState({ amount: '', note: '' });
  const [bulkGrantStatus, setBulkGrantStatus] = useState({ loading: false, error: '', success: '' });
  const [newUserGrant, setNewUserGrant] = useState({ amount: '', note: '' });
  const [newUserGrantStatus, setNewUserGrantStatus] = useState({ loading: false, error: '', success: '' });
  const [newUserEmails, setNewUserEmails] = useState(new Set());

  const loadNewUserEligibility = async () => {
    const headers = await getAdminAuthHeaders();
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grant-prints-new-users`, {
      method: 'GET', headers,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not load new-user eligibility.');
    setNewUserEmails(new Set(Array.isArray(result.eligibleEmails) ? result.eligibleEmails : []));
  };

  // Filters
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [minOrders, setMinOrders] = useState(0);

  // Expanded profile
  const [expandedId, setExpandedId] = useState(null);

  const downloadAllEmails = async () => {
    setExporting(true);
    setError(null);

    try {
      const pageSize = 1000;
      const allProfiles = [];

      for (let from = 0; ; from += pageSize) {
        const { data, error: exportError } = await supabaseAdmin
          .from('profiles')
          .select('email')
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);

        if (exportError) throw exportError;
        allProfiles.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }

      const emails = allProfiles
        .map((profile) => profile.email?.trim())
        .filter(Boolean);
      const csv = ['Email', ...emails].map(escapeCsvCell).join('\r\n');
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `profile-emails-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Failed to download profile emails');
    } finally {
      setExporting(false);
    }
  };

  const grantPrintsToAll = async () => {
    const amount = Number(bulkGrant.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
      setBulkGrantStatus({ loading: false, error: 'Enter a whole PRINTS amount between 1 and 1,000,000.', success: '' });
      return;
    }
    const confirmed = window.confirm(
      `Grant ${amount.toLocaleString()} PRINTS to EVERY user account? This will add a separate wallet credit to all users and cannot be undone from this screen.`
    );
    if (!confirmed) return;

    setBulkGrantStatus({ loading: true, error: '', success: '' });
    try {
      const headers = await getAdminAuthHeaders();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grant-prints-all`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, note: bulkGrant.note.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Bulk grant failed with HTTP ${response.status}.`);
      setBulkGrantStatus({
        loading: false,
        error: '',
        success: [
          `Granted ${amount.toLocaleString()} PRINTS to ${Number(result.grantedCount || 0).toLocaleString()} users.`,
          `Emails sent: ${Number(result.emailsSent || 0).toLocaleString()}.`,
          result.emailsFailed ? `Emails failed: ${Number(result.emailsFailed).toLocaleString()}.` : '',
          result.emailWarning || '',
        ].filter(Boolean).join(' '),
      });
      setBulkGrant({ amount: '', note: '' });
    } catch (err) {
      setBulkGrantStatus({ loading: false, error: err.message || 'Could not grant PRINTS to all users.', success: '' });
    }
  };

  const grantPrintsToNewUsers = async () => {
    const amount = Number(newUserGrant.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
      setNewUserGrantStatus({ loading: false, error: 'Enter a whole PRINTS amount between 1 and 1,000,000.', success: '' });
      return;
    }
    if (!window.confirm(`Grant ${amount.toLocaleString()} PRINTS only to accounts that have never received any dashboard-admin PRINTS grant? Previous admin-grant recipients will be skipped.`)) return;
    setNewUserGrantStatus({ loading: true, error: '', success: '' });
    try {
      const headers = await getAdminAuthHeaders();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grant-prints-new-users`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, note: newUserGrant.note.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `New-user grant failed with HTTP ${response.status}.`);
      setNewUserGrantStatus({ loading: false, error: '', success: [
        result.grantedCount
          ? `Granted ${amount.toLocaleString()} PRINTS to ${Number(result.grantedCount).toLocaleString()} new users.`
          : 'No newly eligible users were found.',
        `Emails sent: ${Number(result.emailsSent || 0).toLocaleString()}.`,
        result.emailsFailed ? `Emails failed: ${Number(result.emailsFailed).toLocaleString()}.` : '',
        result.emailWarning || '',
      ].filter(Boolean).join(' ') });
      setNewUserGrant({ amount: '', note: '' });
      await loadNewUserEligibility();
    } catch (err) {
      setNewUserGrantStatus({ loading: false, error: err.message || 'Could not grant PRINTS to new users.', success: '' });
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [profilesRes, ordersRes, walletsRes] = await Promise.all([
          supabaseAdmin.from('profiles').select('*').order('created_at', { ascending: false }),
          supabaseAdmin.from('orders').select('id, user_id, customer_email, customer_name, status, total_amount_cents, created_at, quantity').order('created_at', { ascending: false }),
          supabaseAdmin.from('wallet_accounts').select('user_id,balance,reserved_balance').eq('account_code', 'prints'),
        ]);
        if (profilesRes.error) throw profilesRes.error;
        if (ordersRes.error) throw ordersRes.error;
        if (walletsRes.error) throw walletsRes.error;
        setProfiles(profilesRes.data || []);
        setOrders(ordersRes.data || []);
        setWallets(walletsRes.data || []);
        await loadNewUserEligibility();
      } catch (err) {
        setError(err.message || 'Failed to load profiles');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Build enriched profiles
  const enriched = profiles.map((p) => {
    const profileOrders = orders.filter(
      (o) => (o.user_id && o.user_id === p.id) || (o.customer_email && o.customer_email === p.email)
    );
    const totalSpent = profileOrders.reduce((sum, o) => sum + (o.total_amount_cents || 0), 0);
    const lastOrder = profileOrders[0] || null;
    const provider = p.metadata?.provider || null;
    const wallet = wallets.find((candidate) => candidate.user_id === p.id);
    const printsBalance = Number(wallet?.balance || 0);
    const reservedPrints = Number(wallet?.reserved_balance || 0);
    return { ...p, profileOrders, totalSpent, lastOrder, provider, printsBalance, reservedPrints };
  });

  // Apply filters
  const filtered = enriched
    .filter((p) => {
      const q = search.toLowerCase();
      return (
        (p.full_name || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q)
      );
    })
    .filter((p) => p.profileOrders.length >= minOrders)
    .sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.created_at) - new Date(a.created_at);
      if (sortBy === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
      if (sortBy === 'most_orders') return b.profileOrders.length - a.profileOrders.length;
      if (sortBy === 'highest_spend') return b.totalSpent - a.totalSpent;
      if (sortBy === 'highest_prints') return b.printsBalance - a.printsBalance;
      if (sortBy === 'lowest_prints') return a.printsBalance - b.printsBalance;
      return 0;
    });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '30px' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Profiles</h1>
        <button
          type="button"
          onClick={downloadAllEmails}
          disabled={exporting}
          style={{
            padding: '9px 16px',
            borderRadius: '8px',
            border: '1px solid var(--accent-primary)',
            background: 'var(--accent-primary)',
            color: '#fff',
            fontSize: '0.875rem',
            fontWeight: '600',
            cursor: exporting ? 'wait' : 'pointer',
            opacity: exporting ? 0.65 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {exporting ? 'Downloading...' : 'Download all'}
        </button>
      </div>

      <div style={{
        marginBottom: '24px', padding: '18px', borderRadius: '12px',
        border: '1px solid #f59e0b', background: 'rgba(245, 158, 11, 0.08)',
      }}>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Grant PRINTS to all users</div>
          <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Adds the same wallet credit to every active user profile. Each grant is recorded in the PRINTS ledger.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="number"
            min="1"
            step="1"
            max="1000000"
            value={bulkGrant.amount}
            onChange={(event) => setBulkGrant(current => ({ ...current, amount: event.target.value }))}
            placeholder="PRINTS per user"
            style={{
              width: '170px', padding: '9px 12px', borderRadius: '8px',
              border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)',
            }}
          />
          <input
            type="text"
            maxLength={500}
            value={bulkGrant.note}
            onChange={(event) => setBulkGrant(current => ({ ...current, note: event.target.value }))}
            placeholder="Reason or note (optional)"
            style={{
              flex: '1 1 260px', padding: '9px 12px', borderRadius: '8px',
              border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)',
            }}
          />
          <button
            type="button"
            onClick={() => void grantPrintsToAll()}
            disabled={bulkGrantStatus.loading}
            style={{
              padding: '9px 16px', borderRadius: '8px', border: 0,
              background: bulkGrantStatus.loading ? 'var(--bg-hover)' : '#f59e0b',
              color: bulkGrantStatus.loading ? 'var(--text-muted)' : '#111827',
              fontWeight: 700, cursor: bulkGrantStatus.loading ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {bulkGrantStatus.loading ? 'Granting...' : 'Grant to all users'}
          </button>
        </div>
        {bulkGrantStatus.error && <div style={{ marginTop: '10px', color: '#ef4444', fontSize: '0.82rem' }}>{bulkGrantStatus.error}</div>}
        {bulkGrantStatus.success && <div style={{ marginTop: '10px', color: '#10b981', fontSize: '0.82rem', fontWeight: 600 }}>{bulkGrantStatus.success}</div>}
      </div>

      <div style={{
        marginBottom: '24px', padding: '18px', borderRadius: '12px',
        border: '1px solid #3b82f6', background: 'rgba(59, 130, 246, 0.08)',
      }}>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Grant PRINTS to new users only</div>
          <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Credits only accounts that have never received an individual, all-user, or new-user dashboard grant. Earned cashback and affiliate rewards do not disqualify them.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="number" min="1" step="1" max="1000000" value={newUserGrant.amount}
            onChange={(event) => setNewUserGrant(current => ({ ...current, amount: event.target.value }))}
            placeholder="PRINTS per new user"
            style={{ width: '190px', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          <input type="text" maxLength={500} value={newUserGrant.note}
            onChange={(event) => setNewUserGrant(current => ({ ...current, note: event.target.value }))}
            placeholder="Welcome note (optional)"
            style={{ flex: '1 1 260px', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          <button type="button" onClick={() => void grantPrintsToNewUsers()} disabled={newUserGrantStatus.loading}
            style={{ padding: '9px 16px', borderRadius: '8px', border: 0, background: newUserGrantStatus.loading ? 'var(--bg-hover)' : '#3b82f6', color: newUserGrantStatus.loading ? 'var(--text-muted)' : '#fff', fontWeight: 700, cursor: newUserGrantStatus.loading ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
            {newUserGrantStatus.loading ? 'Granting...' : 'Grant to new users'}
          </button>
        </div>
        {newUserGrantStatus.error && <div style={{ marginTop: '10px', color: '#ef4444', fontSize: '0.82rem' }}>{newUserGrantStatus.error}</div>}
        {newUserGrantStatus.success && <div style={{ marginTop: '10px', color: '#10b981', fontSize: '0.82rem', fontWeight: 600 }}>{newUserGrantStatus.success}</div>}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: '1 1 220px',
            padding: '8px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
            outline: 'none',
          }}
        />

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          <option value="newest">Sort: Newest</option>
          <option value="oldest">Sort: Oldest</option>
          <option value="most_orders">Sort: Most Orders</option>
          <option value="highest_spend">Sort: Highest Spend</option>
          <option value="highest_prints">Sort: Highest PRINTS</option>
          <option value="lowest_prints">Sort: Lowest PRINTS</option>
        </select>

        <select
          value={minOrders}
          onChange={(e) => setMinOrders(Number(e.target.value))}
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          <option value={0}>All profiles</option>
          <option value={1}>Has orders (1+)</option>
          <option value={2}>2+ orders</option>
          <option value={5}>5+ orders</option>
        </select>

        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
          {filtered.length} profile{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && (
        <div style={{ padding: '16px', background: '#ef444420', border: '1px solid #ef4444', borderRadius: '8px', color: '#ef4444', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading profiles...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
          No profiles found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((profile) => {
            const isExpanded = expandedId === profile.id;
            const initials = getInitials(profile.full_name, profile.email);
            const color = avatarColor(profile.email || profile.id);

            return (
              <div
                key={profile.id}
                style={{
                  background: 'var(--bg-card)',
                  border: `1px solid ${isExpanded ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  borderRadius: '12px',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s',
                }}
              >
                {/* Profile row */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : profile.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '52px 1fr 1fr auto auto auto auto 32px',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '14px 20px',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {/* Avatar */}
                  <AvatarCircle avatarUrl={profile.avatar_url} initials={initials} color={color} />

                  {/* Name + email */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {profile.full_name || <span style={{ color: 'var(--text-muted)' }}>No name</span>}
                      </div>
                      {newUserEmails.has(String(profile.email || '').trim().toLowerCase()) && (
                        <span style={{
                          flexShrink: 0, borderRadius: '999px', background: '#2563eb', color: '#fff',
                          padding: '2px 7px', fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.06em',
                        }}>NEW</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {profile.email}
                    </div>
                  </div>

                  {/* Provider / joined */}
                  <div>
                    {profile.provider && (
                      <span style={{
                        fontSize: '0.7rem', padding: '2px 8px', borderRadius: '99px',
                        background: 'var(--bg-hover)', color: 'var(--text-muted)',
                        textTransform: 'capitalize',
                      }}>
                        {profile.provider}
                      </span>
                    )}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Joined {formatDate(profile.created_at)}
                    </div>
                  </div>

                  {/* PRINTS balance */}
                  <div style={{ textAlign: 'center', minWidth: '72px' }}>
                    <div style={{ fontWeight: '800', fontSize: '1rem', color: '#f59e0b' }}>
                      {profile.printsBalance.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      PRINTS{profile.reservedPrints > 0 ? ` (${profile.reservedPrints.toLocaleString()} reserved)` : ''}
                    </div>
                  </div>

                  {/* Orders count */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: '700', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                      {profile.profileOrders.length}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>orders</div>
                  </div>

                  {/* Total spent */}
                  <div style={{ textAlign: 'right', minWidth: '80px' }}>
                    <div style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      {formatCurrency(profile.totalSpent)}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>total spent</div>
                  </div>

                  {/* Last order */}
                  <div style={{ textAlign: 'right', minWidth: '100px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {profile.lastOrder ? formatDate(profile.lastOrder.created_at) : '—'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>last order</div>
                  </div>

                  {/* Chevron */}
                  <div style={{
                    color: 'var(--text-muted)', fontSize: '0.75rem',
                    transform: isExpanded ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s',
                  }}>
                    ▼
                  </div>
                </div>

                {/* Expanded: order history */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border-color)', padding: '16px 20px', background: 'var(--bg-hover)' }}>
                    {/* Profile details row */}
                    <div style={{ display: 'flex', gap: '32px', marginBottom: '16px', flexWrap: 'wrap' }}>
                      {profile.default_shipping_address?.line1 && (
                        <div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Default Address</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                            {profile.default_shipping_address.line1}
                            {profile.default_shipping_address.line2 && `, ${profile.default_shipping_address.line2}`}
                            {', '}
                            {[profile.default_shipping_address.city, profile.default_shipping_address.state, profile.default_shipping_address.postal_code].filter(Boolean).join(', ')}
                          </div>
                        </div>
                      )}
                      {profile.metadata?.providers?.length > 0 && (
                        <div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Auth Providers</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                            {(profile.metadata.providers).join(', ')}
                          </div>
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Profile ID</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{profile.id}</div>
                      </div>
                    </div>

                    {/* Orders table */}
                    {profile.profileOrders.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '16px 0' }}>
                        No orders yet.
                      </p>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                            {['Order ID', 'Date', 'Cards', 'Amount', 'Status'].map((h) => (
                              <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {profile.profileOrders.map((order) => (
                            <tr key={order.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                {order.id.slice(0, 8)}…
                              </td>
                              <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>{formatDate(order.created_at)}</td>
                              <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>{order.quantity ?? '—'}</td>
                              <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontWeight: '600' }}>{formatCurrency(order.total_amount_cents)}</td>
                              <td style={{ padding: '8px 10px' }}>
                                <span style={{
                                  padding: '3px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: '600',
                                  background: `${ORDER_STATUS_COLORS[order.status] || '#6b7280'}22`,
                                  color: ORDER_STATUS_COLORS[order.status] || '#6b7280',
                                }}>
                                  {order.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Profiles;
