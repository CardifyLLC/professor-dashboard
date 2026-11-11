import { feedbackEligibility } from './feedback-eligibility.mjs';
import { sendTargetedFeedback } from './feedback-targeted.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
import { validateCampaign } from '../shared/feedback-campaign.mjs';
import { runFeedbackBatch } from './feedback-delivery.mjs';
import { reportingApprover, reportingCanReject } from './reporting-authority.mjs';
export const IDEA_FIELDS=['title','segment','trigger_description','suggested_action','evidence','expected_benefit','cost','risks','owner','success_measure'];
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const checked=result=>{if(result.error)throw new HttpError(503,'Operations storage unavailable. Verify the database rollout.');return result.data;};
export function validateIdea(body){return Object.fromEntries(IDEA_FIELDS.map(field=>{if(typeof body[field]!=='string'||!body[field].trim()||body[field].length>(field==='title'?200:4000))throw new HttpError(400,`Provide ${field}.`);return[field,body[field].trim()];}));}
export function decisionChange(body,user,approver,canReject=false){
  if((!approver||user!==approver)&&!(body.status==='rejected'&&canReject))throw new HttpError(403,'Only authorized accounts may decide proposals.');
  if(!UUID.test(body.id||'')||!Number.isInteger(body.version)||body.version<1||!['approved','rejected','completed'].includes(body.status))throw new HttpError(400,'Invalid decision.');
  if(body.status==='completed'&&(typeof body.outcome!=='string'||!body.outcome.trim()))throw new HttpError(400,'Record the outcome first.');
  if(body.outcome!=null&&(typeof body.outcome!=='string'||body.outcome.length>4000))throw new HttpError(400,'Invalid outcome.');
  return{status:body.status,decided_by:user,decided_at:new Date().toISOString(),outcome:body.outcome?.trim()||null,version:body.version+1};
}
export function createGrowthOperationsHandler({createClient,env=process.env}){return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json');
  const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  try{
    if(!['GET','POST'].includes(req.method))throw new HttpError(405,'Method not allowed.');
    const token=req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if(!token||token===env.SUPABASE_SERVICE_ROLE_KEY)throw new HttpError(401,'Administrator sign-in required.');
    if(!env.VITE_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new HttpError(503,'Operations service is not configured.');
    const db=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const auth=await db.auth.getUser(token);if(auth.error||!auth.data?.user?.id)throw new HttpError(401,'Session expired.');
    const user=auth.data.user;
    const approver=reportingApprover(env,user);
    const canReject=user.id===approver||reportingCanReject(env,user);
    if(!checked(await db.from('dashboard_admins').select('user_id').eq('user_id',user.id).eq('enabled',true).maybeSingle()))throw new HttpError(403,'Administrator access required.');
    if(req.method==='GET'){
      const params=new URL(req.url||'/', 'https://internal.invalid').searchParams;
      if(params.get('view')==='feedback-eligibility'){
        const id=params.get('campaign_id');
        if(!UUID.test(id||''))throw new HttpError(400,'Invalid campaign.');
        return send(200,{...await feedbackEligibility(db,id,env),canSend:user.id===approver});
      }
      const rows=await Promise.all(['growth_ideas','operation_exceptions','feedback_campaigns'].map(table=>db.from(table).select('*').order('created_at',{ascending:false}).limit(100)));
      return send(200,{ideas:checked(rows[0]),exceptions:checked(rows[1]),campaigns:checked(rows[2]),canApprove:user.id===approver,canReject});
    }
    if(Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(req.body)||'')>30000)throw new HttpError(413,'Request too large.');
    let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{throw new HttpError(400,'Invalid JSON.');}
    if(!body||typeof body!=='object')throw new HttpError(400,'Invalid request.');
    if(body.action==='send_feedback_invitation'){
      if(!approver||user.id!==approver)throw new HttpError(403,'Professor approval required.');
      if(!UUID.test(body.id||'')||!UUID.test(body.order_id||'')||typeof body.expected_email!=='string'||body.expected_email.length>254)throw new HttpError(400,'Invalid invitation recipient.');
      try{return send(200,await sendTargetedFeedback({db,env,campaignId:body.id,orderId:body.order_id,expectedEmail:body.expected_email}));}
      catch(error){throw new HttpError(409,error.message);}
    }
    if(body.action==='create_idea')return send(201,{idea:checked(await db.from('growth_ideas').insert({...validateIdea(body),created_by:user.id}).select().single())});
    if(body.action==='decide_idea'){
      const change=decisionChange(body,user.id,approver,canReject);
      const row=checked(await db.from('growth_ideas').update(change).eq('id',body.id).eq('version',body.version).eq('status',body.status==='completed'?'approved':'pending').select().maybeSingle());
      if(!row)throw new HttpError(409,'Proposal changed. Refresh first.');return send(200,{idea:row});
    }
    if(body.action==='create_exception'){
      if(body.order_id&&!UUID.test(body.order_id))throw new HttpError(400,'Invalid order reference.');
      for(const field of ['issue','owner','next_action'])if(typeof body[field]!=='string'||!body[field].trim()||body[field].length>2000)throw new HttpError(400,`Provide ${field}.`);
      return send(201,{exception:checked(await db.from('operation_exceptions').insert({order_id:body.order_id||null,issue:body.issue,owner:body.owner,next_action:body.next_action}).select().single())});
    }
    if(body.action==='resolve_exception'){
      if(!UUID.test(body.id||'')||!Number.isInteger(body.version)||typeof body.resolution!=='string'||!body.resolution.trim()||body.resolution.length>4000)throw new HttpError(400,'Provide a resolution.');
      const row=checked(await db.from('operation_exceptions').update({status:'resolved',resolution:body.resolution,resolved_at:new Date().toISOString(),version:body.version+1}).eq('id',body.id).eq('version',body.version).neq('status','resolved').select().maybeSingle());
      if(!row)throw new HttpError(409,'Exception changed. Refresh first.');return send(200,{exception:row});
    }
    if(body.action==='save_campaign'){
      if(!UUID.test(body.id||'')||!Number.isInteger(body.version))throw new HttpError(400,'Invalid campaign version.');
      let config;try{config=validateCampaign(body.config);}catch(error){throw new HttpError(400,error.message);}
      const row=checked(await db.from('feedback_campaigns').update({...config,version:body.version+1}).eq('id',body.id).eq('version',body.version).select().maybeSingle());
      if(!row)throw new HttpError(409,'Campaign changed. Refresh before saving.');return send(200,{campaign:row});
    }
    if(body.action==='enable_campaign'){
      if(!approver||user.id!==approver)throw new HttpError(403,'Professor approval required.');
      if(env.FEEDBACK_DELIVERY_READY!=='true')throw new HttpError(503,'Delivery verification is not complete. Campaign remains disabled.');
      if(!UUID.test(body.id||'')||!Number.isInteger(body.version))throw new HttpError(400,'Invalid campaign version.');
      const current=checked(await db.from('feedback_campaigns').select('*').eq('id',body.id).single());
      try{validateCampaign(current);}catch(error){throw new HttpError(400,error.message);}
      const row=checked(await db.from('feedback_campaigns').update({enabled:true,paused:false,approved_by:user.id,approved_at:new Date().toISOString(),version:body.version+1}).eq('id',body.id).eq('version',body.version).select().maybeSingle());
      if(!row)throw new HttpError(409,'Campaign changed. Review it again.');return send(200,{campaign:row});
    }
    if(body.action==='run_feedback_batch'){
      if(env.FEEDBACK_DELIVERY_READY!=='true'||user.id!==approver)throw new HttpError(403,'Approved delivery setup required.');
      if(!UUID.test(body.id||'')||(body.after&&!UUID.test(body.after)))throw new HttpError(400,'Invalid campaign or cursor.');
      return send(200,await runFeedbackBatch({db,campaignId:body.id,after:body.after||null,env}));
    }
    if(body.action==='pause_campaign'){
      if(!UUID.test(body.id||''))throw new HttpError(400,'Invalid campaign.');
      const current=checked(await db.from('feedback_campaigns').select('version').eq('id',body.id).single());
      const row=checked(await db.from('feedback_campaigns').update({paused:true,enabled:false,version:current.version+1}).eq('id',body.id).eq('version',current.version).select().maybeSingle());
      if(!row)throw new HttpError(409,'Campaign changed while pausing. Refresh and pause again.');
      return send(200,{campaign:row});
    }
    throw new HttpError(400,'Unsupported action. Campaign activation awaits configuration and delivery verification.');
  }catch(error){send(error instanceof HttpError?error.status:503,{error:error instanceof HttpError?error.message:'Operations service unavailable.'});}
};}
