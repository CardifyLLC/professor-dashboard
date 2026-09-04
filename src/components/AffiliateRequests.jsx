import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Copy, Download, ExternalLink, Gift, QrCode, RefreshCw, Search, Users, WalletCards, X } from 'lucide-react';
import QRCode from 'qrcode';
import { getAdminAuthHeaders, supabaseAdmin } from '../services/supabaseClient';
import { buildGrantEmail, sendBulkEmailCampaign } from '../services/bulkEmailCampaign';
import './AffiliateRequests.css';

const FILTERS = ['all', 'pending', 'approved', 'rejected'];

const formatDate = (value) => value ? new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(value)) : '—';

const label = (value) => value
  ? value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ')
  : 'Not provided';

const displayStatus = (status) => status === 'declined' ? 'rejected' : (status || 'pending');

const readFunctionResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(response.ok
      ? 'The server returned an invalid response.'
      : text.slice(0, 500));
  }
};

const decisionCopy = (request, action) => {
  const firstName = request.name?.trim().split(/\s+/)[0] || 'there';
  return action === 'approved'
    ? `Hi ${firstName}, your affiliate application has been approved. Welcome to the TCGPlaytest Affiliate Program!`
    : `Hi ${firstName}, thank you for applying. We are unable to approve your affiliate application at this time, but you are welcome to apply again in the future.`;
};

