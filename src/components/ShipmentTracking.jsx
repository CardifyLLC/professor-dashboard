import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Truck, Send, Save, RefreshCw } from 'lucide-react';
import { suggestColumns, normalizeShipment, validEmail } from '../../supabase/functions/_shared/shipment-tracking.mjs';
import { trackingRequest } from '../services/shipmentTracking';
import { readTrackingFile } from '../services/shipmentTrackingFile';
import './ShipmentTracking.css';

const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';
const orderOption = (order) => `#${order.id.slice(0, 8)} · ${formatDate(order.created_at)} · ${order.quantity} cards · ${order.design_name || order.uploaded_xml_filename || 'Card order'} · ${order.eligible ? order.status : order.reason || `${order.status} / ${order.payment_status}`}${order.tracking_recorded ? ' · Tracking on file' : ''}`;
const selectable = (status) => ['ready', 'saved'].includes(status);
const statusLabel = (status) => status === 'accepted' ? 'Accepted by Gmail' : status === 'saved' ? 'Saved · email not sent' : status;
const destination = (order) => {
  let source = order?.shipping_address || {};
  if (typeof source === 'string') { try { source = JSON.parse(source); } catch { return source; } }
  const address = source?.address || source || {};
  return [address.line1 || address.address1 || address.street, address.line2 || address.address2, address.city, address.state, address.postal_code || address.zip, address.country].filter(Boolean).join(', ');
};

