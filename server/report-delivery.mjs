import production from '../config/reporting.production.json' with { type: 'json' };
import { createEnvelopeMailer } from '../supabase/functions/_shared/envelope-mailer.mjs';
export function reportRecipients(env) {
  const url=env.SUPABASE_URL||env.VITE_SUPABASE_URL;
  if(url===`https://${production.supabase_project_id}.supabase.co`)return production.report_recipients;
  const recipients=(env.REPORT_TEST_RECIPIENTS||'').split(',').map(v=>v.trim()).filter(Boolean);
  if(!recipients.length||recipients.some(v=>!/^\S+@\S+\.\S+$/.test(v)||/[\r\n]/.test(v)))throw new Error('Explicit testing report recipients required');
  return [...new Set(recipients)];
}
export function reportText(report) {
  const f=report.financials;
  return [`TCGPlaytest ${report.kind||'business'} report`,`${f.period.start} to ${f.period.end} (exclusive), UTC`,
    `Metric version: ${report.version}; refreshed ${f.fetched_at}; reconciliation ${f.reconciliation.status}`,
    `Stripe and PRINTS reconciliation: ${f.reconciliation.stripe_and_prints?.status||'unverified'} (excludes PayPal). Other balance movements: ${JSON.stringify(f.reconciliation.excluded_movements||[])}`,
    ...f.currencies.map(c=>`${c.currency}: collected ${c.cash_collected_minor} minor units; refunds ${c.refunds_minor}; net ${c.net_cash_minor}`),
    `PRINTS units: ${JSON.stringify(f.prints)}`,`Source warnings: ${f.warnings.join(' | ')}`,
    `Unmatched/reconciliation exceptions: ${JSON.stringify(f.reconciliation.issues)}`,
    `Previous period comparison: ${JSON.stringify(report.comparison)}`,`Conversion: ${JSON.stringify(report.conversion)}`,`Operations: ${JSON.stringify(report.operations)}`,
    `Growth / experiment outcomes: ${JSON.stringify(report.growth)}`,`Feedback campaign monitoring: ${JSON.stringify(report.campaigns)}`,
    `Consequential actions require approval from ${production.approvers.map(account=>account.email).join(' or ')}. This report executes no campaign, refund, discount or shipping commitment.`].join('\n\n');
}
export async function deliverOnce({db,key,recipient,report,subject,text,sendEmail,now=new Date(),messageForReport}) {
  const inserted=await db.from('report_deliveries').upsert({delivery_key:key,recipient,report},{onConflict:'delivery_key',ignoreDuplicates:true});
  if(inserted.error)throw new Error('Delivery reservation failed');
  const existing=await db.from('report_deliveries').select('*').eq('delivery_key',key).single();
  if(existing.error)throw new Error('Delivery reservation unavailable');
  if(!['pending','failed'].includes(existing.data.status))return{status:existing.data.status,id:existing.data.id};
  const attempts=Number(existing.data.send_attempts||0);
  if(attempts>=3)return{status:'retry_limit',id:existing.data.id};
  if(existing.data.next_attempt_at&&Date.parse(existing.data.next_attempt_at)>now.getTime())return{status:'retry_deferred',id:existing.data.id};
  const claimed=await db.from('report_deliveries').update({status:'sending',send_attempts:attempts+1,updated_at:now.toISOString()}).eq('id',existing.data.id).eq('status',existing.data.status).eq('send_attempts',attempts).select().maybeSingle();
  if(claimed.error)throw new Error('Delivery claim failed');
  if(!claimed.data)return{status:'claimed_elsewhere'};
  let status='sent',reference=null;
  try{reference=await sendEmail({to:recipient,...(messageForReport?messageForReport(existing.data.report):{subject,text})},'report-'+claimed.data.id);}catch(error){status=error.definitelyRejected===true?'failed':'uncertain';}
  const saved=await db.from('report_deliveries').update({status,provider_reference:reference,next_attempt_at:status==='failed'?new Date(now.getTime()+15*60000).toISOString():null,updated_at:now.toISOString()}).eq('id',claimed.data.id).eq('status','sending').select('id').maybeSingle();
  if(saved.error||!saved.data)throw new Error('Delivery outcome uncertain; inspect mail provider before retry');
  return{status,id:claimed.data.id};
}
export async function deliverReport({db,env,report,prepareMailer=()=>createEnvelopeMailer({env:name=>env[name]}).prepare(),now=new Date()}) {
  if(env.REPORT_DELIVERY_ENABLED!=='true')throw new Error('Report delivery disabled; configure the existing scheduler before enabling');
  const recipients=reportRecipients(env);
  let mailer;
  const sendEmail=async(...args)=>{
    try{mailer ||= await prepareMailer();}catch(error){error.definitelyRejected=true;throw error;}
    return mailer.send(...args);
  };
  const outcomes=[];
  const testing=(env.SUPABASE_URL||env.VITE_SUPABASE_URL)!==`https://${production.supabase_project_id}.supabase.co`;
  for(const recipient of recipients)outcomes.push(await deliverOnce({db,key:reportDeliveryKey(report,recipient),recipient,report,now,messageForReport:stored=>({subject:`${testing?'[TEST] ':''}TCGPlaytest ${stored.kind} report — ${stored.financials.period.start.slice(0,10)}`,text:(testing?'TESTING ENVIRONMENT — this is not a production business report.\n\n':'')+reportText(stored)}),sendEmail}));
  return outcomes;
}
export function reportDeliveryKey(report,recipient){return`${report.kind}:${report.financials.period.start}:${report.financials.period.end}:${recipient}`;}
