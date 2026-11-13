import ReportDeliveryStatus from './ReportDeliveryStatus';
import { useCallback, useEffect, useState } from 'react';
import { getAdminAuthHeaders } from '../services/supabaseClient';
import BusinessReports from './BusinessReports';
import './GrowthOperations.css';
const fields=['title','segment','trigger_description','suggested_action','evidence','expected_benefit','cost','risks','owner','success_measure'];
async function request(body,view=''){
  const response=await fetch('/api/growth-operations'+view,{method:body?'POST':'GET',headers:{...await getAdminAuthHeaders(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Request failed.');return payload;
}
export default function GrowthOperations(){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [deliveryStatus,setDeliveryStatus]=useState(null),[deliveryError,setDeliveryError]=useState('');
  const [draft,setDraft]=useState({}),[exception,setException]=useState({}),[notes,setNotes]=useState({});
  const refresh=useCallback(async()=>{
    const [operations,delivery]=await Promise.allSettled([request(),request(null,'?view=report-deliveries')]);
    if(operations.status==='fulfilled'){setData(operations.value);setError('');}else setError(operations.reason.message);
    if(delivery.status==='fulfilled'){setDeliveryStatus(delivery.value);setDeliveryError('');}else{setDeliveryStatus(null);setDeliveryError(delivery.reason.message);}
  },[]);
  useEffect(()=>{refresh();},[refresh]);
  async function act(body){setBusy(true);setError('');try{await request(body);await refresh();}catch(err){setError(err.message);}finally{setBusy(false);}}
  return <section className="growth-operations"><h1>Growth and operations</h1>
    <BusinessReports/>
    {deliveryError&&<p role="alert">Report delivery status unavailable: {deliveryError}</p>}
    {deliveryStatus&&<ReportDeliveryStatus items={deliveryStatus.deliveries} runs={deliveryStatus.runs} canApprove={deliveryStatus.canApprove} busy={busy} onReview={act}/>}
    <p>Ideas require a decision from an authorized approver. This queue records decisions; it does not send messages, change prices or spend money.</p>
    {error&&<p role="alert">{error}</p>}<button onClick={refresh} disabled={busy}>Refresh</button>
    {!data&&!error&&<p role="status">Loading…</p>}
    <h2>Propose an idea</h2><form onSubmit={event=>{event.preventDefault();act({action:'create_idea',...draft});}}>
      {fields.map(field=><label key={field} style={{display:'block',margin:'8px 0'}}>{field.replaceAll('_',' ')}<textarea required maxLength={field==='title'?200:4000} value={draft[field]||''} onChange={e=>setDraft({...draft,[field]:e.target.value})} style={{display:'block',width:'100%'}}/></label>)}
      <button disabled={busy}>Save proposal</button></form>
    <h2>Idea queue</h2>{data?.ideas.map(idea=><article key={idea.id} className="detail-section"><h3>{idea.title} — {idea.status}</h3>
      {fields.filter(field=>field!=='title').map(field=><p key={field}><strong>{field.replaceAll('_',' ')}:</strong> {idea[field]}</p>)}
      {idea.outcome&&<p>Outcome: {idea.outcome}</p>}
      {data.canApprove&&idea.status==='pending'&&<><button disabled={busy} onClick={()=>act({action:'decide_idea',id:idea.id,version:idea.version,status:'approved'})}>Approve</button><button disabled={busy} onClick={()=>act({action:'decide_idea',id:idea.id,version:idea.version,status:'rejected'})}>Reject</button></>}
      {data.canApprove&&idea.status==='approved'&&<><label>Outcome<textarea value={notes[idea.id]||''} onChange={e=>setNotes({...notes,[idea.id]:e.target.value})}/></label><button disabled={busy||!notes[idea.id]?.trim()} onClick={()=>act({action:'decide_idea',id:idea.id,version:idea.version,status:'completed',outcome:notes[idea.id]})}>Record completion</button></>}
    </article>)}
    <h2>Order exceptions</h2><form onSubmit={event=>{event.preventDefault();act({action:'create_exception',...exception});}}>
      {['order_id','issue','owner','next_action'].map(field=><label key={field} style={{display:'block'}}>{field.replaceAll('_',' ')}<input required={field!=='order_id'} maxLength={2000} value={exception[field]||''} onChange={e=>setException({...exception,[field]:e.target.value})}/></label>)}<button disabled={busy}>Add exception</button></form>
    {data?.exceptions.map(item=><article key={item.id}><h3>{item.issue} — {item.status}</h3><p>Order: {item.order_id||'General'} · Owner: {item.owner} · Opened: {item.created_at}</p><p>Next action: {item.next_action}</p>{item.status!=='resolved'&&<><label>Resolution<input value={notes[item.id]||''} onChange={e=>setNotes({...notes,[item.id]:e.target.value})}/></label><button disabled={busy||!notes[item.id]?.trim()} onClick={()=>act({action:'resolve_exception',id:item.id,version:item.version,resolution:notes[item.id]})}>Resolve</button></>}</article>)}
    <h2>Feedback for 5 PRINTS</h2><p>The campaign is available in testing only. Production invitation sending and activation are disabled.</p>
    {data?.campaigns.filter(campaign=>campaign.enabled&&!campaign.paused).map(campaign=><article key={campaign.id}><p>{campaign.name} needs pausing.</p><button disabled={busy} onClick={()=>act({action:'pause_campaign',id:campaign.id})}>Pause campaign</button></article>)}
    <p>Showing up to 100 most recent entries per list.</p>
  </section>;
}
