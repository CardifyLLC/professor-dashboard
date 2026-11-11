import { useState } from 'react';
import { getAdminAuthHeaders } from '../services/supabaseClient';

export default function FeedbackEligibility({campaignId}){
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('');
  async function load(){setBusy(true);setError('');setData(null);try{
    const response=await fetch('/api/growth-operations?view=feedback-eligibility&campaign_id='+encodeURIComponent(campaignId),{headers:await getAdminAuthHeaders()});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Eligibility unavailable');setData(result);
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  const rows=data?.rows.filter(row=>(`${row.email||''} ${row.order_id}`).toLowerCase().includes(search.toLowerCase()))||[];
  return <details><summary>Invitation eligibility — emails and orders</summary>
    <p>See which orders qualify before sending an invitation. This check sends no emails.</p>
    <button type="button" disabled={busy} onClick={load}>{busy?'Checking…':'Check / refresh eligibility'}</button>
    {error&&<p role="alert">{error}</p>}
    {data&&<><p>Checked {new Date(data.checked_at).toLocaleString()} · {data.rows.filter(r=>r.eligible).length} orders pass recipient checks.</p>
      {data.blockers.length>0&&<p role="status">Sending blocked: {data.blockers.join('; ')}.</p>}
      <label>Find email or order<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Email address or order ID"/></label>
      <div style={{overflowX:'auto',marginTop:16}}><table style={{width:'100%',textAlign:'left',borderCollapse:'collapse'}}><thead><tr>{['Email / account','Order','Eligibility','Reasons'].map(label=><th key={label} style={{padding:12}}>{label}</th>)}</tr></thead><tbody>
        {rows.slice(0,100).map(row=><tr key={row.order_id}><td style={{padding:12}}>{row.email||'No linked email'}<br/>{row.account_linked?'Account linked':'Account not linked'}</td><td style={{padding:12}}>{row.order_id}<br/>{row.payment_status} · {row.order_status}</td><td style={{padding:12}}>{row.eligible?'Recipient eligible':'Not eligible'}</td><td style={{padding:12}}>{row.reasons.join('; ')||'Recipient checks passed; campaign sending gates still apply.'}</td></tr>)}
      </tbody></table></div>{!rows.length&&<p>No matching orders.</p>}<p>Showing {Math.min(rows.length,100)} of {rows.length} matching orders. {data.note}</p></>}
  </details>;
}
