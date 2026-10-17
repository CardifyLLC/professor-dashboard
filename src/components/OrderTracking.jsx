import { useEffect, useState } from 'react';
import { supabaseAdmin } from '../services/supabaseClient';
import { trackingUrl } from '../../supabase/functions/_shared/shipment-tracking.mjs';

export default function OrderTracking({ orderId }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    setRows([]); setLoading(true); setError('');
    (async () => {
      const all = [];
      for (let offset = 0; ; offset += 100) {
        const result = await supabaseAdmin.from('shipment_tracking_notifications')
          .select('id,tracking_number,carrier,status').eq('order_id', orderId)
          .order('created_at').order('id').range(offset, offset + 99).abortSignal(controller.signal);
        if (result.error) throw result.error;
        all.push(...result.data);
        if (result.data.length < 100) break;
      }
      if (active) setRows(all);
    })().catch(() => { if (active) setError('Could not load tracking.'); })
      .finally(() => { clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [orderId, refresh]);
  return <div aria-label={`Tracking for order ${orderId}`} style={{ minWidth: 160, overflowWrap: 'anywhere' }}>
    {loading ? 'Loading tracking…' : error ? <span>{error} <button onClick={() => setRefresh(value => value + 1)}>Retry</button></span> : rows.length ? rows.map(row => {
      const url = trackingUrl(row.carrier, row.tracking_number);
      return <div key={row.id} style={{ marginBottom: 8 }}>
        {url ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)' }}>{row.tracking_number}</a> : <span>{row.tracking_number}</span>}
        <small style={{ display: 'block', color: 'var(--text-muted)' }}>{row.status === 'saved' ? 'Saved · email not sent' : row.status === 'accepted' ? 'Email accepted by Gmail' : `Email: ${row.status}`}</small>
      </div>;
    }) : 'No tracking yet'}
  </div>;
}
