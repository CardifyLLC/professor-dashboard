import { timingSafeEqual } from 'node:crypto';
import { collectBusinessReport } from './report-sources.mjs';
export function secretMatches(value, expected) {return typeof expected==='string'&&expected.length>=32&&typeof value==='string'&&Buffer.byteLength(value)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(value),Buffer.from(expected));}
export function reportWindow(params, now=new Date()) {
  const kind=params.get('kind')||'daily';
  if(!['daily','weekly','range'].includes(kind))throw new Error('Invalid report kind');
  const date=params.get('date');
  if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new Error('Invalid UTC date');
  let end=new Date(now);end.setUTCHours(0,0,0,0);
  if(date)end=new Date(Date.parse(date)+(kind==='daily'?86400000:0));
  let days=kind==='weekly'?7:1;
  if(kind==='range'){days=Number(params.get('days')||7);end=new Date(Math.floor(now.getTime()/1000)*1000);if(![7,14,30].includes(days))throw new Error('Choose 7, 14 or 30 days for financial reports');}
  if(end.getTime()>now.getTime())throw new Error('Future report window');
  return{kind,start:new Date(end.getTime()-days*86400000).toISOString(),end:end.toISOString()};
}
export function aiReportInput(report) {
  const f=report.financials;
  return {version:report.version,financials:{...f,reconciliation:{status:f.reconciliation.status,stripe_and_prints:f.reconciliation.stripe_and_prints,exception_count:f.reconciliation.issues.length}},comparison:report.comparison,conversion:report.conversion,
    operations:{aged_orders:report.operations.aged_orders?.length??null,pdf_failures:report.operations.pdf_failures?.length??null,health_failures:report.operations.health_failures?.length??null,open_exceptions:report.operations.exceptions?.length??null},
    growth:{repeat_paid_orders:report.growth.repeat_paid_orders,affiliate_orders:report.growth.affiliate_orders,partner_orders:report.growth.partner_orders},
    constraints:['No automatic messages, discounts, spending, prices or delivery promises. Authorized approver decision required.','Only use matched financials and verified conversion for recommendations involving money or growth.']};
}
export function createBusinessReportHandler({createClient,env=process.env,collect=collectBusinessReport}) {return async(req,res)=>{
  const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');res.end(JSON.stringify(data));};
  try{
    if(req.method!=='GET')return send(405,{error:'Method not allowed'});
    const url=env.SUPABASE_URL||env.VITE_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url||!key)return send(503,{error:'Reporting configuration missing'});
    const token=req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if(!token||token===key)return send(401,{error:'Authentication required'});
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    if(!secretMatches(token,env.REPORTING_JOB_SECRET)){
      const auth=await db.auth.getUser(token);
      if(auth.error||!auth.data?.user)return send(401,{error:'Session expired'});
      const admin=await db.from('dashboard_admins').select('user_id').eq('user_id',auth.data.user.id).eq('enabled',true).maybeSingle();
      if(admin.error||!admin.data)return send(403,{error:'Administrator access required'});
    }
    const params=new URL(req.url,'https://internal.invalid').searchParams;
    let window;try{window=reportWindow(params);}catch(error){return send(400,{error:error.message});}
    const report=await collect({db,env,...window});
    return send(200,params.get('view')==='ai'?aiReportInput(report):{...report,kind:window.kind});
  }catch{return send(503,{error:'Report unavailable; inspect source configuration and job logs'});}
};}
