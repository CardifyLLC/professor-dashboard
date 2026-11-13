import { createClient } from '@supabase/supabase-js';
import { secretMatches,reportWindow } from '../server/business-report.mjs';
import { collectBusinessReport } from '../server/report-sources.mjs';
import { deliverReport } from '../server/report-delivery.mjs';
import { monitorOperations } from '../server/operation-alerts.mjs';
import { runScheduledReports } from '../server/report-schedule.mjs';
import { generateGrowthIdeas } from '../server/growth-ideas.mjs';
import { METRIC_VERSION } from '../server/business-metrics.mjs';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  const token=req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if(!secretMatches(token,process.env.REPORTING_JOB_SECRET))return res.status(401).json({error:'Job authentication required'});
  try{
    const db=createClient(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const params=new URL(req.url,'https://internal.invalid').searchParams;
    if(params.get('kind')==='ideas'){
      if(process.env.GROWTH_IDEAS_ENABLED!=='true')return res.status(200).json({status:'disabled'});
      const now=new Date(),end=new Date(now);end.setUTCHours(0,0,0,0);end.setUTCDate(end.getUTCDate()-(end.getUTCDay()+6)%7);
      if(now<new Date(+end+(3*60+35)*60000))return res.status(200).json({status:'not_due'});
      const window={kind:'weekly',start:new Date(+end-7*86400000).toISOString(),end:end.toISOString()};
      const previous=await db.from('growth_generation_runs').select('id,status,attempts,next_attempt_at').eq('generation_key',`${METRIC_VERSION}:${window.start}:${window.end}`).maybeSingle();
      if(previous.error)throw new Error('Proposal schedule state unavailable');
      if(previous.data&&(!['pending','failed'].includes(previous.data.status)||previous.data.attempts>=3||Date.parse(previous.data.next_attempt_at)>+now))return res.status(200).json({id:previous.data.id,status:previous.data.status});
      const report={...await collectBusinessReport({db,env:process.env,...window}),kind:'weekly'};
      return res.status(200).json(await generateGrowthIdeas({db,env:process.env,report}));
    }
    if(params.get('kind')==='scheduled'){
      const result=await runScheduledReports({db,env:process.env});
      return res.status(result.outcomes.some(run=>run.deliveries.some(o=>o.status!=='sent'))?503:200).json(result);
    }
    if(params.get('kind')==='health'){
      const result=await monitorOperations({db,env:process.env});
      return res.status(result.outcomes.some(o=>o.status!=='sent')?503:200).json(result);
    }
    const window=reportWindow(params);
    if(window.kind==='range')return res.status(400).json({error:'Scheduled reports must be daily or weekly'});
    const report={...await collectBusinessReport({db,env:process.env,...window}),kind:window.kind};
    const outcomes=await deliverReport({db,env:process.env,report});
    return res.status(outcomes.every(o=>o.status==='sent')?200:503).json({outcomes});
  }catch{return res.status(503).json({error:'Reporting job incomplete. Inspect source configuration, exception queue and delivery state before retry.'});}
}
