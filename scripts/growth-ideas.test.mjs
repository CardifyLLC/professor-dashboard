import test from 'node:test';
import assert from 'node:assert/strict';
import {growthEvidence,validateGeneratedIdeas,generateProposalText,generateGrowthIdeas} from '../server/growth-ideas.mjs';
import {memoryDb} from './test-helpers/memory-db.mjs';
const report={version:'business-v3',financials:{status:'partial',fetched_at:'2026-11-14T00:00:00Z',period:{start:'2026-11-01',end:'2026-11-08'},currencies:[{currency:'USD',net_cash_minor:999}],reconciliation:{status:'unreconciled',issues:[{reference:'secret-order-id'}]}},operations:{aged_orders:[],pdf_failures:[],health_failures:[],exceptions:[]},growth:{repeat_paid_orders:10},conversion:{status:'unverified',visit_to_paid:null}};
const source=growthEvidence(report,new Date('2026-11-14T00:01:00Z'));
const idea={kind:'validation',title:'Verify reconciliation',segment:'Operations',trigger_description:'Unreconciled period',suggested_action:'Review the exception queue',expected_benefit:'More reliable reporting',cost:'One hour estimate',risks:'Root cause may need more time',success_measure:'Reviewed exceptions',evidence_keys:['quality.reconciliation']};
test('AI receives redacted shared definitions and cannot use unverified cash for growth ideas',()=>{
 assert.equal(source.allowed_kind,'validation_only');assert.equal(JSON.stringify(source).includes('999'),false);assert.equal(JSON.stringify(source).includes('secret-order-id'),false);
 const result=validateGeneratedIdeas({ideas:[idea]},source,'Owner');assert.equal(result[0].status,'pending');assert.equal(result[0].owner,'Owner');
 assert.match(result[0].evidence,/unreconciled/);assert.match(result[0].cost,/Unverified estimate/);
 assert.throws(()=>validateGeneratedIdeas({ideas:[{...idea,kind:'growth'}]},source,'Owner'));
 assert.throws(()=>validateGeneratedIdeas({ideas:[{...idea,evidence_keys:['invented.metric']}]},source,'Owner'));
 assert.throws(()=>validateGeneratedIdeas({ideas:Array(4).fill(idea)},source,'Owner'));
});
test('model call is bounded, has no tools, and rejects malformed responses',async()=>{
 const input={source,env:{ANTHROPIC_API_KEY:'fake',GROWTH_IDEAS_MODEL:'configured-model'}};
 const response=await generateProposalText({...input,fetchImpl:async(url,init)=>{
  assert.equal(url,'https://api.anthropic.com/v1/messages');const body=JSON.parse(init.body);assert.equal(body.model,'configured-model');assert.equal(body.tools,undefined);assert.equal(body.max_tokens,2200);
  return Response.json({content:[{type:'text',text:JSON.stringify({ideas:[idea]})}]});
 }});assert.equal(response.ideas.length,1);
 await assert.rejects(generateProposalText({...input,fetchImpl:async()=>Response.json({content:[{type:'text',text:'not JSON'}]})}));
});

test('concurrent weekly generation queues each proposal once and never executes it',async()=>{
 const db=memoryDb();let generated=0;
 const args={db,env:{GROWTH_IDEAS_ENABLED:'true',GROWTH_IDEAS_MODEL:'fixture'},report,now:new Date('2026-11-14T00:01:00Z'),generate:async()=>{generated++;return{ideas:[idea]};}};
 await Promise.all([generateGrowthIdeas(args),generateGrowthIdeas(args)]);
 await generateGrowthIdeas(args);
 assert.equal(generated,1);assert.equal(db.tables.growth_ideas.length,1);
 assert.equal(db.tables.growth_ideas[0].status,'pending');assert.equal(db.tables.growth_ideas[0].created_by,undefined);
 assert.equal(db.tables.growth_generation_runs[0].status,'completed');
});

test('queue failure retains generated proposal snapshot and retry does not call the model again',async()=>{
 let fail=true,generated=0;
 const db=memoryDb({},({table,operation})=>fail&&table==='growth_ideas'&&operation==='upsert');
 const now=new Date('2026-11-14T00:01:00Z');
 const args={db,env:{GROWTH_IDEAS_ENABLED:'true',GROWTH_IDEAS_MODEL:'fixture'},report,now,generate:async()=>{generated++;return{ideas:[idea]};}};
 await assert.rejects(generateGrowthIdeas(args),/incomplete/);
 assert.equal((await generateGrowthIdeas(args)).status,'retry_deferred');
 fail=false;await generateGrowthIdeas({...args,now:new Date(+now+86400000)});
 assert.equal(generated,1);assert.equal(db.tables.growth_ideas.length,1);
});
