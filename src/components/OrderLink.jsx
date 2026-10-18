import { useState } from 'react';
import { orderLink } from '../services/orderLinks.mjs';

export default function OrderLink({ orderId }) {
  const [message, setMessage] = useState('');
  const url = orderLink(orderId);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setMessage('Link copied.'); }
    catch { setMessage('Select the link above and copy it.'); }
  };
  return <div style={{ marginTop: 10, fontSize: 13, overflowWrap: 'anywhere' }}>
    <label style={{ display: 'block' }}>Direct order link
      <input aria-label="Direct order link" readOnly value={url} onFocus={(event) => event.target.select()}
        style={{ display: 'block', width: '100%', margin: '6px 0', padding: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 6 }} />
    </label>
    <button type="button" onClick={copy}>Copy order link</button>
    <small style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)' }}>Opens this order’s full details. Dashboard admin sign-in required.</small>
    {message && <span role="status">{message}</span>}
  </div>;
}
