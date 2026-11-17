// Scheduled sweeps use durable keys to catch missed runs without duplicate mail.
import {sendOperationOverflow} from './operation-overflow-webhook.mjs';
const kind=process.argv[2]||'daily';
if(!['daily','weekly','health','scheduled','ideas'].includes(kind))throw new Error('Use daily, weekly, health, scheduled or ideas');
const origin=process.env.DASHBOARD_APP_URL,secret=process.env.REPORTING_JOB_SECRET;
if(!origin||new URL(origin).protocol!=='https:'||!secret||secret.length<32)throw new Error('Reporting origin/job secret missing');
const url=new URL('/api/reporting-job',origin);url.searchParams.set('kind',kind);
if(process.argv[3])url.searchParams.set('date',process.argv[3]);
const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret},redirect:'error',signal:AbortSignal.timeout(290000)});
const result=await response.json().catch(()=>({}));
await sendOperationOverflow({notice:result.webhook,record:async body=>{
  const outcome=new URL('/api/reporting-job?kind=webhook-result',origin);
  const saved=await fetch(outcome,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!saved.ok)throw new Error('Overflow outcome uncertain; inspect notification history');
}});
if(!response.ok)throw new Error(`Reporting job failed (${response.status}); inspect durable delivery state before retry`);
console.log('Reporting job completed:',kind);
