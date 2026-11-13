import test from 'node:test';
import assert from 'node:assert/strict';
import { IDEA_FIELDS,validateIdea,decisionChange,createGrowthOperationsHandler } from '../server/growth-operations.mjs';
import { validateCampaign } from '../shared/feedback-campaign.mjs';
import { reportingApprover } from '../server/reporting-authority.mjs';
const id='00000000-0000-0000-0000-000000000001';
const productionEnv={VITE_SUPABASE_URL:'https://dunoesykjvdnpeavojsi.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server'};
const professor={id:'b80fb162-04d0-47c4-928f-a03da244730e',email:'superiorvideo@gmail.com',email_confirmed_at:'2026-11-12'};
const nick={id:'f926669e-77bf-40cb-a054-3260f07b4dc8',email:'nick@cardify.club',email_confirmed_at:'2026-11-12'};
test('production approval requires one of the two pinned, verified identities',()=>{
  for(const user of [professor,nick]){
    assert.equal(reportingApprover(productionEnv,user),user.id);
    assert.equal(reportingApprover(productionEnv,{...user,email:user.email.toUpperCase()}),user.id);
    for(const invalid of [{...user,id:'another-id'},{...user,email:'placeparks@gmail.com'},{...user,email_confirmed_at:null},{...user,is_anonymous:true}])assert.equal(reportingApprover(productionEnv,invalid),null);
    for(const url of ['https://jsxkyzdijoawzaiwfkfc.supabase.co','https://other.invalid'])assert.equal(reportingApprover({...productionEnv,VITE_SUPABASE_URL:url,REPORTING_APPROVER_USER_ID:user.id},user),null);
  }
  assert.equal(reportingApprover(productionEnv),null);
  assert.equal(reportingApprover(productionEnv,{...nick,id:professor.id}),null);
  assert.equal(reportingApprover({...productionEnv,REPORTING_APPROVER_USER_ID:'staff'},{id:'staff',email:'staff@example.com',email_confirmed_at:'2026-11-12'}),null);
});
test('ideas require evidence, risks, owner and measurement',()=>{
  const idea=Object.fromEntries(IDEA_FIELDS.map(key=>[key,'Example']));assert.equal(validateIdea(idea).evidence,'Example');delete idea.evidence;assert.throws(()=>validateIdea(idea));
});
test('only explicitly configured Professor can approve; completion needs outcome',()=>{
  const body={id,version:1,status:'approved'};
  assert.throws(()=>decisionChange(body,'staff','professor'));assert.throws(()=>decisionChange(body,'professor',undefined));
  assert.equal(decisionChange(body,'professor','professor').status,'approved');
  assert.throws(()=>decisionChange({...body,status:'completed'},'professor','professor'));
});
test('campaign cannot infer missing business rules or accept another reward amount',()=>{
  assert.throws(()=>validateCampaign({}));
  const config={timing_trigger:'created_at',delay_days:7,invitation_frequency_days:30,reward_limit_per_customer:1,expires_after_days:14,max_invitations:10,budget_prints:50,budget_email_minor:100,email_unit_cost_minor:1,audience:'all_consented_customers',email_subject:'Feedback',email_text:'Questionnaire invitation',currency:'USD',qualifying_statuses:['completed'],questionnaire:[{id:'q1',label:'How was your order?'}],enabled:true,reward_prints:500};
  const saved=validateCampaign(config);assert.equal(saved.enabled,false);assert.equal(saved.paused,true);assert.equal(saved.reward_prints,5);assert.equal(saved.approved_by,null);
  assert.throws(()=>validateCampaign({...config,qualifying_statuses:['cancelled']}));
});
test('unauthenticated and non-admin calls cannot create proposals',async()=>{
  let output;
  const response={setHeader(){},end(text){output=JSON.parse(text);}};
  const handler=createGrowthOperationsHandler({createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})})}),env:{VITE_SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'server'}});
  await handler({method:'POST',headers:{},body:{}},response);assert.equal(response.statusCode,401);
  await handler({method:'POST',headers:{authorization:'Bearer user-token'},body:{}},response);assert.equal(response.statusCode,403);assert.match(output.error,/Administrator/);
});

