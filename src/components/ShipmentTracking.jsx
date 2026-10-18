import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Truck, Send, Save, RefreshCw } from 'lucide-react';
import { suggestColumns, normalizeShipment } from '../../supabase/functions/_shared/shipment-tracking.mjs';
import { trackingRequest } from '../services/shipmentTracking';
import { readTrackingFile } from '../services/shipmentTrackingFile';
import './ShipmentTracking.css';

const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';
const selectable = (status) => ['ready', 'saved'].includes(status);
const statusLabel = (status) => status === 'accepted' ? 'Accepted by Gmail' : status === 'saved' ? 'Saved · email not sent' : status;
export default function ShipmentTracking() {
  const [csv, setCsv] = useState(null);
  const [filename, setFilename] = useState('');
  const [mapping, setMapping] = useState({ reference: '', tracking: '', carrier: '', email: '' });
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const stop = useRef(false);
  const mounted = useRef(true);
  const active = useRef(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true); setHistoryError('');
    try {
      const data = await trackingRequest({ action: 'history' });
      if (mounted.current) setHistory(data.notifications);
    } catch (err) { if (mounted.current) setHistoryError(err.message); }
    finally { if (mounted.current) setHistoryLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadHistory();
    return () => { mounted.current = false; stop.current = true; };
  }, [loadHistory]);
  useEffect(() => {
    if (!['send', 'save'].includes(phase)) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  const invalidate = () => { setResults([]); setSelected(new Set()); setConfirmed(false); setProgress(''); setError(''); };
  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || active.current) return;
    active.current = true;
    invalidate(); setCsv(null); setFilename(''); setPhase('read');
    try {
      const parsed = await readTrackingFile(file);
      if (mounted.current) {
        const columns = suggestColumns(parsed.headers);
        setCsv(parsed); setMapping(columns); setFilename(file.name);
      }
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { active.current = false; if (mounted.current) setPhase(''); }
  };

  const changeMapping = (field, column) => {
    if (active.current) return;
    invalidate(); setMapping((current) => ({ ...current, [field]: column }));
  };

  const mappedRows = () => csv.rows.map((values) => {
    const read = (field) => mapping[field] === '' ? '' : values[Number(mapping[field])];
    // Email is the association. Never infer an order from the customer's history.
    return { mode: 'email', tracking: read('tracking'), carrier: read('carrier'), email: read('email') };
  });

  const review = async () => {
    if (active.current) return;
    active.current = true; stop.current = false;
    invalidate(); setPhase('review');
    try {
      const rows = mappedRows();
      const trackingCounts = new Map();
      rows.forEach((row) => { const id = normalizeShipment(row).row.tracking; trackingCounts.set(id, (trackingCounts.get(id) || 0) + 1); });
      const next = [];
      for (let offset = 0; offset < rows.length && !stop.current; offset += 100) {
        setProgress(`Checking customers ${offset + 1}–${Math.min(offset + 100, rows.length)} of ${rows.length}…`);
        const data = await trackingRequest({ action: 'preview', rows: rows.slice(offset, offset + 100) });
        next.push(...data.results.map((result) => trackingCounts.get(result.row.tracking) > 1 ? { ...result, status: 'blocked', message: 'Duplicate tracking number in this file. Keep one verified row and upload again.' } : result));
      }
      if (mounted.current && !stop.current) {
        setResults(next);
        setProgress(`${next.filter((item) => selectable(item.status)).length} ready to review out of ${rows.length} shipments.`);
      }
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { active.current = false; if (mounted.current) setPhase(''); }
  };

  const processSelected = async (action) => {
    if (active.current || !confirmed || !selected.size) return;
    active.current = true; stop.current = false; setPhase(action); setError('');
    const chosen = [...selected].filter((index) => selectable(results[index]?.status));
    let completed = 0;
    try {
      for (const index of chosen) {
        if (stop.current) break;
        const item = results[index];
        setProgress(`${action === 'save' ? 'Saving' : 'Sending'} shipment ${completed + 1} of ${chosen.length}…`);
        let result;
        try {
          result = await trackingRequest({ action, row: item.row, snapshot: item.snapshot });
        } catch (err) {
          result = { status: action === 'save' ? 'save_unconfirmed' : 'unknown', message: `${err.message} ${action === 'save' ? 'No email was requested. ' : ''}Refresh the review/history before retrying.` };
          stop.current = true;
        }
        if (mounted.current) {
          setResults((current) => current.map((value, rowIndex) => rowIndex === index ? { ...value, status: result.status, message: result.message } : value));
          // Saving records tracking but leaves the shipment selected for a later
          // email. Only completed sends or non-sendable outcomes clear selection.
          if (!(action === 'save' && result.status === 'saved')) {
            setSelected((current) => { const next = new Set(current); next.delete(index); return next; });
          }

        }
        completed++;
        // Stop the batch if delivery is uncertain or Gmail rejects a message.
        if (result.status !== 'accepted' && !(action === 'save' && result.status === 'saved')) stop.current = true;
      }
    } finally {
      active.current = false;
      if (mounted.current) {
        setPhase(''); setConfirmed(false);
        setProgress(`Processed ${completed} of ${chosen.length} selected shipments. ${stop.current ? 'Batch stopped. Check the results before continuing.' : action === 'save' ? 'No emails sent. Saved shipments remain selected; confirm the details again when you are ready to email them.' : 'See each result below.'}`);
        loadHistory();
      }
    }
  };

  const ready = results.map((row, index) => selectable(row.status) ? index : -1).filter((index) => index >= 0);
  const toggle = (index) => { setConfirmed(false); setSelected((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; }); };
  const busy = !!phase;

  return <div className="shipment-tracking">
    <header className="st-heading"><div><p>FULFILLMENT</p><h1 className="page-title">Shipment tracking</h1><span>Import Pirate Ship tracking, verify customer emails, then save tracking or email your customers.</span></div><Truck size={32} /></header>
    <section className="st-panel">
      <h2>1. Upload your shipment file</h2>
      <p>Use a Pirate Ship CSV or Excel export with customer emails and tracking numbers. No order ID is needed. Each tracking number is saved to the customer email and appears in the profile using that verified email.</p>
      <label className="st-upload"><Upload size={20} /><span>{filename || 'Choose Pirate Ship CSV or Excel'}<small>CSV or .xlsx · up to 500 shipments · 2 MB</small></span><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={upload} /></label>
      {csv && <>
        <div className="st-mappings">
          {Object.entries({ tracking: 'Tracking number column', email: 'Customer email column' }).map(([field, label]) => <label key={field}>{label}<select aria-label={label} value={mapping[field]} disabled={busy} onChange={(event) => changeMapping(field, event.target.value)}><option value="">Choose a column</option>{csv.headers.map((header, index) => <option key={index} value={String(index)}>{header}</option>)}</select></label>)}
        </div>
        <button className="st-primary" onClick={review} disabled={busy || mapping.tracking === '' || mapping.email === ''}>{phase === 'review' ? 'Checking customers…' : 'Review shipments'}</button>
      </>}
    </section>
    {error && <div className="st-error" role="alert">{error}</div>}
    {progress && <p className="st-progress" role="status">{progress}</p>}
    {results.length > 0 && <section className="st-panel">
      <h2>2. Review, save or send</h2><p>Both actions save tracking against the customer email and make it visible in the profile with that verified email. Shipments are not assigned to a particular order. “Save tracking only” sends no email. “Send tracking emails” saves and emails each shipment. Existing order details and statuses stay unchanged.</p>
      <div className="st-table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select all ready shipments" checked={ready.length > 0 && ready.every((index) => selected.has(index))} disabled={busy || !ready.length} onChange={(event) => { setSelected(event.target.checked ? new Set(ready) : new Set()); setConfirmed(false); }} /></th><th>Customer email</th><th>Shipment</th><th>Review</th></tr></thead><tbody>{results.map((result, index) => <tr key={index}>
        <td><input type="checkbox" aria-label={`Select shipment ${index + 1}`} checked={selected.has(index)} disabled={busy || !selectable(result.status)} onChange={() => toggle(index)} /></td>
        <td><strong>{result.row.email || 'No customer email'}</strong></td>
        <td>{result.row.carrier && <strong>{result.row.carrier}</strong>}<code>{result.row.tracking}</code><small>Shipment {index + 1}</small></td>
        <td><b className={`st-status st-${result.status}`}>{statusLabel(result.status)}</b><p>{result.message}</p>{result.email && <details><summary>Preview email</summary><strong>To: {result.email.to}</strong><small>{result.email.subject}</small><pre>{result.email.text}</pre></details>}</td>
      </tr>)}</tbody></table></div>
      <div className="st-send"><label><input type="checkbox" checked={confirmed} disabled={busy || !selected.size} onChange={(event) => setConfirmed(event.target.checked)} /> I checked the selected customer emails and tracking numbers.</label><button onClick={() => processSelected('save')} disabled={busy || !confirmed || !selected.size}><Save size={17} /> Save tracking only ({selected.size})</button><button className="st-primary" onClick={() => processSelected('send')} disabled={busy || !confirmed || !selected.size}><Send size={17} /> Send {selected.size} tracking {selected.size === 1 ? 'email' : 'emails'}</button>{['send', 'save'].includes(phase) && <button onClick={() => { stop.current = true; setProgress('Stopping after the current shipment…'); }}>Stop after current shipment</button>}</div>
    </section>}
    <section className="st-panel"><div className="st-history-heading"><div><h2>Tracking history</h2><p>Latest 100 shipments. Saved means no email was sent. Accepted means Gmail accepted the email; it does not guarantee delivery to the inbox.</p></div><button onClick={loadHistory} disabled={busy || historyLoading}><RefreshCw size={16} /> Refresh</button></div>
      {historyError && <div className="st-error" role="alert">{historyError}</div>}
      {historyLoading ? <p>Loading history…</p> : history.length === 0 ? <p>No tracking recorded yet.</p> : <div className="st-table-wrap"><table><thead><tr><th>Recipient</th><th>Tracking</th><th>Result</th><th>Saved / last email attempt</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td><span>{item.recipient_email}</span></td><td>{item.carrier}<code>{item.tracking_number}</code></td><td><b className={`st-status st-${item.status}`}>{statusLabel(item.status)}</b>{item.error && <small>{item.error}</small>}{['sending', 'unknown'].includes(item.status) && <small>Do not resend until the Gmail outcome is checked.</small>}{item.gmail_message_id && <small>Gmail: {item.gmail_message_id}</small>}</td><td>{formatDate(item.attempted_at || item.created_at)}<small>{item.attempts} email attempt(s)</small></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