export default function ShipmentTracking({ onSelectOrder }) {
  const [csv, setCsv] = useState(null);
  const [filename, setFilename] = useState('');
  const [mapping, setMapping] = useState({ reference: '', tracking: '', carrier: '', email: '' });
  const [references, setReferences] = useState({});
  const [candidates, setCandidates] = useState({});
  const [showNotified, setShowNotified] = useState(false);
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
    invalidate(); setCsv(null); setFilename(''); setReferences({}); setCandidates({}); setShowNotified(false); setPhase('read');
    try {
      const parsed = await readTrackingFile(file);
      if (mounted.current) { setCsv(parsed); setMapping(suggestColumns(parsed.headers)); setFilename(file.name); }
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { active.current = false; if (mounted.current) setPhase(''); }
  };

  const mappedRows = () => csv.rows.map((values, index) => {
    const read = (field) => mapping[field] === '' ? '' : values[Number(mapping[field])];
    return { reference: references[index] ?? read('reference'), tracking: read('tracking'), carrier: read('carrier'), email: read('email') };
  });

  const findOrders = async (index, more = false) => {
    if (active.current) return;
    const email = mappedRows()[index].email.trim().toLowerCase();
    if (!validEmail(email)) return;
    const previous = candidates[index]?.email === email ? candidates[index] : null;
    active.current = true; setPhase('lookup');
    setCandidates((current) => ({ ...current, [index]: { ...(more ? previous : {}), email, loading: true, error: '' } }));
    try {
      const data = await trackingRequest({ action: 'candidates', email, offset: more ? previous?.nextOffset ?? 0 : 0 });
      if (mounted.current) setCandidates((current) => ({ ...current, [index]: {
        email, loading: false, error: '', nextOffset: data.nextOffset,
        orders: [...new Map([...(more ? previous?.orders || [] : []), ...data.orders].map((order) => [order.id, order])).values()],
      } }));
    } catch (err) {
      if (mounted.current) setCandidates((current) => ({ ...current, [index]: { ...current[index], loading: false, error: err.message } }));
    } finally { active.current = false; if (mounted.current) setPhase(''); }
  };

  const selectOrder = (index, id) => { invalidate(); setReferences((current) => ({ ...current, [index]: id })); };

  const markRecorded = (orderIds) => {
    setCandidates((current) => Object.fromEntries(Object.entries(current).map(([index, matches]) => [index, {
      ...matches, orders: matches.orders?.map((order) => orderIds.has(order.id) ? { ...order, tracking_recorded: true } : order),
    }])));
  };

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
        next.push(...data.results.map((result) => trackingCounts.get(result.row.tracking) > 1 ? { ...result, status: 'blocked', message: 'Duplicate tracking number in this file. Keep one verified row and upload again.' } : result));
      }
      if (mounted.current && !stop.current) {
        setResults(next);
        markRecorded(new Set(next.filter((item) => ['accepted', 'saved'].includes(item.status)).map((item) => item.order.id)));
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
          result = await trackingRequest({ action, row: item.row, orderId: item.order.id, snapshot: item.snapshot });
        } catch (err) {
          result = { status: action === 'save' ? 'save_unconfirmed' : 'unknown', message: `${err.message} ${action === 'save' ? 'No email was requested. ' : ''}Refresh the review/history before retrying.` };
          stop.current = true;
        }
        if (mounted.current) {
          setResults((current) => current.map((value, rowIndex) => rowIndex === index ? { ...value, status: result.status, message: result.message } : value));
          setSelected((current) => { const next = new Set(current); next.delete(index); return next; });
          if (['saved', 'accepted'].includes(result.status)) {
            markRecorded(new Set([item.order.id]));
            setReferences((current) => ({ ...current, [index]: '' }));
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
        setProgress(`Processed ${completed} of ${chosen.length} selected shipments. ${stop.current ? 'Batch stopped. Check the results before continuing.' : 'See each result below.'}`);
        loadHistory();
      }
    }
  };

  const ready = results.map((row, index) => selectable(row.status) ? index : -1).filter((index) => index >= 0);
  const toggle = (index) => { setConfirmed(false); setSelected((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; }); };
  const busy = !!phase;

  return <div className="shipment-tracking">
    <header className="st-heading"><div><p>FULFILLMENT</p><h1 className="page-title">Shipment tracking</h1><span>Import Pirate Ship tracking, verify each order, then save tracking or email your customers.</span></div><Truck size={32} /></header>
    <section className="st-panel">
      <h2>1. Upload your shipment file</h2>
      <p>Use a Pirate Ship CSV or Excel export. Choose the correct order from each shipment’s dropdown. Orders are found by email and are never selected automatically.</p>
      <label className="st-upload"><Upload size={20} /><span>{filename || 'Choose Pirate Ship CSV or Excel'}<small>CSV or .xlsx · up to 500 shipments · 2 MB</small></span><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={upload} /></label>
      {csv && <>
        <div className="st-mappings">
          {Object.entries({ reference: 'Order ID column', tracking: 'Tracking number column', email: 'Email column (search and cross-check)' }).map(([field, label]) => <label key={field}>{label}<select aria-label={label} value={mapping[field]} disabled={busy} onChange={(event) => { invalidate(); setReferences({}); setCandidates({}); setMapping((value) => ({ ...value, [field]: event.target.value })); }}><option value="">{field === 'reference' ? 'Choose orders below' : field === 'tracking' ? 'Choose a column' : 'Not included'}</option>{csv.headers.map((header, index) => <option key={index} value={String(index)}>{header}</option>)}</select></label>)}
        </div>
        <details className="st-manual" open={mapping.reference === '' ? true : undefined}><summary>2. Choose orders ({csv.rows.length} shipments)</summary><p>Compare the order date, design, card count and delivery address. Each shipment has its own selection, even when several rows use the same email. A single suggested order still requires your choice.</p>
          <label className="st-notified-filter"><input type="checkbox" checked={showNotified} disabled={busy} onChange={(event) => setShowNotified(event.target.checked)} /> Show orders with tracking (to email saved tracking or add packages)</label>
          <p>Orders with saved tracking or a successfully sent tracking email are hidden by default. Failed sends remain available to retry.</p>
          {mappedRows().map((row, index) => {
            const matches = candidates[index];
            const chosenOrder = matches?.orders?.find((order) => order.id === row.reference);
            // Preserve an explicit selection for another package while filtering new choices.
            const visibleOrders = (matches?.orders || []).filter((order) => showNotified || !order.tracking_recorded || order.id === row.reference);
            const hiddenCount = (matches?.orders?.length || 0) - visibleOrders.length;
            return <article className="st-shipment-choice" key={index}>
              <h3>Shipment {index + 1} · <code>{row.tracking || 'No tracking number'}</code></h3>
              <p>{row.email || 'No email column selected'}{csv.headers.map((header, column) => /^(recipient|created date|batch)$/i.test(header) && csv.rows[index][column] ? <small key={column}>{header}: {csv.rows[index][column]}</small> : null)}</p>
              <div className="st-choice-controls">
                <label>Choose customer’s order<select aria-label={`Order for shipment ${index + 1}`} value={row.reference} disabled={busy && !matches?.loading} onFocus={() => { if (!matches && validEmail(row.email.trim())) findOrders(index); }} onChange={(event) => selectOrder(index, event.target.value)}>
                  <option value="">{matches?.loading ? 'Finding matching orders…' : matches?.orders?.length === 0 ? 'No matching orders found' : matches && visibleOrders.length === 0 ? 'No orders without tracking on this page' : 'Choose an order…'}</option>
                  {row.reference && !chosenOrder && <option value={row.reference}>Imported / entered reference: {row.reference}</option>}
                  {visibleOrders.map((order) => <option key={order.id} value={order.id} disabled={!order.eligible || matches.loading}>{orderOption(order)}</option>)}
                </select></label>
                <button disabled={busy || !validEmail(row.email.trim())} onClick={() => findOrders(index)} aria-label={`Find orders for shipment ${index + 1}`}>{matches?.loading ? 'Finding orders…' : 'Find orders by email'}</button>
              </div>
              {matches?.error && <p className="st-error" role="alert">{matches.error}</p>}
              {hiddenCount > 0 && <p>{hiddenCount} {hiddenCount === 1 ? 'order with tracking hidden' : 'orders with tracking hidden'}. Enable “Show orders with tracking” to email saved tracking or add a package{matches.nextOffset != null ? ', or load older orders below' : ''}.</p>}
              {matches?.orders?.length === 0 && <p>No matching orders found. Check the email or enter the full order ID manually.</p>}
              {matches?.nextOffset != null && <button disabled={busy} onClick={() => findOrders(index, true)}>Load older orders for shipment {index + 1}</button>}
              {chosenOrder && <div className="st-candidate st-chosen" aria-label={`Selected order details for shipment ${index + 1}`}>
                <span><strong>{chosenOrder.design_name || chosenOrder.uploaded_xml_filename || 'Card order'} · {chosenOrder.quantity} cards</strong><code>{chosenOrder.id}</code><small>{formatDate(chosenOrder.created_at)} · {chosenOrder.status} / {chosenOrder.payment_status}</small><small>{chosenOrder.customer_name} · {chosenOrder.customer_email}</small><small>{destination(chosenOrder) || 'No saved delivery address'}</small>{chosenOrder.tracking_recorded && <small>Tracking is already on file. You can email a saved shipment or add an additional package.</small>}{chosenOrder.reason && <small className="st-ineligible">{chosenOrder.reason}</small>}</span>
              </div>}
              <details className="st-reference-entry"><summary>Enter an order reference manually</summary><label>Order ID / saved checkout reference<input aria-label={`Order ID for shipment ${index + 1}`} value={row.reference} disabled={busy} onChange={(event) => selectOrder(index, event.target.value)} /></label></details>
            </article>;
          })}
        </details>
        <button className="st-primary" onClick={review} disabled={busy || mapping.tracking === ''}>{phase === 'review' ? 'Checking orders…' : 'Review order matches'}</button>
      </>}
    </section>
    {error && <div className="st-error" role="alert">{error}</div>}
    {progress && <p className="st-progress" role="status">{progress}</p>}
    {results.length > 0 && <section className="st-panel">
      <h2>3. Review, save or send</h2><p>Both actions save tracking to the selected order and make it visible in the customer’s profile. “Save tracking only” sends no email. “Send tracking emails” saves and emails each shipment. Neither action changes the order’s status.</p>
      <div className="st-table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select all ready shipments" checked={ready.length > 0 && ready.every((index) => selected.has(index))} disabled={busy || !ready.length} onChange={(event) => { setSelected(event.target.checked ? new Set(ready) : new Set()); setConfirmed(false); }} /></th><th>Order / customer</th><th>Shipment</th><th>Review</th></tr></thead><tbody>{results.map((result, index) => <tr key={index}>
        <td><input type="checkbox" aria-label={`Select shipment ${index + 1}`} checked={selected.has(index)} disabled={busy || !selectable(result.status)} onChange={() => toggle(index)} /></td>
        <td>{result.order ? <><button className="st-order-link" onClick={() => onSelectOrder(result.order)} disabled={busy}>{result.order.id}</button><strong>{result.order.customer_name || 'Customer'}</strong><span>{result.order.customer_email}</span><small>{formatDate(result.order.created_at)} · {result.order.quantity} cards</small><small>{destination(result.order)}</small>{(result.order.design_name || result.order.uploaded_xml_filename) && <small>{result.order.design_name || result.order.uploaded_xml_filename}</small>}</> : <code>{result.row.reference || 'No order ID'}</code>}</td>
        <td>{result.row.carrier && <strong>{result.row.carrier}</strong>}<code>{result.row.tracking}</code><small>Shipment {index + 1}</small></td>
        <td><b className={`st-status st-${result.status}`}>{statusLabel(result.status)}</b><p>{result.message}</p>{result.email && <details><summary>Preview email</summary><strong>To: {result.email.to}</strong><small>{result.email.subject}</small><pre>{result.email.text}</pre></details>}</td>
      </tr>)}</tbody></table></div>
      <div className="st-send"><label><input type="checkbox" checked={confirmed} disabled={busy || !selected.size} onChange={(event) => setConfirmed(event.target.checked)} /> I checked the selected orders, customers and tracking numbers.</label><button onClick={() => processSelected('save')} disabled={busy || !confirmed || !selected.size}><Save size={17} /> Save tracking only ({selected.size})</button><button className="st-primary" onClick={() => processSelected('send')} disabled={busy || !confirmed || !selected.size}><Send size={17} /> Send {selected.size} tracking {selected.size === 1 ? 'email' : 'emails'}</button>{['send', 'save'].includes(phase) && <button onClick={() => { stop.current = true; setProgress('Stopping after the current shipment…'); }}>Stop after current shipment</button>}</div>
    </section>}
    <section className="st-panel"><div className="st-history-heading"><div><h2>Tracking history</h2><p>Latest 100 shipments. Saved means no email was sent. Accepted means Gmail accepted the email; it does not guarantee delivery to the inbox.</p></div><button onClick={loadHistory} disabled={busy || historyLoading}><RefreshCw size={16} /> Refresh</button></div>
      {historyError && <div className="st-error" role="alert">{historyError}</div>}
      {historyLoading ? <p>Loading history…</p> : history.length === 0 ? <p>No tracking recorded yet.</p> : <div className="st-table-wrap"><table><thead><tr><th>Order / recipient</th><th>Tracking</th><th>Result</th><th>Saved / last email attempt</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td><code>{item.order_id}</code><span>{item.recipient_email}</span></td><td>{item.carrier}<code>{item.tracking_number}</code></td><td><b className={`st-status st-${item.status}`}>{statusLabel(item.status)}</b>{item.error && <small>{item.error}</small>}{['sending', 'unknown'].includes(item.status) && <small>Do not resend until the Gmail outcome is checked.</small>}{item.gmail_message_id && <small>Gmail: {item.gmail_message_id}</small>}</td><td>{formatDate(item.attempted_at || item.created_at)}<small>{item.attempts} email attempt(s)</small></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
