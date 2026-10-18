import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, UserPlus, RefreshCw } from 'lucide-react';
import { TEAM_SECTIONS, ORDER_DOWNLOAD_PERMISSION, BATCHER_PERMISSION } from '../../shared/team-permissions.mjs';
import { dashboardAccessRequest } from '../services/dashboardAccess';
import './TeamAccess.css';

const titles = permissions => permissions.map(id => [...TEAM_SECTIONS, ORDER_DOWNLOAD_PERMISSION, BATCHER_PERMISSION].find(section => section.id === id)?.title || id).join(', ');
export default function TeamAccess() {
  const [members, setMembers] = useState([]);
  const [offset, setOffset] = useState(0), [nextOffset, setNextOffset] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editor, setEditor] = useState(null), [permissions, setPermissions] = useState([]), [email, setEmail] = useState('');
  const modal = useRef(null), generation = useRef(0), pending = useRef(false);
  const load = useCallback(async (page = 0) => {
    const version = ++generation.current;
    setLoading(true);
    try {
      const result = await dashboardAccessRequest('/api/dashboard-access?mode=members&offset=' + page);
      if (version === generation.current) { setMembers(result.members); setOffset(page); setNextOffset(result.nextOffset); }
    } catch (err) { if (version === generation.current) setError(err.message); }
    finally { if (version === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { const counter = generation; load(); return () => { counter.current++; }; }, [load]);
  useEffect(() => { if (editor && modal.current && !modal.current.open) modal.current.showModal(); }, [editor]);
  const close = () => { if (pending.current) return; modal.current?.close(); setEditor(null); setError(''); };
  const open = (kind, member = null) => {
    setError(''); setNotice(''); setEmail(member?.email || ''); setPermissions(member?.permissions || []); setEditor({ kind, member });
  };
  const save = async event => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const kind = editor.kind;
    const body = kind === 'grant' ? { action: 'grant', email, permissions } : { action: kind === 'revoke' ? 'revoke' : 'update', id: editor.member.id, version: editor.member.version, ...(kind !== 'revoke' ? { permissions } : {}) };
    try {
      await dashboardAccessRequest('/api/dashboard-access', body);
      modal.current?.close(); setEditor(null);
      setNotice(kind === 'revoke' ? 'Access removed. New requests from this person are now blocked.' : 'Access saved. Share the dashboard URL with this person; they must sign in with the approved email.');
      await load(offset);
    } catch (err) { setError(err.message + ' If the request was interrupted, close this dialog and refresh the list to check the saved permissions.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className="team-access">
    <header className="ta-heading"><div><p className="ta-eyebrow">ADMINISTRATION</p><h1>Team Access</h1><p>Choose which sections each person can view, download order PDFs or use Batcher PRO.</p></div><ShieldCheck size={38}/></header>
    <div className="ta-panel ta-info"><ShieldCheck size={24}/><div><strong>Read-only access, controlled by your admins</strong><p>Each checkbox grants access to all records shown in that section, including the customer information described below. Viewers cannot change orders, save tracking, send emails, issue refunds, grant PRINTS or manage access.</p><p>They use their own approved Google account. Full administrators keep their existing access. Adding someone here does not send an invitation email.</p></div></div>
    <div className="ta-toolbar"><button className="ta-primary" onClick={() => open('grant')} disabled={busy}><UserPlus size={17}/>Allow an email</button><button onClick={() => { setError(''); load(offset); }} disabled={loading || busy}><RefreshCw size={16}/>Refresh</button></div>
    {notice && <p role="status" className="ta-notice">{notice}</p>}
    {error && !editor && <p role="alert" className="ta-error">{error}</p>}
    <div className="ta-panel"><h2>People with dashboard access</h2><p>Remove access anytime. Previously viewed or copied information cannot be recalled.</p>
      {loading ? <p role="status">Loading access…</p> : members.length ? <div className="ta-table-wrap"><table><thead><tr><th>Email</th><th>Allowed sections</th><th>Status</th><th>Actions</th></tr></thead><tbody>{members.map(member => <tr key={member.id}>
        <td>{member.email}<small>{member.user_id ? 'Account connected' : 'Waiting for first sign-in'}</small></td><td>{titles(member.permissions)}</td><td><span className={'ta-badge ' + (member.revoked_at ? 'ta-revoked' : '')}>{member.revoked_at ? 'Removed' : 'Active'}</span></td><td><div className="ta-toolbar"><button aria-label={'Edit access for ' + member.email} onClick={() => open('edit', member)}>{member.revoked_at ? 'Restore access' : 'Edit permissions'}</button>{!member.revoked_at && <button className="ta-danger" aria-label={'Remove access for ' + member.email} onClick={() => open('revoke', member)}>Remove access</button>}</div></td>
      </tr>)}</tbody></table></div> : <div className="ta-empty">No viewer access yet. Allow an email to get started.</div>}
      <div className="ta-pagination"><button disabled={!offset || loading} onClick={() => load(Math.max(0, offset - 50))}>Previous</button><span>Page {offset / 50 + 1}</span><button disabled={nextOffset === null || loading} onClick={() => load(nextOffset)}>Next</button></div>
    </div>
    {editor && <dialog className="ta-dialog" ref={modal} aria-labelledby="team-dialog-title" onCancel={event => { event.preventDefault(); close(); }}><form onSubmit={save}>
      <h2 id="team-dialog-title">{editor.kind === 'revoke' ? 'Remove dashboard access?' : editor.kind === 'grant' ? 'Allow dashboard access' : editor.member.revoked_at ? 'Restore dashboard access' : 'Edit read permissions'}</h2>
      {editor.kind === 'revoke' ? <p><strong>{email}</strong> will lose access to every allowed section. This does not delete their customer account or orders.</p> : <>
        <label className="ta-email">Approved email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} readOnly={editor.kind !== 'grant'} autoComplete="off"/></label>
        <fieldset disabled={busy}><legend>Allow this person to read</legend><div className="ta-permissions">{TEAM_SECTIONS.map(section => <label key={section.id} className={'ta-permission ' + (permissions.includes(section.id) ? 'ta-checked' : '')}><input type="checkbox" checked={permissions.includes(section.id)} onChange={event => setPermissions(current => event.target.checked ? [...current, section.id] : current.filter(id => id !== section.id && !(section.id === 'orders' && id === 'order-downloads')))}/><span><strong>{section.title}</strong><small>{section.description}</small></span></label>)}</div></fieldset>
        <fieldset disabled={busy}><legend>Order downloads</legend><label className={'ta-permission ' + (permissions.includes('order-downloads') ? 'ta-checked' : '')}>
          <input type="checkbox" checked={permissions.includes('order-downloads')} onChange={event => setPermissions(current => event.target.checked ? [...new Set([...current, 'orders', 'order-downloads'])] : current.filter(id => id !== 'order-downloads'))}/>
          <span><strong>{ORDER_DOWNLOAD_PERMISSION.title}</strong><small>{ORDER_DOWNLOAD_PERMISSION.description}</small></span>
        </label></fieldset>
        <fieldset disabled={busy}><legend>Printing tools</legend><label className={'ta-permission ' + (permissions.includes('batcher') ? 'ta-checked' : '')}>
          <input type="checkbox" checked={permissions.includes('batcher')} onChange={event => setPermissions(current => event.target.checked ? [...current, 'batcher'] : current.filter(id => id !== 'batcher'))}/>
          <span><strong>{BATCHER_PERMISSION.title}</strong><small>{BATCHER_PERMISSION.description}</small></span>
        </label></fieldset>
        <p className="ta-small">Saved records remain read-only. Access management, Agent Access and partner operations require a full administrator.</p>
      </>}
      {error && <p className="ta-error" role="alert">{error}</p>}
      <div className="ta-toolbar"><button type="button" onClick={close} disabled={busy}>Cancel</button><button className={editor.kind === 'revoke' ? 'ta-danger' : 'ta-primary'} type="submit" disabled={busy || (editor.kind !== 'revoke' && (!email.trim() || !permissions.length))}>{busy ? 'Saving…' : editor.kind === 'revoke' ? 'Confirm removal' : 'Save access'}</button></div>
    </form></dialog>}
  </section>;
}
