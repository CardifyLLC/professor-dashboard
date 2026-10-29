import { useRef, useState } from 'react';
import { envelopeOrderEligible } from '../../supabase/functions/_shared/envelope-shipping.mjs';
import { shipEnvelope } from '../services/envelopeShipping';

export default function EnvelopeShipmentButton({ order, onUpdated }) {
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  if (!envelopeOrderEligible(order)) return null;
  const status = result?.status || order.envelope_email_status;
  const shippedAt = result?.shippedAt || order.envelope_shipped_at;
  const locked = Boolean(shippedAt) && status !== 'failed';

  async function markShipped(event) {
    event.stopPropagation();
    if (busy.current || locked) return;
    busy.current = true; setSending(true); setError('');
    try {
      const outcome = await shipEnvelope(order.id);
      setResult(outcome);
      // Notify the surrounding list/detail with the saved state. A refresh error
      // must not turn a successful send into an invitation to send it again.
      try { await onUpdated?.({ ...order, status: 'shipped', envelope_shipped_at: outcome.shippedAt, envelope_email_status: outcome.status }); }
      catch { /* The saved receipt and local result remain authoritative. */ }
    } catch (failure) { setError(failure.message || 'Shipping could not be confirmed. Refresh the order.'); }
    finally { busy.current = false; setSending(false); }
  }

  return <div style={{ maxWidth: '300px', fontSize: '0.8rem' }} onClick={event => event.stopPropagation()}>
    <button type="button" className="order-complete-btn" onClick={markShipped} disabled={sending || locked}
      title={shippedAt ? 'Plain White Envelope shipment recorded' : 'Mark shipped by Plain White Envelope, email the customer and notify their profile'}>
      {sending ? 'Saving shipment…' : shippedAt ? status === 'failed' ? 'Retry shipping email' : 'Shipped · Plain White Envelope' : 'Shipped'}
    </button>
    {!shippedAt && <p style={{ margin: '4px 0', color: 'var(--text-muted)' }}>Plain White Envelope · emails customer</p>}
    {shippedAt && <p role="status" style={{ margin: '4px 0' }}>
      {status === 'accepted' ? 'Email accepted · profile notified' : status === 'failed' ? 'Profile notified · email failed' : 'Profile notified · check email delivery in Gmail'}
    </p>}
    {error && <p role="alert" style={{ color: '#f59e0b', margin: '4px 0' }}>{error}</p>}
  </div>;
}
