import { useEffect, useState } from 'react';

export default function ReportDeliveryStatus({ items = [], runs = [], canApprove, busy, onReview }) {
  const [drafts, setDrafts] = useState({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const edit = (id, field, value) => setDrafts(current => ({ ...current, [id]: { ...current[id], [field]: value } }));
  return <section aria-label="Report delivery and AI generation status">
    <h2>Report delivery</h2>
    <p>Daily reports are due after 03:20 UTC. Weekly reports are due after 03:35 UTC on Monday. Delivery requires the scheduled workflow and mail configuration.</p>
    {!items.length && <p>No report delivery records yet.</p>}
    {items.map(item => {
      const draft = drafts[item.id] || {};
      const reviewable = item.status === 'uncertain' || (item.status === 'sending' && now - Date.parse(item.updated_at) > 30 * 60000);
      return <article key={item.id}>
        <h3>{item.recipient} — {item.status}</h3>
        <p>{item.delivery_key} · Attempts: {item.send_attempts} / 3</p>
        <p>Updated: {new Date(item.updated_at).toLocaleString()}{item.next_attempt_at && ` · Retry after: ${new Date(item.next_attempt_at).toLocaleString()}`}</p>
        {item.provider_reference && <p>Provider reference: {item.provider_reference}</p>}
        {reviewable && <p>Check the provider before recording the outcome. This form sends no email. Confirmed rejection permits a retry after 15 minutes, within the three-attempt limit.</p>}
        {reviewable && canApprove && <form onSubmit={event => { event.preventDefault(); onReview({ action: 'review_report_delivery', id: item.id, outcome: draft.outcome || 'accepted', reference: draft.reference, note: draft.note }); }}>
          <label>Verified provider outcome<select value={draft.outcome || 'accepted'} onChange={event => edit(item.id, 'outcome', event.target.value)}><option value="accepted">Accepted by provider</option><option value="not_accepted">Confirmed not accepted</option></select></label>
          <label>Provider message or investigation reference<input required maxLength={500} value={draft.reference || ''} onChange={event => edit(item.id, 'reference', event.target.value)} /></label>
          <label>Evidence checked<textarea required minLength={10} maxLength={2000} value={draft.note || ''} onChange={event => edit(item.id, 'note', event.target.value)} /></label>
          <button disabled={busy}>Record reviewed outcome</button>
        </form>}
      </article>;
    })}
    <h2>Automatic idea generation</h2>
    {!runs.length && <p>No generation runs recorded. Automatic ideas require the scheduled workflow, an enabled flag, and a configured model.</p>}
    {runs.map(run => <p key={run.id}>{run.generation_key} — {run.status} · Attempts: {run.attempts} / 3 · Updated: {new Date(run.updated_at).toLocaleString()}</p>)}
  </section>;
}
