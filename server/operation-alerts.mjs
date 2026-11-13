import { readAll } from './report-sources.mjs';
import { reportRecipients,deliverOnce } from './report-delivery.mjs';
import { createEnvelopeMailer } from '../supabase/functions/_shared/envelope-mailer.mjs';
import { createHash } from 'node:crypto';
export async function monitorOperations({db,env,fetchImpl=fetch,now=new Date(),prepareMailer=()=>createEnvelopeMailer({env:name=>env[name]}).prepare()}) {
  const findings=[];
  const owner=env.OPERATIONS_OWNER||'superiorvideo@gmail.com';
  for(const [name,origin] of [['dashboard',env.DASHBOARD_APP_URL],['storefront',env.CUSTOMER_APP_URL]]){
    let status='ok';
    try{if(!origin||new URL(origin).protocol!=='https:')throw new Error('Missing HTTPS origin');const response=await fetchImpl(new URL('/api/reporting-health',origin),{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||(await response.json()).ok!==true)throw new Error('Health failed');}catch{status='failed';}
    const saved=await db.from('operation_health').upsert({id:name,status,checked_at:now.toISOString(),max_age_minutes:45,owner,detail:status==='ok'?'Application health route responded':'Health endpoint unavailable or misconfigured'});
    if(saved.error)throw new Error('Health persistence failed');
  }
  const source=async(name,load)=>{try{return await load();}catch{findings.push({key:'source:'+name,issue:`Monitoring source unavailable: ${name}`,next:'Check database migrations, permissions and source availability'});return[];}};
  const [jobs,orders,health,shipments,deliveries,refunds,feedback,generation]=await Promise.all([
    source('pdf',()=>readAll(db,'order_pdf_generations','order_id,status',q=>q,'order_id')),
    source('orders',()=>readAll(db,'reporting_order_facts','id,status,created_at,archived_at')),source('health',()=>readAll(db,'operation_health')),
    source('shipping',()=>readAll(db,'shipment_tracking_notifications','id,order_id,status,created_at')),
    source('delivery',()=>readAll(db,'report_deliveries','id,delivery_key,status,created_at,updated_at')),
    source('refunds',()=>readAll(db,'refund_operations','id,order_id,status,notification_status,updated_at')),
    source('feedback',()=>readAll(db,'feedback_invitations','id,order_id,status,updated_at,send_attempts')),
    env.GROWTH_IDEAS_ENABLED==='true'?source('generation',()=>readAll(db,'growth_generation_runs')):Promise.resolve([]),
  ]);
  for(const job of jobs.filter(j=>j.status==='failed'))findings.push({key:'pdf:'+job.order_id,order_id:job.order_id,issue:'Order PDF generation failed',next:'Inspect worker logs and retry the PDF after correction'});
  const threshold=Number(env.REPORT_AGED_ORDER_HOURS)||72;
  for(const order of orders.filter(o=>!o.archived_at&&['paid','processing','printing'].includes(o.status)&&now-Date.parse(o.created_at)>threshold*3600000))findings.push({key:'aged:'+order.id,order_id:order.id,issue:`Order older than ${threshold} hours`,next:'Check backlog, production capacity and customer update'});
  for(const h of health.filter(h=>h.status!=='ok'||now-Date.parse(h.checked_at)>h.max_age_minutes*60000))findings.push({key:'health:'+h.id,issue:`Health failure or stale heartbeat: ${h.id}`,next:'Inspect service and workflow logs; verify recovery'});
  for(const s of shipments.filter(s=>['failed','unknown'].includes(s.status)||(s.status==='sending'&&now-Date.parse(s.created_at)>30*60000)))findings.push({key:'shipping:'+s.id,order_id:s.order_id,issue:'Shipping notification needs review',next:'Check Gmail acceptance before retrying the customer notification'});
  // Alert delivery failures use the independent GitHub webhook fallback. Never recursively email an alert about a failed alert.
  for(const d of deliveries.filter(d=>!d.delivery_key.startsWith('alert:')&&(['failed','uncertain'].includes(d.status)||(d.status==='sending'&&now-Date.parse(d.updated_at||d.created_at)>30*60000))))findings.push({key:'delivery:'+d.id,issue:'Report delivery needs review',next:'Check mail provider and durable delivery state before resending'});
  if(env.FEEDBACK_AUTOMATION_ENABLED==='true'&&!health.some(h=>h.id==='feedback-scheduler'))findings.push({key:'health:feedback-scheduler',issue:'Testing feedback scheduler heartbeat missing',next:'Check the testing scheduler workflow, allowlist and Edge secrets'});
  if(!health.some(h=>h.id==='pdf-worker'))findings.push({key:'health:pdf-worker',issue:'PDF worker heartbeat missing',next:'Configure and run the PDF workflow heartbeat step'});
  if(env.REPORT_DELIVERY_ENABLED==='true'&&!health.some(h=>h.id==='report-scheduler'))findings.push({key:'health:report-scheduler',issue:'Report scheduler heartbeat missing',next:'Check the reporting workflow, job secret and reporting start date'});
  for(const r of refunds.filter(r=>r.status==='needs_reconciliation'||r.notification_status==='uncertain'||(['submitted','pending'].includes(r.status)&&now-Date.parse(r.updated_at)>30*60000)))findings.push({key:'refund:'+r.id,order_id:r.order_id,issue:'Refund operation needs reconciliation',next:'Check provider reference and recorded outcome; never create a new refund as a retry'});
  for(const i of feedback.filter(i=>['failed','uncertain'].includes(i.status)||(['pending','sending'].includes(i.status)&&now-Date.parse(i.updated_at)>30*60000)))findings.push({key:'feedback:'+i.id,order_id:i.order_id,issue:'Feedback invitation needs review: '+i.status,next:'Check campaign caps, signing secrets, and provider receipt; do not retry uncertain sends until reconciled'});
  for(const run of generation.filter(r=>r.status==='failed'||(r.status==='running'&&now-Date.parse(r.updated_at)>30*60000)))findings.push({key:'generation:'+run.id,issue:'Growth proposal generation needs review',next:'Inspect provider configuration and saved generation state; proposals never execute actions'});
  const outcomes=[],items=[];
  const recipients=reportRecipients(env);
  for(const finding of findings){
    const saved=await db.rpc('open_operation_exception',{p_key:finding.key,p_order:finding.order_id||null,p_issue:finding.issue,p_owner:owner,p_next:finding.next});
    if(saved.error)throw new Error('Exception queue unavailable');
    const item=saved.data;
    items.push(item);
    if(env.OPERATION_ALERTS_ENABLED!=='true'){outcomes.push({id:item.id,status:'queued_delivery_disabled'});continue;}
  }
  // One digest per changed incident set, never hundreds of messages when a
  // monitor is first enabled. Unchanged failures reuse their delivery keys.
  if(env.OPERATION_ALERTS_ENABLED==='true'&&items.length){
    const fingerprint=createHash('sha256').update(items.map(i=>`${i.id}:${i.version}`).sort().join('|')).digest('hex');
    let mailer;
    const sendEmail=async(...args)=>{try{mailer ||= await prepareMailer();}catch(error){error.definitelyRejected=true;throw error;}return mailer.send(...args);};
    const text=items.map(item=>`${item.issue}\nOrder: ${item.order_id||'N/A'}\nOwner: ${item.owner||owner}\nNext: ${item.next_action}`).join('\n\n');
    for(const recipient of recipients)outcomes.push(await deliverOnce({db,key:`alert:digest:${fingerprint}:${recipient}`,recipient,report:{exceptions:items},subject:`TCGPlaytest operations — ${items.length} items need review`,text,sendEmail,now}));
  }
  const heartbeat=await db.from('operation_health').upsert({id:'operations-monitor',status:'ok',checked_at:now.toISOString(),max_age_minutes:45,owner,detail:'Operations scan completed'});
  if(heartbeat.error)throw new Error('Monitor heartbeat failed');
  return{findings:findings.length,outcomes};
}
