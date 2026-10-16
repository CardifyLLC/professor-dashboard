import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Truck, Send, RefreshCw } from 'lucide-react';
import { parseTrackingCsv, suggestColumns, normalizeShipment, CARRIERS, MAX_CSV_BYTES } from '../../supabase/functions/_shared/shipment-tracking.mjs';
import { trackingRequest } from '../services/shipmentTracking';
import './ShipmentTracking.css';

const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';
const destination = (order) => {
  const address = order?.shipping_address?.address || order?.shipping_address || {};
  return [address.city, address.state, address.postal_code || address.zip, address.country].filter(Boolean).join(', ');
};

export default function ShipmentTracking({ onSelectOrder }) {
  const [csv, setCsv] = useState(null);
  const [filename, setFilename] = useState('');
  const [mapping, setMapping] = useState({ reference: '', tracking: '', carrier: '', email: '' });
  const [defaultCarrier, setDefaultCarrier] = useState('');
  const [references, setReferences] = useState({});
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
    if (phase !== 'send') return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  const invalidate = () => { setResults([]); setSelected(new Set()); setConfirmed(false); setProgress(''); setError(''); };
  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || active.current) return;
    invalidate(); setCsv(null); setFilename(''); setReferences({}); setDefaultCarrier(''); setPhase('read');
    try {
      if (file.size > MAX_CSV_BYTES) throw new Error('Choose a CSV smaller than 2 MB.');
      const content = await file.text();
      if (content.includes('\0')) throw new Error('Choose a UTF-8 CSV, not an Excel workbook or UTF-16 file.');
      const parsed = parseTrackingCsv(content);
      setCsv(parsed); setMapping(suggestColumns(parsed.headers)); setFilename(file.name);
    } catch (err) { setError(err.message); }
    finally { setPhase(''); }
  };

  const mappedRows = () => csv.rows.map((values, index) => {
    const read = (field) => mapping[field] === '' ? '' : values[Number(mapping[field])];
    return { reference: references[index] ?? read('reference'), tracking: read('tracking'), carrier: read('carrier') || defaultCarrier, email: read('email') };
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
        setProgress(`Checking orders ${offset + 1}–${Math.min(offset + 100, rows.length)} of ${rows.length}…`);
        const data = await trackingRequest({ action: 'preview', rows: rows.slice(offset, offset + 100) });
        next.push(...data.results.map((result) => trackingCounts.get(result.row.tracking) > 1 ? { ...result, status: 'blocked', message: 'Duplicate tracking number in this CSV. Keep one verified row and upload again.' } : result));
      }
      if (mounted.current && !stop.current) { setResults(next); setProgress(`${next.filter((item) => item.status === 'ready').length} ready to review out of ${rows.length} shipments.`); }
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { active.current = false; if (mounted.current) setPhase(''); }
  };

  const send = async () => {
    if (active.current || !confirmed || !selected.size) return;
    active.current = true; stop.current = false; setPhase('send'); setError('');
    const chosen = [...selected].filter((index) => results[index]?.status === 'ready');
    let completed = 0;
    try {
      for (const index of chosen) {
        if (stop.current) break;
        const item = results[index];
        setProgress(`Sending shipment ${completed + 1} of ${chosen.length}…`);
        let result;
        try {
          result = await trackingRequest({ action: 'send', row: item.row, orderId: item.order.id, snapshot: item.snapshot });
        } catch (err) {
          result = { status: 'unknown', message: `${err.message} Refresh the review/history before retrying.` };
          stop.current = true;
        }
        if (mounted.current) {
          setResults((current) => current.map((value, rowIndex) => rowIndex === index ? { ...value, status: result.status, message: result.message } : value));
          setSelected((current) => { const next = new Set(current); next.delete(index); return next; });
        }
        completed++;
        // Stop the batch if delivery is uncertain or Gmail rejects a message.
        if (result.status !== 'accepted') stop.current = true;
      }
    } finally {
      active.current = false;
      if (mounted.current) {
        setPhase(''); setConfirmed(false);
        setProgress(`Processed ${completed} of ${chosen.length} selected shipments. ${stop.current ? 'Batch stopped. Check the results before continuing.' : 'See each result below.'}`);
        loadHistory();
      }
    }
  };

  const ready = results.map((row, index) => row.status === 'ready' ? index : -1).filter((index) => index >= 0);
  const toggle = (index) => { setConfirmed(false); setSelected((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; }); };
  const busy = !!phase;

  return <div className="shipment-tracking">
    <header className="st-heading"><div><p>FULFILLMENT</p><h1 className="page-title">Shipment tracking</h1><span>Import Pirate Ship tracking, verify each order, then email your customers.</span></div><Truck size={32} /></header>
    <section className="st-panel">
      <h2>1. Upload your CSV</h2>
      <p>Use Export Tracking Data or a shipment-history CSV. Keep the full TCGPlaytest order ID in Pirate Ship’s Order ID field when creating labels. Email alone is never used to match orders.</p>
      <label className="st-upload"><Upload size={20} /><span>{filename || 'Choose Pirate Ship CSV'}<small>UTF-8 CSV · up to 500 shipments · 2 MB</small></span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={upload} /></label>
      {csv && <>
        <div className="st-mappings">
          {Object.entries({ reference: 'Order ID column', tracking: 'Tracking number column', carrier: 'Carrier / Service column', email: 'Email column (cross-check)' }).map(([field, label]) => <label key={field}>{label}<select value={mapping[field]} disabled={busy} onChange={(event) => { invalidate(); setMapping((value) => ({ ...value, [field]: event.target.value })); }}><option value="">{field === 'reference' ? 'Enter order IDs below' : field === 'tracking' ? 'Choose a column' : 'Not included'}</option>{csv.headers.map((header, index) => <option key={index} value={String(index)}>{header}</option>)}</select></label>)}
          <label>Carrier for rows with no carrier<select value={defaultCarrier} disabled={busy} onChange={(event) => { invalidate(); setDefaultCarrier(event.target.value); }}><option value="">Choose when needed</option>{CARRIERS.map((carrier) => <option key={carrier}>{carrier}</option>)}</select></label>
        </div>
        <details className="st-manual"><summary>Check imported values or enter missing order IDs ({csv.rows.length} rows)</summary><p>For a missing ID, open the correct order in Orders and copy its full ID. Compare its date, cards and delivery address before selecting it here.</p><div className="st-table-wrap"><table><thead><tr><th>Row</th><th>Order ID / saved checkout reference</th><th>Tracking number</th><th>CSV email</th></tr></thead><tbody>{mappedRows().map((row, index) => <tr key={index}><td>{index + 1}</td><td><input aria-label={`Order ID for shipment ${index + 1}`} value={row.reference} disabled={busy} onChange={(event) => { invalidate(); setReferences((value) => ({ ...value, [index]: event.target.value })); }} /></td><td><code>{row.tracking || '—'}</code></td><td>{row.email || '—'}</td></tr>)}</tbody></table></div></details>
        <button className="st-primary" onClick={review} disabled={busy || mapping.tracking === ''}>{phase === 'review' ? 'Checking orders…' : 'Review order matches'}</button>
      </>}
    </section>
    {error && <div className="st-error" role="alert">{error}</div>}
    {progress && <p className="st-progress" role="status">{progress}</p>}
    {results.length > 0 && <section className="st-panel">
      <h2>2. Review and send</h2><p>Recipients and order details come from the saved order. One email is sent per shipment; multiple packages for one order have separate tracking emails. Importing or emailing tracking does not change the order’s status.</p>
      <div className="st-table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select all ready shipments" checked={ready.length > 0 && ready.every((index) => selected.has(index))} disabled={busy || !ready.length} onChange={(event) => { setSelected(event.target.checked ? new Set(ready) : new Set()); setConfirmed(false); }} /></th><th>Order / customer</th><th>Shipment</th><th>Review</th></tr></thead><tbody>{results.map((result, index) => <tr key={index}>
        <td><input type="checkbox" aria-label={`Select shipment ${index + 1}`} checked={selected.has(index)} disabled={busy || result.status !== 'ready'} onChange={() => toggle(index)} /></td>
        <td>{result.order ? <><button className="st-order-link" onClick={() => onSelectOrder(result.order)} disabled={busy}>{result.order.id}</button><strong>{result.order.customer_name || 'Customer'}</strong><span>{result.order.customer_email}</span><small>{formatDate(result.order.created_at)} · {result.order.quantity} cards</small><small>{destination(result.order)}</small>{(result.order.design_name || result.order.uploaded_xml_filename) && <small>{result.order.design_name || result.order.uploaded_xml_filename}</small>}</> : <code>{result.row.reference || 'No order ID'}</code>}</td>
        <td><strong>{result.row.carrier || 'No carrier'}</strong><code>{result.row.tracking}</code><small>CSV row {index + 1}</small></td>
        <td><b className={`st-status st-${result.status}`}>{result.status === 'accepted' ? 'Accepted by Gmail' : result.status}</b><p>{result.message}</p>{result.email && <details><summary>Preview email</summary><strong>To: {result.email.to}</strong><small>{result.email.subject}</small><pre>{result.email.text}</pre></details>}</td>
      </tr>)}</tbody></table></div>
      <div className="st-send"><label><input type="checkbox" checked={confirmed} disabled={busy || !selected.size} onChange={(event) => setConfirmed(event.target.checked)} /> I checked the selected orders, customers and tracking numbers.</label><button className="st-primary" onClick={send} disabled={busy || !confirmed || !selected.size}><Send size={17} /> Send {selected.size} tracking {selected.size === 1 ? 'email' : 'emails'}</button>{phase === 'send' && <button onClick={() => { stop.current = true; setProgress('Stopping after the current shipment…'); }}>Stop after current shipment</button>}</div>
    </section>}
    <section className="st-panel"><div className="st-history-heading"><div><h2>Tracking email history</h2><p>Latest 100 shipments. Accepted means Gmail accepted the email; it does not guarantee delivery to the inbox.</p></div><button onClick={loadHistory} disabled={busy || historyLoading}><RefreshCw size={16} /> Refresh</button></div>
      {historyError && <div className="st-error" role="alert">{historyError}</div>}
      {historyLoading ? <p>Loading history…</p> : history.length === 0 ? <p>No tracking emails recorded yet.</p> : <div className="st-table-wrap"><table><thead><tr><th>Order / recipient</th><th>Tracking</th><th>Result</th><th>Last attempt</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td><code>{item.order_id}</code><span>{item.recipient_email}</span></td><td>{item.carrier}<code>{item.tracking_number}</code></td><td><b className={`st-status st-${item.status}`}>{item.status === 'accepted' ? 'Accepted by Gmail' : item.status}</b>{item.error && <small>{item.error}</small>}{['sending', 'unknown'].includes(item.status) && <small>Do not resend until the Gmail outcome is checked.</small>}{item.gmail_message_id && <small>Gmail: {item.gmail_message_id}</small>}</td><td>{formatDate(item.attempted_at)}<small>{item.attempts} attempt(s)</small></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
