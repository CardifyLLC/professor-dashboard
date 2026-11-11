import { useState } from 'react';
import { getAdminAuthHeaders } from '../services/supabaseClient';

export default function FeedbackEligibility({campaignId}){
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('');
  const [selected,setSelected]=useState(null),[message,setMessage]=useState('');
  async function sendInvitation(){
    setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/growth-operations',{method:'POST',headers:{...await getAdminAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({action:'send_feedback_invitation',id:campaignId,order_id:selected.order_id,expected_email:selected.email})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Sending failed. Refresh status before retrying.');
      setMessage(result.sent?(result.transport==='supabase-edge'?'Invitation accepted through Supabase Edge. Ask the recipient to check their inbox and spam folder.':'Invitation accepted by the email provider. Ask the recipient to check their inbox and spam folder.'):`No new invitation sent. Status: ${result.status||result.reason}. Review the existing invitation before retrying.`);
    }catch(e){setError(e.message);}finally{setSelected(null);await load();setBusy(false);}
  }
  async function load(){setBusy(true);setData(null);try{
    const response=await fetch('/api/growth-operations?view=feedback-eligibility&campaign_id='+encodeURIComponent(campaignId),{headers:await getAdminAuthHeaders()});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Eligibility unavailable');setData(result);
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  const rows=data?.rows.filter(row=>(`${row.email||''} ${row.order_id}`).toLowerCase().includes(search.toLowerCase()))||[];
  return <details><summary>Invitation eligibility — emails and orders</summary>
    <p>See which orders qualify before sending an invitation. This check sends no emails.</p>
    <button type="button" disabled={busy} onClick={load}>{busy?'Checking…':'Check / refresh eligibility'}</button>
    {error&&<p role="alert">{error}</p>}
    {message&&<p role="status">{message}</p>}
    {selected&&<section aria-label="Confirm invitation"><h3>Confirm one invitation</h3><p>Send to <strong>{selected.email}</strong> for order {selected.order_id}? Completing feedback awards 5 testing PRINTS.</p>{selected.retry_pending&&<p>This retries the existing invitation. The reward can still be claimed only once.</p>}<button disabled={busy} onClick={sendInvitation}>Confirm and send</button><button disabled={busy} onClick={()=>setSelected(null)}>Cancel</button></section>}
    {data&&<><p>Checked {new Date(data.checked_at).toLocaleString()} · {data.rows.filter(r=>r.eligible).length} orders pass recipient checks.</p>
      {data.blockers.length>0&&<p role="status">Sending blocked: {data.blockers.join('; ')}.</p>}
      <label>Find email or order<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Email address or order ID"/></label>
      <div style={{overflowX:'auto',marginTop:16}}><table style={{width:'100%',textAlign:'left',borderCollapse:'collapse'}}><thead><tr>{['Email / account','Order','Eligibility','Reasons','Invitation'].map(label=><th key={label} style={{padding:12}}>{label}</th>)}</tr></thead><tbody>
        {rows.slice(0,100).map(row=><tr key={row.order_id}><td style={{padding:12}}>{row.email||'No linked email'}<br/>{row.account_linked?'Account linked':'Account not linked'}</td><td style={{padding:12}}>{row.order_id}<br/>{row.payment_status} · {row.order_status}</td><td style={{padding:12}}>{row.eligible?'Recipient eligible':'Not eligible'}</td><td style={{padding:12}}>{row.reasons.join('; ')||'Recipient checks passed; campaign sending gates still apply.'}</td><td style={{padding:12}}>{row.invitation_status||'Not invited'}{data.canSend&&<button disabled={busy||Boolean(selected)||!row.eligible||data.blockers.length>0} onClick={()=>{setError('');setSelected(row);}}>{row.retry_pending?'Retry invitation':'Send invitation'}</button>}</td></tr>)}
      </tbody></table></div>{!rows.length&&<p>No matching orders.</p>}<p>Showing {Math.min(rows.length,100)} of {rows.length} matching orders. {data.note}</p></>}
  </details>;
}
