import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Truck, Check, LoaderCircle, RefreshCw } from 'lucide-react';
import { MAX_CSV_ROWS } from '../../supabase/functions/_shared/shipment-tracking.mjs';
import { trackingRequest } from '../services/shipmentTracking';
import { readTrackingFile } from '../services/shipmentTrackingFile';
import { prepareProfileTracking, saveProfileTracking } from '../services/profileTrackingImport.mjs';
import './ShipmentTracking.css';

const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';
const count = (value) => value.toLocaleString('en-US');
const statusLabel = (status) => status === 'accepted' ? 'Accepted by Gmail' : status === 'saved' ? 'Saved · email not sent' : status;

export default function ShipmentTracking() {
  const [filename, setFilename] = useState('');
  const [pending, setPending] = useState(null);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const mounted = useRef(true);
  const active = useRef(false);
  const confirmation = useRef(null);
  const input = useRef(null);
  const busy = Boolean(phase);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const data = await trackingRequest({ action: 'history' });
      if (mounted.current) setHistory(data.notifications);
    } catch (err) {
      if (mounted.current) setHistoryError(err.message);
    } finally {
      if (mounted.current) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadHistory();
    return () => { mounted.current = false; };
  }, [loadHistory]);

  useEffect(() => {
    if (phase !== 'save') return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  useEffect(() => {
    if (pending && confirmation.current && !confirmation.current.open) confirmation.current.showModal();
  }, [pending]);

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || active.current || pending) return;
    active.current = true;
    setSummary(null);
    setIssues([]);
    setError('');
    setFilename(file.name);
    setPhase('read');
    setProgress('Reading your shipment file…');
    try {
      const parsed = await readTrackingFile(file);
      if (!mounted.current) return;
      setPhase('check');
      const batch = await prepareProfileTracking(parsed, {
        request: trackingRequest,
        onProgress: (message) => { if (mounted.current) setProgress(message); },
        isCancelled: () => !mounted.current,
      });
      if (mounted.current) { setPending(batch); setProgress(''); }
    } catch (err) {
      if (mounted.current) {
        setError(err.message);
        setIssues(err.issues || []);
        setProgress('');
      }
    } finally {
      active.current = false;
      if (mounted.current) setPhase('');
    }
  };

  const cancel = () => {
    if (active.current) return;
    confirmation.current?.close();
    setPending(null);
    setProgress('Upload cancelled. No changes were made.');
    input.current?.focus();
  };

  const publish = async () => {
    if (active.current || !pending) return;
    active.current = true;
    const batch = pending;
    confirmation.current?.close();
    setPending(null);
    setPhase('save');
    setError('');
    try {
      const result = await saveProfileTracking(batch, {
        request: trackingRequest,
        onProgress: ({ saved, total }) => {
          if (mounted.current) setProgress(`Making tracking visible: ${count(saved + 1)} of ${count(total)}… Keep this page open until it finishes.`);
        },
        isCancelled: () => !mounted.current,
      });
      if (mounted.current) {
        setSummary({ ...result, alreadySaved: batch.alreadySaved, total: batch.total });
        setError(result.error || '');
        setProgress('');
      }
    } finally {
      active.current = false;
      if (mounted.current) {
        setPhase('');
        loadHistory();
        input.current?.focus();
      }
    }
  };

  return <div className="shipment-tracking">
    <header className="st-heading">
      <div><p>FULFILLMENT</p><h1 className="page-title">Shipment tracking</h1><span>Upload your shipment file and make tracking visible in customer profiles.</span></div>
      <Truck size={34} aria-hidden="true" />
    </header>

    <section className="st-panel">
      <h2>Upload your shipment file</h2>
      <p>Use your Pirate Ship export with customer emails and tracking numbers. Confirm once to show tracking in the profile using the same verified email. No order ID is needed, and no emails will be sent.</p>
      <label className="st-upload">
        <Upload size={26} aria-hidden="true" />
        <span>{filename || 'Choose Pirate Ship CSV or Excel'}<small>CSV or .xlsx · up to {count(MAX_CSV_ROWS)} shipments · 2 MB</small></span>
        <input ref={input} type="file" aria-label="Choose Pirate Ship CSV or Excel" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy || Boolean(pending)} onChange={upload} />
      </label>
    </section>

    <dialog ref={confirmation} className="st-confirm" aria-labelledby="st-confirm-title" aria-describedby="st-confirm-description" onCancel={(event) => { event.preventDefault(); cancel(); }}>
      <Truck size={36} aria-hidden="true" />
      <h2 id="st-confirm-title">Make these tracking numbers visible in customer profiles?</h2>
      <p id="st-confirm-description">{pending ? count(pending.total) : 0} tracking numbers from <strong>{filename}</strong>. Customers will see tracking in the profile using the same verified email. No emails will be sent.</p>
      {pending?.alreadySaved > 0 && <p>{count(pending.alreadySaved)} already saved; these will be kept without duplicates.</p>}
      {pending?.duplicates > 0 && <p>{count(pending.duplicates)} repeated file rows will be skipped.</p>}
      <div className="st-confirm-actions">
        <button type="button" onClick={cancel}>Cancel</button>
        <button type="button" className="st-primary" onClick={publish}><Check size={18} aria-hidden="true" /> Yes, make visible</button>
      </div>
    </dialog>

    {error && <div className="st-error" role="alert">{error}</div>}
    {issues.length > 0 && <details className="st-import-issues" open>
      <summary>{count(issues.length)} shipment rows need correction</summary>
      <ul>{issues.slice(0, 50).map((item, index) => <li key={index}>Row {item.rowNumber}{item.row.email ? ` (${item.row.email})` : ''}: {item.message}</li>)}</ul>
      {issues.length > 50 && <p>Showing the first 50 issues. Correct the file and upload it again.</p>}
    </details>}
    {progress && <p className="st-progress" role="status">{busy && <LoaderCircle className="st-spinner" size={20} aria-hidden="true" />}{progress}</p>}
    {summary && <section className={`st-result${summary.interrupted ? ' st-result-incomplete' : ''}`} role="status">
      <strong>{summary.interrupted
        ? `Stopped: ${count(summary.saved + summary.alreadySaved)} of ${count(summary.total)} tracking numbers confirmed saved.`
        : `Done — ${count(summary.total)} tracking numbers are available in customer profiles.`}</strong>
      <p>{count(summary.saved)} saved now · {count(summary.alreadySaved)} already saved. No emails sent.</p>
      {summary.interrupted && <p>Upload the same file again to check the remaining tracking numbers and continue without duplicates.</p>}
    </section>}

    <section className="st-panel">
      <div className="st-history-heading">
        <div><h2>Tracking history</h2><p>Latest 100 shipments. New uploads save tracking without sending emails. Older email results remain here for reference.</p></div>
        <button onClick={loadHistory} disabled={busy || historyLoading}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>
      </div>
      {historyError && <div className="st-error" role="alert">{historyError}</div>}
      {historyLoading ? <p>Loading history…</p> : history.length === 0 ? <p>No tracking recorded yet.</p> : <div className="st-table-wrap">
        <table><thead><tr><th>Recipient</th><th>Tracking</th><th>Result</th><th>Saved / last email attempt</th></tr></thead>
          <tbody>{history.map((item) => <tr key={item.id}>
            <td><span>{item.recipient_email}</span></td>
            <td>{item.carrier}<code>{item.tracking_number}</code></td>
            <td><b className={`st-status st-${item.status}`}>{statusLabel(item.status)}</b>{item.error && <small>{item.error}</small>}{['sending', 'unknown'].includes(item.status) && <small>The previous email outcome needs checking.</small>}{item.gmail_message_id && <small>Gmail: {item.gmail_message_id}</small>}</td>
            <td>{formatDate(item.attempted_at || item.created_at)}<small>{item.attempts} email attempt(s)</small></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </div>;
}

