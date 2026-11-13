import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedbackInvitationHandler} from '../supabase/functions/_shared/feedback-invitation-handler.mjs';
import {feedbackEdge} from '../server/feedback-edge.mjs';
import {createGrowthOperationsHandler} from '../server/growth-operations.mjs';
import production from '../config/reporting.production.json' with {type:'json'};
const env={SUPABASE_URL:'https://dunoesykjvdnpeavojsi.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-secret'};
const professor={id:'b80fb162-04d0-47c4-928f-a03da244730e',email:'superiorvideo@gmail.com',email_confirmed_at:'2026-11-11'};
const body={action:'send',id:'00000000-0000-0000-0000-000000000001',order_id:'00000000-0000-0000-0000-000000000002',expected_email:'customer@example.com'};
const request=(token='user-token',value=body)=>new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(value)});
function fixture({user=professor,admin=true,environment=env}={}){
  let calls=0;
  const db={auth:{getUser:async()=>({data:{user}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:admin?{user_id:user?.id}:null})})};
  return {handler:createFeedbackInvitationHandler({env:environment,createClient:()=>db,send:async args=>{calls++;assert.equal(args.orderId,body.order_id);return {sent:true,status:'sent'};}}),get calls(){return calls;}};
}
test('production invitation sending remains disabled for both pinned approvers',async()=>{
  assert.deepEqual(production.approvers.map(account=>account.email).sort(),['nick@cardify.club','superiorvideo@gmail.com']);
  for(const account of production.approvers){
    const user={id:account.user_id,email:account.email,email_confirmed_at:'2026-11-12'};
    const f=fixture({user});assert.equal((await f.handler(request())).status,403);assert.equal(f.calls,0);
    for(const input of [{user:{...user,email:'placeparks@gmail.com'}},{user:{...user,id:'another-id'}},{user:{...user,email_confirmed_at:null}},{user:{...user,is_anonymous:true}},{user,admin:false}]){
      const denied=fixture(input);assert.equal((await denied.handler(request())).status,403);assert.equal(denied.calls,0);
    }
  }
});
test('service credential and expired session cannot substitute for Professor',async()=>{
  const f=fixture();assert.equal((await f.handler(request('server-secret'))).status,401);assert.equal(f.calls,0);
  const expired=fixture({user:null});assert.equal((await expired.handler(request())).status,401);
});
test('testing project and malformed targets cannot send',async()=>{
  const f=fixture({environment:{...env,SUPABASE_URL:'https://jsxkyzdijoawzaiwfkfc.supabase.co'}});assert.equal((await f.handler(request())).status,503);assert.equal(f.calls,0);
  const bad=fixture();assert.equal((await bad.handler(request('user-token',{...body,order_id:'invalid'}))).status,400);assert.equal(bad.calls,0);
});
test('readiness does not send and returns configuration blockers',async()=>{
  const f=fixture();const r=await f.handler(request('user-token',{action:'readiness'}));assert.equal(r.status,200);assert.ok((await r.json()).blockers.length);assert.equal(f.calls,0);
});
test('dashboard forwards user bearer to fixed production endpoint, not service credential',async()=>{
  const result=await feedbackEdge({env:{VITE_SUPABASE_URL:env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:'never-forward'},token:'user-session',body,fetchImpl:async(url,init)=>{
    assert.equal(url,env.SUPABASE_URL+'/functions/v1/send-feedback-invitation');assert.equal(init.headers.Authorization,'Bearer user-session');assert.equal(init.redirect,'error');return Response.json({sent:true});
  }});assert.equal(result.sent,true);
  await assert.rejects(feedbackEdge({env:{VITE_SUPABASE_URL:'https://other.invalid'},token:'user',body}),/production database/);
});
test('production dashboard blocks single and batch campaign sending before reaching Edge',async()=>{
 for(const account of production.approvers){
 const professor={id:account.user_id,email:account.email,email_confirmed_at:'2026-11-12'};
 const db={auth:{getUser:async()=>({data:{user:professor}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{user_id:professor.id}})})};
 let forwarded=null,result=null;
 const handler=createGrowthOperationsHandler({env:{...env,VITE_SUPABASE_URL:env.SUPABASE_URL,FEEDBACK_DELIVERY_READY:'true'},createClient:()=>db,edge:async args=>{forwarded=args;return {sent:true,transport:'supabase-edge'};}});
 const res={setHeader(){},end(value){result=JSON.parse(value);}};
 await handler({method:'POST',headers:{authorization:'Bearer session'},body:{...body,action:'send_feedback_invitation'}},res);
 assert.equal(res.statusCode,403);assert.equal(forwarded,null);assert.match(result.error,/testing-only/);
 forwarded=null;
 await handler({method:'POST',headers:{authorization:'Bearer session'},body:{id:body.id,action:'run_feedback_batch'}},res);
 assert.equal(res.statusCode,403);assert.match(result.error,/testing-only/);assert.equal(forwarded,null);
 }
});
