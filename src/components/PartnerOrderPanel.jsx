import { useState } from 'react';
import { fetchOrderById, updateOrderStatus } from '../services/orderService';

export default function PartnerOrderPanel({order,onOrderUpdated}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [carrier,setCarrier]=useState(''),[tracking,setTracking]=useState(''),[trackingUrl,setTrackingUrl]=useState('');
  const artwork=order.partnerArtwork;
  const files=artwork?.files || [];
  const ready=files.filter(file=>['stored','processed'].includes(file.state)).length;
  const failures=[...new Set(files.map(file=>file.last_error).filter(Boolean))];
  async function perform(work) {
    setBusy(true); setError('');
    try { await onOrderUpdated?.(await work()); } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section style={{marginTop:12,padding:12,border:'1px solid #0891b2',borderRadius:8}}>
    <strong>Partner API order</strong>
    <p>{artwork?.ready ? 'Client artwork is ready for preview, download, and BatcherPRO.' : artwork?.error || `Artwork: ${ready}/${files.length} files ready. Production status: ${artwork?.status || 'loading'}.`}</p>
    {failures.length>0 && <p role="alert">Artwork needs attention: {failures.join(', ')}. Correct the client files before printing.</p>}
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={()=>perform(()=>fetchOrderById(order.id))}>{busy?'Working…':'Refresh / prepare artwork'}</button>
    {artwork?.status==='paid' && <button style={{marginLeft:8}} disabled={busy || !artwork.ready} onClick={()=>perform(()=>updateOrderStatus(order.id,'processing'))}>Start production</button>}
    {artwork?.status==='in_production' && <form style={{display:'grid',gap:8,marginTop:12}} onSubmit={e=>{
      e.preventDefault(); perform(()=>updateOrderStatus(order.id,'shipped',{carrier,tracking_number:tracking,tracking_url:trackingUrl}));
    }}>
      <input required aria-label="Carrier" placeholder="Carrier" value={carrier} onChange={e=>setCarrier(e.target.value)}/>
      <input required aria-label="Tracking number" placeholder="Tracking number" value={tracking} onChange={e=>setTracking(e.target.value)}/>
      <input required type="url" aria-label="Tracking URL" placeholder="https://carrier.example/tracking/..." value={trackingUrl} onChange={e=>setTrackingUrl(e.target.value)}/>
      <button disabled={busy}>Mark shipped</button>
    </form>}
  </section>;
}