function operationsFixture({user=nick,admin=true,ready=true}={}){
  const tables={
    dashboard_admins:admin?[{user_id:user.id,enabled:true}]:[],
    growth_ideas:[{id,version:1,status:'pending'}],operation_exceptions:[],
    feedback_campaigns:[{id,version:1,timing_trigger:'created_at',delay_days:7,invitation_frequency_days:30,reward_limit_per_customer:1,expires_after_days:14,max_invitations:10,budget_prints:50,budget_email_minor:100,email_unit_cost_minor:1,audience:'all_consented_customers',email_subject:'Feedback',email_text:'Questionnaire invitation',currency:'USD',qualifying_statuses:['completed'],questionnaire:[{id:'q1',label:'How was your order?'}],enabled:false,paused:true}],
  };
  const writes=[];
  const db={auth:{getUser:async()=>({data:{user}})},from(table){
    const filters=[];let change;
    const result=()=>{
      const rows=tables[table].filter(row=>filters.every(([key,value])=>row[key]===value));
      if(change)for(const row of rows){writes.push({table,...change});Object.assign(row,change);}
      return rows;
    };
    return {select(){return this;},eq(key,value){filters.push([key,value]);return this;},order(){return this;},limit(){return this;},update(value){change=value;return this;},async single(){return{data:result()[0]||null};},async maybeSingle(){return{data:result()[0]||null};},then(resolve,reject){return Promise.resolve({data:result()}).then(resolve,reject);}};
  }};
  const handler=createGrowthOperationsHandler({createClient:()=>db,env:{...productionEnv,FEEDBACK_DELIVERY_READY:'true'},edge:async()=>({blockers:ready?[]:['Delivery not ready']})});
  return {tables,writes,async call(body){let data;const res={setHeader(){},end(value){data=JSON.parse(value);}};await handler({method:body?'POST':'GET',headers:{authorization:'Bearer signed-in-session'},body},res);return{status:res.statusCode,data};}};
}

for(const user of [professor,nick]){
  test(`${user.email} sees approval controls and can approve/reject with the actual actor recorded`,async()=>{
    const view=await operationsFixture({user}).call();assert.equal(view.status,200);assert.equal(view.data.canApprove,true);
    for(const status of ['approved','rejected']){
      const f=operationsFixture({user});const result=await f.call({action:'decide_idea',id,version:1,status});
      assert.equal(result.status,200);assert.equal(result.data.idea.status,status);assert.equal(result.data.idea.decided_by,user.id);assert.equal(result.data.idea.version,2);
      assert.equal((await f.call({action:'decide_idea',id,version:1,status})).status,409);
    }
  });
  test(`${user.email} cannot activate the testing-only campaign in production`,async()=>{
    const f=operationsFixture({user});const result=await f.call({action:'enable_campaign',id,version:1});
    assert.equal(result.status,403);assert.match(result.data.error,/testing-only/);assert.equal(f.writes.length,0);
    const blocked=operationsFixture({user,ready:false});assert.equal((await blocked.call({action:'enable_campaign',id,version:1})).status,403);assert.equal(blocked.writes.length,0);
  });
}

test('unapproved admins cannot approve or reject; revoked admins cannot even read operations',async()=>{
  for(const user of [{...nick,email:'placeparks@gmail.com'},{...nick,id:'other-user'},{...nick,email_confirmed_at:null},{...nick,is_anonymous:true}]){
    const f=operationsFixture({user});assert.equal((await f.call()).data.canApprove,false);
    for(const status of ['approved','rejected'])assert.equal((await f.call({action:'decide_idea',id,version:1,status})).status,403);
    assert.equal((await f.call({action:'enable_campaign',id,version:1})).status,403);assert.equal(f.writes.length,0);
  }
  const revoked=operationsFixture({admin:false});assert.equal((await revoked.call()).status,403);
  assert.equal((await revoked.call({action:'decide_idea',id,version:1,status:'approved'})).status,403);assert.equal(revoked.writes.length,0);
});
