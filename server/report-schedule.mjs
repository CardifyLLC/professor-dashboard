import {reportRecipients,reportDeliveryKey,deliverReport} from './report-delivery.mjs';
import {collectBusinessReport} from './report-sources.mjs';

// UTC: daily at 03:20, weekly at 03:35 Monday (Monday-to-Monday).
// The recurring sweep catches a missed run for up to seven days. The configured
// start date prevents deployment from emailing an unexpected historical backlog.
export function scheduledWindows(now,startDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate||'')||new Date(startDate).toISOString().slice(0,10)!==startDate)throw new Error('Set REPORTING_START_DATE to the first UTC delivery date');
  const day=86400000,midnight=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),windows=[];
  for(let days=6;days>=0;days--){
    const end=midnight-days*day;
    if(end<Date.parse(startDate))continue;
    if(now.getTime()>=end+(3*60+20)*60000)windows.push({kind:'daily',start:new Date(end-day).toISOString(),end:new Date(end).toISOString()});
    if(new Date(end).getUTCDay()===1&&now.getTime()>=end+(3*60+35)*60000)windows.push({kind:'weekly',start:new Date(end-7*day).toISOString(),end:new Date(end).toISOString()});
  }
  return windows;
}
export async function runScheduledReports({db,env,now=new Date(),collect=collectBusinessReport,deliver=deliverReport}){
  try{
  const windows=scheduledWindows(now,env.REPORTING_START_DATE),recipients=reportRecipients(env),outcomes=[];
  let generated=0;
  for(const window of windows){
    const keys=recipients.map(recipient=>reportDeliveryKey({kind:window.kind,financials:{period:window}},recipient));
    const previous=await db.from('report_deliveries').select('*').in('delivery_key',keys);
    if(previous.error)throw new Error('Scheduled delivery state unavailable');
    const due=keys.some(key=>{
      const row=previous.data.find(d=>d.delivery_key===key);
      return !row||(['pending','failed'].includes(row.status)&&Number(row.send_attempts||0)<3&&(!row.next_attempt_at||Date.parse(row.next_attempt_at)<=now.getTime()));
    });
    if(!due)continue;
    // Bound a single invocation; the next sweep continues the durable backlog.
    if(generated>=2)break;
    const report=previous.data[0]?.report||{...await collect({db,env,...window,now}),kind:window.kind};
    outcomes.push({kind:window.kind,end:window.end,deliveries:await deliver({db,env,report,now})});generated++;
  }
  const failed=outcomes.some(run=>run.deliveries.some(delivery=>delivery.status!=='sent'));
  const saved=await db.from('operation_health').upsert({id:'report-scheduler',status:failed?'failed':'ok',checked_at:now.toISOString(),max_age_minutes:45,owner:env.OPERATIONS_OWNER||'superiorvideo@gmail.com',detail:failed?'Report delivery needs review':'Scheduled report sweep completed'});
  if(saved.error)throw new Error('Report scheduler heartbeat unavailable');
  return{timezone:'UTC',outcomes};
  }catch(error){
    try{await db.from('operation_health').upsert({id:'report-scheduler',status:'failed',checked_at:now.toISOString(),max_age_minutes:45,owner:env.OPERATIONS_OWNER||'superiorvideo@gmail.com',detail:'Scheduled report sweep failed; inspect workflow and durable delivery records'});}catch{ /* Independent workflow fallback handles database failure. */ }
    throw error;
  }
}