export default function AffiliateRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(null);
  const [sending, setSending] = useState(false);
  const [grantForm, setGrantForm] = useState({ recipient: '', amount: '', note: '' });
  const [granting, setGranting] = useState(false);
  const [grantResult, setGrantResult] = useState(null);
  const [bulkGrant, setBulkGrant] = useState({ amount: '', note: '' });
  const [bulkGrantStatus, setBulkGrantStatus] = useState({ loading: false, error: '', success: '' });
  const [newUserGrant, setNewUserGrant] = useState({ amount: '', note: '' });
  const [newUserGrantStatus, setNewUserGrantStatus] = useState({ loading: false, error: '', success: '' });
  const [grantConfirmation, setGrantConfirmation] = useState(null);
  const [walletBalances, setWalletBalances] = useState({});
  const [qrPreview, setQrPreview] = useState(null);
  const [qrGenerating, setQrGenerating] = useState('');
  const [backfillingQr, setBackfillingQr] = useState(false);
  const [backfillResult, setBackfillResult] = useState('');

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    const [requestsResult, profilesResult, walletsResult] = await Promise.all([
      supabaseAdmin.from('affiliate_applications').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('profiles').select('id,email,full_name'),
      supabaseAdmin.from('wallet_accounts').select('user_id,balance,reserved_balance').eq('account_code', 'prints'),
    ]);
    const queryError = requestsResult.error || profilesResult.error || walletsResult.error;
    if (queryError) {
      setError(queryError.message);
    } else {
      const profilesById = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
      const nextBalances = {};
      (walletsResult.data || []).forEach((wallet) => {
        const profile = profilesById.get(wallet.user_id);
        const balance = Number(wallet.balance || 0);
        nextBalances[wallet.user_id] = balance;
        if (profile?.email) nextBalances[profile.email.toLowerCase()] = balance;
      });
      setRequests(requestsResult.data || []);
      setWalletBalances(nextBalances);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const counts = useMemo(() => requests.reduce((result, request) => {
    const status = displayStatus(request.status);
    result[status] = (result[status] || 0) + 1;
    result.all += 1;
    return result;
  }, { all: 0, pending: 0, approved: 0, rejected: 0 }), [requests]);

  const visibleRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests.filter((request) => {
      const matchesFilter = filter === 'all' || displayStatus(request.status) === filter;
      const matchesSearch = !query || [request.name, request.email, request.primary_channel, request.message]
        .some((value) => String(value || '').toLowerCase().includes(query));
      return matchesFilter && matchesSearch;
    });
  }, [filter, requests, search]);

  const approvedMembers = useMemo(
    () => requests.filter((request) => displayStatus(request.status) === 'approved'),
    [requests],
  );

  const openDecision = (request, action) => setDialog({
    request,
    action,
    approvalType: 'code',
    affiliateCode: request.requested_affiliate_code || '',
    message: decisionCopy(request, action),
    error: '',
  });

  const openQrCode = async (affiliate) => {
    if (!affiliate?.affiliate_link) return;
    setQrGenerating(affiliate.id);
    setError('');
    try {
      const dataUrl = await QRCode.toDataURL(affiliate.affiliate_link, {
        width: 900,
        margin: 3,
        errorCorrectionLevel: 'H',
        color: { dark: '#07111f', light: '#ffffff' },
      });
      setQrPreview({
        dataUrl,
        link: affiliate.affiliate_link,
        code: affiliate.affiliate_code || 'affiliate',
        name: affiliate.name || affiliate.email || 'Affiliate',
      });
    } catch (qrError) {
      setError(`Could not generate QR code: ${qrError.message}`);
    } finally {
      setQrGenerating('');
    }
  };

  const downloadQrCode = () => {
    if (!qrPreview) return;
    const safeCode = String(qrPreview.code).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    const link = document.createElement('a');
    link.href = qrPreview.dataUrl;
    link.download = `affiliate-${safeCode}-qr.png`;
    link.click();
  };

  const generateAllQrCodes = async () => {
    if (backfillingQr) return;
    const eligibleCount = approvedMembers.filter((member) => member.affiliate_code).length;
    if (eligibleCount === 0) {
      setBackfillResult('No approved affiliates with codes were found.');
      return;
    }
    if (!window.confirm(`Generate and email fresh QR assets for all ${eligibleCount} approved affiliate${eligibleCount === 1 ? '' : 's'}? Existing QR assets will be replaced.`)) return;

    setBackfillingQr(true);
    setBackfillResult('');
    setError('');
    try {
      const authHeaders = await getAdminAuthHeaders();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/affiliate-request-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'generate_all_qr' }),
      });
      const result = await readFunctionResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not generate QR assets for all affiliates.');
      setBackfillResult(
        result.processed === 0
          ? 'No approved affiliates with codes were found.'
          : `Generated and emailed ${result.processed} affiliate QR set${result.processed === 1 ? '' : 's'}${result.failed ? `; ${result.failed} failed.` : '.'}`,
      );
      await loadRequests();
    } catch (backfillError) {
      setError(`QR backfill failed: ${backfillError.message}`);
    } finally {
      setBackfillingQr(false);
    }
  };

  const submitPrintGrant = async (event) => {
    event.preventDefault();
    const amount = Number(grantForm.amount);
    if (!grantForm.recipient.trim() || !Number.isSafeInteger(amount) || amount <= 0) return;
    if (!window.confirm(`Grant ${amount.toLocaleString()} prints to ${grantForm.recipient.trim()}?`)) return;

    setGranting(true);
    setGrantResult(null);
    try {
      const authHeaders = await getAdminAuthHeaders();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grant-prints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          recipient: grantForm.recipient.trim(),
          amount,
          note: grantForm.note.trim(),
        }),
      });
      const result = await readFunctionResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not grant prints.');
      const profileName = result.profile?.full_name || result.profile?.email || grantForm.recipient;
      const reportsEmailDelivery = Object.prototype.hasOwnProperty.call(result, 'emailSent');
      const emailMessage = reportsEmailDelivery
        ? (result.emailSent ? 'Notification email sent.' : result.emailWarning)
        : 'The deployed grant-prints function did not report an email attempt. Redeploy grant-prints to the Supabase project used by this dashboard.';
      setGrantResult({
        type: reportsEmailDelivery && result.emailSent ? 'success' : 'warning',
        message: [
          `Granted ${amount.toLocaleString()} prints to ${profileName}. New balance: ${Number(result.resultingBalance).toLocaleString()}.`,
          emailMessage,
        ].filter(Boolean).join(' '),
      });
      setWalletBalances((current) => ({
        ...current,
        [result.profile.id]: Number(result.resultingBalance),
        [String(result.profile.email || '').toLowerCase()]: Number(result.resultingBalance),
      }));
      setGrantForm({ recipient: '', amount: '', note: '' });
    } catch (grantError) {
      setGrantResult({ type: 'error', message: grantError.message });
    } finally {
      setGranting(false);
    }
  };

  const grantPrintsToAll = async (event, confirmed = false) => {
    event?.preventDefault();
    const amount = Number(bulkGrant.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
      setBulkGrantStatus({ loading: false, error: 'Enter a whole PRINTS amount between 1 and 1,000,000.', success: '' });
      return;
    }
    if (!confirmed) {
      setGrantConfirmation({ type: 'all', amount });
      return;
    }
    setGrantConfirmation(null);

    setBulkGrantStatus({ loading: true, error: '', success: '' });
    try {
      const authHeaders = await getAdminAuthHeaders();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grant-prints-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ amount, note: bulkGrant.note.trim() }),
      });
      const result = await readFunctionResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not grant PRINTS to all users.');
      const message = buildGrantEmail({ amount, note: bulkGrant.note.trim() });
      const delivery = await sendBulkEmailCampaign({
        emails: result.notificationRecipients,
        ...message,
        onProgress: (progress) => setBulkGrantStatus({ loading: true, error: '', success: `PRINTS granted. ${progress}` }),
      });
      setBulkGrantStatus({
        loading: false,
        error: '',
        success: [
          `Granted ${amount.toLocaleString()} PRINTS to ${Number(result.grantedCount || 0).toLocaleString()} users.`,
          `Emails accepted: ${delivery.sent.toLocaleString()}.`,
          delivery.failed ? `Emails failed: ${delivery.failed.toLocaleString()}.` : '',
          delivery.campaignId ? `Receipt ID: ${delivery.campaignId}.` : '',
        ].filter(Boolean).join(' '),
      });
      setBulkGrant({ amount: '', note: '' });
      await loadRequests();
    } catch (grantError) {
      setBulkGrantStatus({ loading: false, error: grantError.message || 'Could not grant PRINTS to all users.', success: '' });
    }
  };

  const grantPrintsToNewUsers = async (event, confirmed = false) => {
    event?.preventDefault();
    const amount = Number(newUserGrant.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
      setNewUserGrantStatus({ loading: false, error: 'Enter a whole PRINTS amount between 1 and 1,000,000.', success: '' });
      return;
    }
    if (!confirmed) {
      setGrantConfirmation({ type: 'new', amount, loadingRecipients: true, recipientCount: null, recipientError: '' });
      try {
        const authHeaders = await getAdminAuthHeaders();
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grant-prints-new-users`, {
          method: 'GET', headers: authHeaders,
        });
        const result = await readFunctionResponse(response);
        if (!response.ok) throw new Error(result.error || 'Could not load eligible new users.');
        setGrantConfirmation((current) => current?.type === 'new'
          ? { ...current, loadingRecipients: false, recipientCount: Number(result.eligibleCount || 0), recipientError: '' }
          : current);
      } catch (countError) {
        setGrantConfirmation((current) => current?.type === 'new'
          ? { ...current, loadingRecipients: false, recipientCount: null, recipientError: countError.message || 'Could not load eligible new users.' }
          : current);
      }
      return;
    }
    setGrantConfirmation(null);
    setNewUserGrantStatus({ loading: true, error: '', success: '' });
    try {
      const authHeaders = await getAdminAuthHeaders();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grant-prints-new-users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ amount, note: newUserGrant.note.trim() }),
      });
      const result = await readFunctionResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not grant PRINTS to new users.');
      const message = buildGrantEmail({ amount, note: newUserGrant.note.trim(), welcome: true });
      const delivery = await sendBulkEmailCampaign({
        emails: result.notificationRecipients,
        ...message,
        onProgress: (progress) => setNewUserGrantStatus({ loading: true, error: '', success: `PRINTS granted. ${progress}` }),
      });
      setNewUserGrantStatus({ loading: false, error: '', success: [
        result.grantedCount
          ? `Granted ${amount.toLocaleString()} PRINTS to ${Number(result.grantedCount).toLocaleString()} new users.`
          : 'No newly eligible users were found.',
        `Emails accepted: ${delivery.sent.toLocaleString()}.`,
        delivery.failed ? `Emails failed: ${delivery.failed.toLocaleString()}.` : '',
        delivery.campaignId ? `Receipt ID: ${delivery.campaignId}.` : '',
      ].filter(Boolean).join(' ') });
      setNewUserGrant({ amount: '', note: '' });
      await loadRequests();
    } catch (grantError) {
      setNewUserGrantStatus({ loading: false, error: grantError.message || 'Could not grant PRINTS to new users.', success: '' });
    }
  };

  const submitDecision = async (event) => {
    event.preventDefault();
    if (!dialog || sending) return;
    setSending(true);
    setDialog((current) => ({ ...current, error: '' }));
    try {
      const authHeaders = await getAdminAuthHeaders();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/affiliate-request-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          requestId: dialog.request.id,
          action: dialog.action,
          approvalType: dialog.approvalType,
          affiliateCode: dialog.action === 'approved' ? dialog.affiliateCode.trim().toUpperCase() : undefined,
          message: dialog.message.trim(),
        }),
      });
      const result = await readFunctionResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not process this request.');
      setRequests((current) => current.map((request) => request.id === result.request.id ? result.request : request));
      setDialog(null);
    } catch (actionError) {
      setDialog((current) => ({ ...current, error: actionError.message }));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="affiliate-page">
      <div className="affiliate-heading">
        <div><h1 className="page-title">Affiliate Requests</h1><p>Review applications and track every decision.</p></div>
        <button className="affiliate-refresh" onClick={loadRequests} disabled={loading} type="button"><RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh</button>
      </div>
      <div className="affiliate-summary">
        <div><Users size={18} /><span><strong>{counts.all}</strong>Total</span></div>
        <div><Clock size={18} /><span><strong>{counts.pending}</strong>Pending</span></div>
        <div className="is-approved"><Check size={18} /><span><strong>{counts.approved}</strong>Approved</span></div>
        <div className="is-rejected"><X size={18} /><span><strong>{counts.rejected}</strong>Rejected</span></div>
      </div>

      <section className="approved-members-panel">
        <div className="approved-members-heading">
          <div>
            <h2><WalletCards size={19} /> Approved members</h2>
            <p>Live PRINTS balances for every approved affiliate.</p>
          </div>
          <div className="approved-members-controls">
            <button type="button" onClick={generateAllQrCodes} disabled={backfillingQr}>
              <QrCode size={15} />
              {backfillingQr ? 'Generating for all...' : 'Generate QR for all'}
            </button>
            <span>{approvedMembers.length} member{approvedMembers.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        {backfillResult && <div className="affiliate-backfill-result">{backfillResult}</div>}
        {approvedMembers.length === 0 ? (
          <div className="approved-members-empty">No approved affiliates yet.</div>
        ) : (
          <div className="approved-members-list">
            {approvedMembers.map((member) => {
              const balance = walletBalances[String(member.email || '').toLowerCase()] ?? 0;
              return (
                <div className="approved-member-row" key={member.id}>
                  <div className="approved-member-person">
                    <div className="affiliate-avatar">{(member.name || member.email || '?').charAt(0).toUpperCase()}</div>
                    <div><strong>{member.name || 'Unnamed member'}</strong><span>{member.email}</span></div>
                  </div>
                  <div className="approved-member-balance">
                    <strong>{balance.toLocaleString()}</strong><span>PRINTS</span>
                  </div>
                  {member.affiliate_link || member.affiliate_code ? (
                    <div className="approved-member-link-actions">
                      <button type="button" onClick={() => navigator.clipboard.writeText(member.affiliate_link || member.affiliate_code)}>
                        <Copy size={13} /> {member.affiliate_link ? 'Link' : member.affiliate_code}
                      </button>
                      {member.affiliate_link && (
                        <button type="button" onClick={() => openQrCode(member)} disabled={qrGenerating === member.id}>
                          <QrCode size={14} /> {qrGenerating === member.id ? 'Generating...' : 'QR'}
                        </button>
                      )}
                    </div>
                  ) : <span className="approved-member-no-link">No code/link</span>}
                  <button
                    type="button"
                    onClick={() => {
                      setGrantForm((current) => ({ ...current, recipient: member.email || '' }));
                      setGrantResult(null);
                    }}
                  >
                    <Gift size={14} /> Grant prints
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="print-grant-panel">
        <div className="print-grant-heading">
          <div className="print-grant-icon"><Gift size={20} /></div>
          <div>
            <h2>Grant prints</h2>
            <p>Add prints to any registered user&apos;s wallet. Every grant is recorded in the wallet ledger.</p>
          </div>
        </div>
        <form className="print-grant-form" onSubmit={submitPrintGrant}>
          <label>
            Profile email or UUID
            <input
              type="text"
              required
              value={grantForm.recipient}
              onChange={(event) => setGrantForm((current) => ({ ...current, recipient: event.target.value }))}
              placeholder="customer@example.com"
            />
          </label>
          <label>
            Prints
            <input
              type="number"
              required
              min="1"
              max="1000000"
              step="1"
              value={grantForm.amount}
              onChange={(event) => setGrantForm((current) => ({ ...current, amount: event.target.value }))}
              placeholder="100"
            />
          </label>
          <label>
            Note
            <input
              type="text"
              maxLength={500}
              value={grantForm.note}
              onChange={(event) => setGrantForm((current) => ({ ...current, note: event.target.value }))}
              placeholder="Reason for this grant"
            />
          </label>
          <button type="submit" disabled={granting}>
            <Gift size={16} /> {granting ? 'Granting...' : 'Grant prints'}
          </button>
        </form>
        {grantResult && (
          <div className={`print-grant-result ${grantResult.type}`}>{grantResult.message}</div>
        )}
      </section>

      <section className="print-grant-panel">
        <div className="print-grant-heading">
          <div className="print-grant-icon"><Users size={20} /></div>
          <div>
            <h2>Grant PRINTS to all users</h2>
            <p>Add the same wallet credit to every active user profile. Every grant is recorded separately in the wallet ledger.</p>
          </div>
        </div>
        <form className="print-grant-form" onSubmit={grantPrintsToAll}>
          <label>
            PRINTS per user
            <input
              type="number"
              required
              min="1"
              max="1000000"
              step="1"
              value={bulkGrant.amount}
              onChange={(event) => setBulkGrant((current) => ({ ...current, amount: event.target.value }))}
              placeholder="100"
            />
          </label>
          <label>
            Note
            <input
              type="text"
              maxLength={500}
              value={bulkGrant.note}
              onChange={(event) => setBulkGrant((current) => ({ ...current, note: event.target.value }))}
              placeholder="Reason for this bulk grant"
            />
          </label>
          <button type="submit" className="grant-all-button" disabled={bulkGrantStatus.loading}>
            <Users size={16} /> {bulkGrantStatus.loading ? 'Granting to all...' : 'Grant to all users'}
          </button>
        </form>
        {bulkGrantStatus.error && <div className="print-grant-result error">{bulkGrantStatus.error}</div>}
        {bulkGrantStatus.success && <div className="print-grant-result success">{bulkGrantStatus.success}</div>}
      </section>

      <section className="print-grant-panel">
        <div className="print-grant-heading">
          <div className="print-grant-icon"><Gift size={20} /></div>
          <div>
            <h2>Grant PRINTS to new users only</h2>
            <p>Credits accounts that have never received an individual, all-user, or new-user dashboard grant. Earned rewards do not disqualify them.</p>
          </div>
        </div>
        <form className="print-grant-form" onSubmit={grantPrintsToNewUsers}>
          <label>
            PRINTS per new user
            <input type="number" required min="1" max="1000000" step="1" value={newUserGrant.amount}
              onChange={(event) => setNewUserGrant(current => ({ ...current, amount: event.target.value }))} placeholder="100" />
          </label>
          <label>
            Note
            <input type="text" maxLength={500} value={newUserGrant.note}
              onChange={(event) => setNewUserGrant(current => ({ ...current, note: event.target.value }))} placeholder="Welcome note (optional)" />
          </label>
          <button type="submit" className="grant-new-button" disabled={newUserGrantStatus.loading}>
            <Gift size={16} /> {newUserGrantStatus.loading ? 'Granting to new users...' : 'Grant to new users'}
          </button>
        </form>
        {newUserGrantStatus.error && <div className="print-grant-result error">{newUserGrantStatus.error}</div>}
        {newUserGrantStatus.success && <div className="print-grant-result success">{newUserGrantStatus.success}</div>}
      </section>

      <div className="affiliate-toolbar">
        <div className="affiliate-filters" role="tablist" aria-label="Request status">
          {FILTERS.map((status) => (
            <button type="button" role="tab" aria-selected={filter === status} className={filter === status ? 'active' : ''} onClick={() => setFilter(status)} key={status}>
              {label(status)} <span>{counts[status]}</span>
            </button>
          ))}
        </div>
        <label className="affiliate-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requests" /></label>
      </div>
      {error && <div className="affiliate-error">Could not load affiliate requests: {error}</div>}
      {loading && <div className="affiliate-empty">Loading affiliate requests...</div>}
      {!loading && !error && visibleRequests.length === 0 && (
        <div className="affiliate-empty">No {filter === 'all' ? '' : `${filter} `}requests found.</div>
      )}
      {!loading && visibleRequests.length > 0 && (
        <div className="affiliate-list">
          {visibleRequests.map((request) => {
            const status = displayStatus(request.status);
            return (
              <article className="affiliate-card" key={request.id}>
                <div className="affiliate-card-top">
                  <div className="affiliate-applicant">
                    <div className="affiliate-avatar">{(request.name || request.email || '?').charAt(0).toUpperCase()}</div>
                    <div><h2>{request.name || 'Unnamed applicant'}</h2><a href={`mailto:${request.email}`}>{request.email}</a></div>
                  </div>
                  <span className={`affiliate-status ${status}`}>{status}</span>
                </div>
                <dl className="affiliate-details">
                  <div><dt>Primary channel</dt><dd>{label(request.primary_channel)}</dd></div>
                  <div><dt>Audience size</dt><dd>{request.audience_size?.toLocaleString?.() || request.audience_size || 'Not provided'}</dd></div>
                  <div><dt>Requested code</dt><dd>{request.requested_affiliate_code || 'No preference'}</dd></div>
                  <div><dt>Submitted</dt><dd>{formatDate(request.created_at)}</dd></div>
                  {status !== 'pending' && <div><dt>Decision date</dt><dd>{formatDate(request.reviewed_at || request.updated_at)}</dd></div>}
                </dl>
                <div className="affiliate-message"><span>Application message</span><p>{request.message || 'No message provided.'}</p></div>
                {status === 'pending' ? (
                  <div className="affiliate-actions">
                    <button type="button" className="reject" onClick={() => openDecision(request, 'rejected')}><X size={16} /> Reject</button>
                    <button type="button" className="approve" onClick={() => openDecision(request, 'approved')}><Check size={16} /> Approve</button>
                  </div>
                ) : (
                  <>
                    <div className="affiliate-response-note">
                      <Check size={15} />
                      {request.decision_email_status === 'sent'
                        ? 'Decision saved and email sent'
                        : 'Decision saved to the applicant profile'}
                    </div>
                    {request.decision_message && (
                      <div className="affiliate-decision-message">
                        <span>Profile and email message</span>
                        <p>{request.decision_message}</p>
                      </div>
                    )}
                    {status === 'approved' && request.affiliate_code && (
                      <div className="affiliate-link">
                        <div>
                          <span>{request.affiliate_link ? 'Affiliate link' : 'Affiliate code'}</span>
                          <strong>{request.affiliate_link || request.affiliate_code}</strong>
                        </div>
                        <div className="affiliate-link-actions">
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(request.affiliate_link || request.affiliate_code)}
                          >
                            {request.affiliate_link ? <ExternalLink size={15} /> : <Copy size={15} />}
                            {request.affiliate_link ? 'Copy link' : 'Copy code'}
                          </button>
                          {request.affiliate_link && (
                            <button type="button" onClick={() => openQrCode(request)} disabled={qrGenerating === request.id}>
                              <QrCode size={15} />
                              {qrGenerating === request.id ? 'Generating...' : 'QR code'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
      {grantConfirmation && (
        <div className="affiliate-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setGrantConfirmation(null);
        }}>
          <div className={`affiliate-modal grant-confirmation ${grantConfirmation.type === 'all' ? 'grant-confirmation-danger' : 'grant-confirmation-new'}`} role="alertdialog" aria-modal="true" aria-labelledby="grant-confirmation-title">
            <div className="affiliate-modal-title">
              <div>
                <span id="grant-confirmation-title">
                  {grantConfirmation.type === 'all' ? 'Warning: grant to every user?' : 'Confirm new-user grant'}
                </span>
                <p>Please review the audience carefully before continuing.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setGrantConfirmation(null)}><X size={20} /></button>
            </div>
            <div className="grant-confirmation-summary">
              <strong>{grantConfirmation.amount.toLocaleString()} PRINTS per user</strong>
              <p>{grantConfirmation.type === 'all'
                ? 'This will grant PRINTS to EVERY active user account, including existing users who may have received grants before.'
                : grantConfirmation.loadingRecipients
                  ? 'Counting eligible new users…'
                  : grantConfirmation.recipientError
                    ? `Recipient count unavailable: ${grantConfirmation.recipientError}`
                    : `This will grant PRINTS to ${grantConfirmation.recipientCount.toLocaleString()} eligible new user${grantConfirmation.recipientCount === 1 ? '' : 's'}. Eligible accounts have never received an individual, all-user, or new-user dashboard grant.`}</p>
              <p>Each credit is recorded in the wallet ledger. This action cannot be undone from this screen.</p>
            </div>
            <div className="affiliate-modal-actions">
              <button type="button" className="cancel" onClick={() => setGrantConfirmation(null)}>No, cancel</button>
              <button
                type="button"
                className={grantConfirmation.type === 'all' ? 'grant-confirm-all' : 'grant-confirm-new'}
                disabled={grantConfirmation.type === 'new' && (
                  grantConfirmation.loadingRecipients ||
                  grantConfirmation.recipientCount === null ||
                  grantConfirmation.recipientCount === 0
                )}
                onClick={() => grantConfirmation.type === 'all'
                  ? void grantPrintsToAll(null, true)
                  : void grantPrintsToNewUsers(null, true)}
              >
                {grantConfirmation.type === 'all'
                  ? 'Yes, grant to ALL users'
                  : grantConfirmation.loadingRecipients
                    ? 'Counting users…'
                    : grantConfirmation.recipientCount === 0
                      ? 'No eligible users'
                      : `Yes, grant to ${grantConfirmation.recipientCount?.toLocaleString()} users`}
              </button>
            </div>
          </div>
        </div>
      )}
      {qrPreview && (
        <div
          className="affiliate-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setQrPreview(null);
          }}
        >
          <div className="affiliate-modal affiliate-qr-modal" role="dialog" aria-modal="true" aria-label="Affiliate QR code">
            <div className="affiliate-modal-title">
              <div>
                <span>Affiliate QR code</span>
                <p>{qrPreview.name}</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setQrPreview(null)}><X size={20} /></button>
            </div>
            <div className="affiliate-qr-image">
              <img src={qrPreview.dataUrl} alt={`QR code for ${qrPreview.code}`} />
            </div>
            <div className="affiliate-qr-link">{qrPreview.link}</div>
            <p className="affiliate-qr-note">Scanning this QR code opens the exact affiliate link, so orders keep the same affiliate attribution.</p>
            <div className="affiliate-modal-actions">
              <button type="button" className="cancel" onClick={() => setQrPreview(null)}>Close</button>
              <button type="button" className="approve" onClick={downloadQrCode}><Download size={16} /> Download PNG</button>
            </div>
          </div>
        </div>
      )}
      {dialog && (
        <div className="affiliate-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) setDialog(null); }}>
          <form className="affiliate-modal" onSubmit={submitDecision}>
            <div className="affiliate-modal-title">
              <div>
                <span>{dialog.action === 'approved' ? 'Approve application' : 'Reject application'}</span>
                <p>
                  {dialog.action === 'approved'
                    ? `This updates the profile, creates a unique affiliate ${dialog.approvalType === 'link' ? 'link' : 'code'}, and emails ${dialog.request.name || dialog.request.email}.`
                    : `This updates the profile status and emails ${dialog.request.name || dialog.request.email}.`}
                </p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setDialog(null)} disabled={sending}><X size={20} /></button>
            </div>
            <div className="affiliate-requested-code">
              <span>Requested affiliate code</span>
              <strong>{dialog.request.requested_affiliate_code || 'No preference provided'}</strong>
            </div>
            {dialog.action === 'approved' && (
              <>
              <div className="affiliate-approval-type">
                <label>
                  <input
                    type="radio"
                    name="approvalType"
                    value="code"
                    checked={dialog.approvalType !== 'link'}
                    onChange={() => setDialog((current) => ({ ...current, approvalType: 'code' }))}
                  />
                  Approve with code
                </label>
                <label>
                  <input
                    type="radio"
                    name="approvalType"
                    value="link"
                    checked={dialog.approvalType === 'link'}
                    onChange={() => setDialog((current) => ({ ...current, approvalType: 'link' }))}
                  />
                  Approve with VIP link
                </label>
              </div>
              <label>
                Affiliate code
                <input
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-z0-9_-]{3,32}"
                  value={dialog.affiliateCode}
                  onChange={(event) => setDialog((current) => ({ ...current, affiliateCode: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))}
                  placeholder="Affiliate code"
                />
              </label>
              </>
            )}
            <label>
              Profile and email message
              <textarea
                required
                rows={6}
                value={dialog.message}
                onChange={(event) => setDialog((current) => ({ ...current, message: event.target.value }))}
              />
            </label>
            {dialog.error && <div className="affiliate-error">{dialog.error}</div>}
            <div className="affiliate-modal-actions">
              <button type="button" className="cancel" onClick={() => setDialog(null)} disabled={sending}>Cancel</button>
              <button type="submit" className={dialog.action === 'approved' ? 'approve' : 'reject'} disabled={sending || !dialog.message.trim()}>
                {sending ? 'Sending...' : dialog.action === 'approved' ? 'Approve & send email' : 'Reject & send email'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
