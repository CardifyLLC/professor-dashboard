import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, ShieldCheck, Copy, RefreshCw, Plus, Ban, Activity, ArrowUpRight } from 'lucide-react';
import { agentAccessRequest } from '../services/agentAccess';
import './AgentAccess.css';

const date = value => value ? new Date(value).toLocaleString() : 'Never';
export default function AgentAccess() {
  const [agents, setAgents] = useState([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState(null);
  const modal = useRef(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const generation = useRef(0);
  const origin = window.location.origin;
  const endpoint = origin + '/api/agent-orders?order=ORDER_ID_OR_STRIPE_SESSION_ID';

  const load = useCallback(async (page = 0) => {
    const request = ++generation.current;
    setLoading(true); setListError('');
    try {
      const data = await agentAccessRequest({ offset: page });
      if (mounted.current && request === generation.current) {
        setAgents(data.agents); setOffset(page); setNextOffset(data.nextOffset);
      }
    } catch (err) {
      if (mounted.current && request === generation.current) setListError(err.message);
    } finally { if (mounted.current && request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const counter = generation;
    mounted.current = true;
    load();
    return () => { mounted.current = false; counter.current++; };
  }, [load]);
  useEffect(() => {
    if (dialog && modal.current && !modal.current.open) modal.current.showModal();
  }, [dialog]);

  const close = () => {
    if (pending.current) return;
    modal.current?.close();
    setDialog(null); setError(''); setMessage('');
  };
  const copy = async (value) => {
    try { await navigator.clipboard.writeText(value); setMessage('Copied.'); }
    catch { setMessage('Select the text and copy it manually.'); }
  };
  const create = async (event) => {
    event.preventDefault();
    if (pending.current || !name.trim()) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const data = await agentAccessRequest({ action: 'create', name: name.trim() });
      if (mounted.current) { setDialog({ type: 'key', agent: data.agent, key: data.key }); setName(''); load(0); }
    } catch (err) {
      if (mounted.current) {
        setError(err.message + ' If creation was interrupted, refresh the list and revoke any key you did not receive.');
        load(0);
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const revoke = async () => {
    if (pending.current || dialog?.type !== 'revoke') return;
    pending.current = true; setBusy(true); setError('');
    try {
      await agentAccessRequest({ action: 'revoke', id: dialog.agent.id });
      if (mounted.current) {
        modal.current?.close(); setDialog(null); setMessage('Access revoked. This key can no longer start order reads.');
        load(offset);
      }
    } catch (err) {
      if (mounted.current) { setError(err.message + ' Revocation was not confirmed. Refresh the agent list to check its status.'); load(offset); }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const activity = async (agent) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const data = await agentAccessRequest({ agent: agent.id });
      if (mounted.current) setDialog({ type: 'activity', agent, events: data.events });
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };

  return <div className="agent-access">
    <header className="aa-heading"><div><p className="aa-eyebrow">INTEGRATIONS</p><h1>Agent Access</h1><p>Give your AI agents their own keys to read order details.</p></div><ShieldCheck size={36} aria-hidden="true" /></header>
    <section className="aa-permission"><ShieldCheck size={24} aria-hidden="true" /><div><strong>Order access · Read only</strong><p>Each key can read any order by its ID or Stripe Checkout session ID, including customer contact details, shipping address and tracking. Agents cannot edit orders, refund payments, send emails or manage keys.</p></div></section>
    <section className="aa-panel">
      <h2>Create an agent key</h2>
      <form onSubmit={create} className="aa-create">
        <label>Agent name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="e.g. Customer support agent" required disabled={busy} /></label>
        <button className="aa-primary" type="submit" disabled={busy || !name.trim()}><Plus size={18} aria-hidden="true" />{busy && !dialog ? 'Working…' : 'Create key'}</button>
      </form>
      <p className="aa-small">Use a separate key for each agent. The full key is shown once, and you can revoke it anytime.</p>
    </section>
    {error && !dialog && <p className="aa-error" role="alert">{error}</p>}
    {message && !dialog && <p className="aa-success" role="status">{message}</p>}
    <section className="aa-panel">
      <div className="aa-section-heading"><h2>Your agents</h2><button disabled={busy || loading} onClick={() => load(offset)}><RefreshCw size={16} aria-hidden="true" /> Refresh</button></div>
      {listError && <p className="aa-error" role="alert">{listError}</p>}
      {loading ? <p role="status">Loading agents…</p> : !agents.length ? <div className="aa-empty"><KeyRound size={28} aria-hidden="true" /><strong>No agent keys yet</strong><p>Create a key to connect your first agent.</p></div> : <div className="aa-table-wrap">
        <table><thead><tr><th>Agent</th><th>Status</th><th>Created</th><th>Last used</th><th>Requests</th><th>Actions</th></tr></thead>
          <tbody>{agents.map(agent => <tr key={agent.id}>
            <td><strong>{agent.name}</strong><code>{agent.key_prefix}…</code><small>orders:read</small></td>
            <td><span className={'aa-badge ' + (agent.revoked_at ? 'aa-revoked' : 'aa-active')}>{agent.revoked_at ? 'Revoked' : 'Active'}</span>{agent.revoked_at && <small>{date(agent.revoked_at)}</small>}</td>
            <td>{date(agent.created_at)}</td><td>{date(agent.last_used_at)}</td><td>{Number(agent.request_count || 0).toLocaleString()}</td>
            <td><div className="aa-actions"><button onClick={() => activity(agent)} disabled={busy} aria-label={'View activity for ' + agent.name}><Activity size={16} aria-hidden="true" /> Activity</button>
              {!agent.revoked_at && <button className="aa-danger" disabled={busy} onClick={() => { setError(''); setMessage(''); setDialog({ type: 'revoke', agent }); }} aria-label={'Revoke ' + agent.name}><Ban size={16} aria-hidden="true" /> Revoke</button>}</div></td>
          </tr>)}</tbody>
        </table>
      </div>}
      {(offset > 0 || nextOffset !== null) && <div className="aa-pagination"><button disabled={busy || loading || offset === 0} onClick={() => load(Math.max(0, offset - 50))}>Previous</button><span>Page {Math.floor(offset / 50) + 1}</span><button disabled={busy || loading || nextOffset === null} onClick={() => load(nextOffset)}>Next</button></div>}
    </section>
    <section className="aa-panel">
      <div className="aa-section-heading"><h2>Connect any compatible agent</h2><a href="/agent-openapi.json" target="_blank" rel="noreferrer">OpenAPI schema <ArrowUpRight size={15} aria-hidden="true" /></a></div>
      <ol className="aa-steps"><li>Create a key and put it in the agent platform’s private credential settings.</li><li>Configure an HTTP/API tool using the endpoint and header below, or import the OpenAPI schema.</li><li>Give the agent an order ID or dashboard order link. Configure its tool to extract the order reference and call this API.</li></ol>
      <label>Order endpoint<input value={endpoint} readOnly onFocus={event => event.target.select()} /></label>
      <pre>{'GET ' + endpoint + '\nAuthorization: Bearer YOUR_AGENT_KEY'}</pre>
      <button onClick={() => copy('GET ' + endpoint + '\nAuthorization: Bearer YOUR_AGENT_KEY')}><Copy size={16} aria-hidden="true" /> Copy setup example</button>
      <p className="aa-small">60 requests per minute per key. Your browser does not need to stay logged in. Agents must support authenticated API tools; ordinary dashboard links still require admin login. Keep keys in credentials, never in a URL or chat message.</p>
    </section>

    <dialog ref={modal} className="aa-dialog" aria-labelledby="aa-dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
      {dialog?.type === 'key' && <>
        <KeyRound size={30} aria-hidden="true" /><h2 id="aa-dialog-title">Your key for {dialog.agent.name}</h2>
        <p>Copy this key now. It will not be shown again. Store it in your agent’s private credential settings.</p>
        <label>New agent key<textarea aria-label="New agent key" readOnly value={dialog.key} rows={3} spellCheck={false} autoComplete="off" onFocus={event => event.target.select()} /></label>
        <div className="aa-actions"><button onClick={() => copy(dialog.key)}><Copy size={16} aria-hidden="true" /> Copy key</button><button className="aa-primary" onClick={close}>I’ve saved the key</button></div>
      </>}
      {dialog?.type === 'revoke' && <>
        <Ban size={30} aria-hidden="true" /><h2 id="aa-dialog-title">Revoke access for {dialog.agent.name}?</h2>
        <p>This permanently disables this key. Other agents keep their access. You can create a new key later if needed.</p>
        <div className="aa-actions"><button onClick={close} disabled={busy}>Cancel</button><button className="aa-danger" onClick={revoke} disabled={busy}>{busy ? 'Revoking…' : 'Revoke access'}</button></div>
      </>}
      {dialog?.type === 'activity' && <>
        <Activity size={30} aria-hidden="true" /><h2 id="aa-dialog-title">Activity · {dialog.agent.name}</h2><p>Latest 50 recorded requests. Results show successful reads, missing orders and invalid references.</p>
        {!dialog.events.length ? <p>No recorded requests yet.</p> : <div className="aa-table-wrap"><table><thead><tr><th>Time</th><th>Order</th><th>Result</th></tr></thead><tbody>{dialog.events.map(event => <tr key={event.id}><td>{date(event.created_at)}</td><td>{event.order_id || '—'}</td><td>{event.outcome === 200 ? 'Read' : event.outcome === 404 ? 'Not found' : 'Invalid request'}</td></tr>)}</tbody></table></div>}
        <button onClick={close}>Close</button>
      </>}
      {error && dialog && <p className="aa-error" role="alert">{error}</p>}
      {message && dialog && <p className="aa-success" role="status">{message}</p>}
    </dialog>
  </div>;
}
