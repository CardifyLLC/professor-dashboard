import { useEffect, useState } from 'react';
import { isPartnerImage } from '../services/partnerArtwork.mjs';
import { resolveOrderImage } from '../services/partnerOrders';
import { isTeamArtwork, resolveTeamArtwork } from '../services/teamBatcher';

export default function OrderImage({src,alt,...props}) {
  const partner=isPartnerImage(src) || isTeamArtwork(src);
  const [result,setResult]=useState(null);
  useEffect(()=>{
    if(!partner)return;
    let active=true;
    (isTeamArtwork(src) ? resolveTeamArtwork(src) : resolveOrderImage(src)).then(url=>{if(active)setResult({src,url});}).catch(e=>{if(active)setResult({src,error:e.message});});
    return ()=>{active=false;};
  },[src,partner]);
  if(!partner)return <img {...props} src={src} alt={alt}/>;
  const resolved=result?.src===src ? result.url : null, error=result?.src===src ? result.error : '';
  if(error)return <span role="status" title={error}>Artwork unavailable</span>;
  if(!resolved)return <span role="status">Loading artwork…</span>;
  return <img {...props} loading="eager" src={resolved} alt={alt}/>;
}
