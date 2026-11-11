import { useState } from 'react';
import { getAdminAuthHeaders } from '../services/supabaseClient';
import FinancialSummary from './FinancialSummary';
const money=(amount,currency)=>{
  if(!Number.isSafeInteger(amount))return 'Unavailable';
  const format=new Intl.NumberFormat('en-US',{style:'currency',currency});
  return format.format(amount/10**format.resolvedOptions().maximumFractionDigits);
};
export default function BusinessReports(){
  const [kind,setKind]=useState('daily'),[date,setDate]=useState(''),[report,setReport]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(){setBusy(true);setError('');setReport(null);try{
    const params=new URLSearchParams({kind,...(date?{date}:{})});
    const response=await fetch('/api/business-report?'+params,{headers:await getAdminAuthHeaders()});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Report unavailable');setReport(data);
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="detail-section"><h2>Business reports</h2>
    <label>Report <select value={kind} onChange={e=>setKind(e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly growth review</option></select></label>{' '}
    <label>{kind==='daily'?'UTC day':'UTC end date (exclusive)'} <input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>{' '}
    <button disabled={busy} onClick={load}>{busy?'Loading…':'Generate report'}</button>
    {error&&<p role="alert">{error}</p>}
    {report&&<><FinancialSummary financials={report.financials}/><h3>Conversion — {report.conversion.status}</h3><p>{report.conversion.cohort}</p><p>{report.conversion.matured?'Cohort matured':'Cohort still maturing'}</p>
      <dl>{Object.entries(report.conversion.stages).map(([stage,count])=><div key={stage}><dt>{stage.replaceAll('_',' ')}</dt><dd>{count??'Unavailable'}</dd></div>)}</dl>
      <p>Visit to paid: {report.conversion.visit_to_paid===null?'Unverified':(report.conversion.visit_to_paid*100).toFixed(1)+'%'}</p>
      <p>Checkout attempts without session linkage: {report.conversion.unlinked_attempts}</p>
      <h3>Previous period comparison — {report.comparison?.status}</h3>
      <p>{report.comparison?.period.start} to {report.comparison?.period.end}</p>
      <ul>{report.comparison?.currencies.map(c=><li key={c.currency}>{c.currency} previous net cash: {money(c.net_cash_minor,c.currency)}</li>)}</ul>
      {report.comparison?.net_cash_change===null?<p>Changes withheld until both periods reconcile.</p>:<ul>{report.comparison?.net_cash_change.map(c=><li key={c.currency}>Net cash change: {money(c.change_minor,c.currency)} ({c.change_percent===null?'No positive comparison baseline':c.change_percent.toFixed(1)+'%'})</li>)}</ul>}
      <h3>Operations</h3>{['aged_orders','pdf_failures','health_failures','shipping_exceptions','delivery_exceptions','exceptions'].map(key=><details key={key}><summary>{key.replaceAll('_',' ')} ({report.operations[key]?.length??'Unavailable'})</summary>
        {report.operations[key]===null?<p>Source unavailable.</p>:<ul>{report.operations[key]?.map((item,index)=><li key={item.id||item.order_id||index}><strong>{item.issue||item.detail||item.status}</strong>{item.order_id&&<p>Order: {item.order_id}</p>}{item.age_hours!=null&&<p>Age: {item.age_hours} hours</p>}{item.owner&&<p>Owner: {item.owner}</p>}{item.next_action&&<p>Next action: {item.next_action}</p>}</li>)}</ul>}
      </details>)}
      <h3>Weekly growth and campaign outcomes</h3>
      <p>Repeat paid orders: {report.growth.repeat_paid_orders??'Unavailable'} · Affiliate orders: {report.growth.affiliate_orders??'Unavailable'} · Partner orders: {report.growth.partner_orders??'Unavailable'}</p>
      <p>Guest repeat customers cannot be verified without a linked account.</p>
      {report.growth.experiments?.map(idea=><article key={idea.id}><h4>{idea.title} — {idea.status}</h4><p>Owner: {idea.owner} · Measure: {idea.success_measure}</p><p>Outcome: {idea.outcome||'Not recorded'}</p></article>)}
      {report.campaigns===null?<p>Campaign monitoring unavailable.</p>:report.campaigns.map(c=><article key={c.id}><h4>{c.name} — {c.enabled&&!c.paused?'Enabled':'Paused'}</h4><p>Invitations: {c.invitations} · Completed: {c.completed} · PRINTS awarded: {c.prints_awarded}</p><p>Failures/review: {c.failures} · Suppressed invitations: {c.opt_outs} · Repeat orders after feedback: {c.repeat_orders_after_feedback}</p><p>Configured email cost: {c.currency?money(c.email_cost_minor,c.currency):'Not configured'}</p></article>)}
      <p>{report.operations.shipping_readiness}</p>
    </>}
  </section>;
}
