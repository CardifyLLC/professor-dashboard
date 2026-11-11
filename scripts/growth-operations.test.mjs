import test from 'node:test';
import assert from 'node:assert/strict';
import { IDEA_FIELDS,validateIdea,decisionChange,createGrowthOperationsHandler } from '../server/growth-operations.mjs';
import { validateCampaign } from '../shared/feedback-campaign.mjs';
import { reportingApprover } from '../server/reporting-authority.mjs';
const id='00000000-0000-0000-0000-000000000001';
test('production approval belongs only to the verified superiorvideo account',()=>{
  assert.equal(reportingApprover({VITE_SUPABASE_URL:'https://dunoesykjvdnpeavojsi.supabase.co',REPORTING_APPROVER_USER_ID:'69c337df-3264-41b1-8edc-e33bc98d4e77'}),'b80fb162-04d0-47c4-928f-a03da244730e');
  assert.equal(reportingApprover({VITE_SUPABASE_URL:'https://jsxkyzdijoawzaiwfkfc.supabase.co'}),null);
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
