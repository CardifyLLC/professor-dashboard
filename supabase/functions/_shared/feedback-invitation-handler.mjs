import {deliveryBlockers} from './feedback-targeted.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Keep these verified production identities aligned with config/reporting.production.json.
// This standalone Edge bundle independently enforces the same approval boundary.
const approvers=new Map([
  ['b80fb162-04d0-47c4-928f-a03da244730e','superiorvideo@gmail.com'],
  ['f926669e-77bf-40cb-a054-3260f07b4dc8','nick@cardify.club'],
]);
export function createFeedbackInvitationHandler({createClient,env}){
  return async request=>{
    const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
    if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
    if(env.SUPABASE_URL!=='https://dunoesykjvdnpeavojsi.supabase.co'||!env.SUPABASE_SERVICE_ROLE_KEY)return reply(503,{error:'Production service configuration missing.'});
    const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if(!token||token===env.SUPABASE_SERVICE_ROLE_KEY)return reply(401,{error:'Sign in as an authorized production approver.'});
    try{
      const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
      const auth=await db.auth.getUser(token);const user=auth.data?.user;
      if(auth.error||!user?.id)return reply(401,{error:'Session expired.'});
      const admin=await db.from('dashboard_admins').select('user_id').eq('user_id',user.id).eq('enabled',true).maybeSingle();
      if(admin.error||!admin.data)return reply(403,{error:'Enabled dashboard admin required.'});
      const raw=await request.text();if(raw.length>2000)return reply(413,{error:'Request too large.'});
      let body;try{body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON.'});}
      if(!body||typeof body!=='object')return reply(400,{error:'Invalid request.'});
      if(body.action==='readiness')return reply(200,{blockers:['Feedback campaign delivery is testing-only. Production remains paused.',...deliveryBlockers(env)]});
      if(!approvers.has(user.id)||approvers.get(user.id)!==user.email?.toLowerCase()||!user.email_confirmed_at||user.is_anonymous)return reply(403,{error:'Only authorized production approvers may send feedback invitations.'});
      if(body.action!=='send'||!UUID.test(body.id||'')||!UUID.test(body.order_id||'')||typeof body.expected_email!=='string'||body.expected_email.length>254)return reply(400,{error:'Invalid campaign or recipient.'});
      return reply(403,{error:'Feedback campaign delivery is testing-only. Production remains paused.'});
    }catch(error){
      // Only deliberate operational errors are returned; credentials/provider bodies are never logged.
      const message=error instanceof Error?error.message:'';
      if(message==='MAIL_AUTH'||message==='MAIL_CONFIG')return reply(503,{error:'Gmail authentication/configuration failed in Supabase Edge secrets.'});
      return reply(409,{error:message||'Invitation unavailable. Refresh delivery status before retrying.'});
    }
  };
}
