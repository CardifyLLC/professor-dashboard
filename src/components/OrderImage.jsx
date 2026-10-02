import { useEffect, useState } from 'react';
import { isPartnerImage } from '../services/partnerArtwork.mjs';
import { resolveOrderImage } from '../services/partnerOrders';

export default function OrderImage({src,alt,...props}) {
  const partner=isPartnerImage(src);
  const [resolved,setResolved]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    if(!partner)return;
    let active=true;
    setResolved(null); setError('');
    resolveOrderImage(src).then(url=>{if(active)setResolved(url);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[src,partner]);
  if(!partner)return <img {...props} src={src} alt={alt}/>;
  if(error)return <span role="status" title={error}>Artwork unavailable</span>;
  if(!resolved)return <span role="status">Loading artwork…</span>;
  return <img {...props} loading="eager" src={resolved} alt={alt}/>;
}
