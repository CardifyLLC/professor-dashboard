import test from 'node:test';
import assert from 'node:assert/strict';
import {monitorOperations} from '../server/operation-alerts.mjs';
import {memoryDb} from './test-helpers/memory-db.mjs';
test('monitor queues PDF, shipping, stale worker and unavailable-source exceptions without sending when disabled',async()=>{
 const incidents=new Map(),health=[{id:'pdf-worker',status:'ok',checked_at:'2026-01-01',max_age_minutes:150}];
 const tables={order_pdf_generations:[{order_id:'order1',status:'failed'}],reporting_order_facts:[],operation_health:health,shipment_tracking_notifications:[{id:'shipment1',order_id:'order1',status:'unknown'}],report_deliveries:[{id:'mail1',delivery_key:'alert:older',status:'uncertain'}]};
 const db={from(table){return{select(){return this;},order(key){if(table==='order_pdf_generations')assert.equal(key,'order_id');return this;},async range(){return table==='refund_operations'?{error:{}}:{data:tables[table]||[]};},async upsert(row){const index=health.findIndex(h=>h.id===row.id);if(index<0)health.push(row);else health[index]=row;return{};}};},async rpc(name,args){assert.equal(name,'open_operation_exception');if(!incidents.has(args.p_key))incidents.set(args.p_key,{id:args.p_key,version:1,issue:args.p_issue});return{data:incidents.get(args.p_key)};}};
 const input={db,env:{SUPABASE_URL:'https://dunoesykjvdnpeavojsi.supabase.co',DASHBOARD_APP_URL:'https://dashboard.invalid',CUSTOMER_APP_URL:'https://storefront.invalid'},now:new Date('2026-01-10'),fetchImpl:async()=>Response.json({ok:true})};
 const first=await monitorOperations(input);await monitorOperations(input);
 assert.equal(first.findings,4);assert.equal(incidents.size,4);
 assert.ok(incidents.has('pdf:order1'));assert.ok(incidents.has('shipping:shipment1'));assert.ok(incidents.has('health:pdf-worker'));assert.ok(incidents.has('source:refunds'));
 assert.equal(incidents.has('delivery:mail1'),false,'No recursive failed-alert emails');
 assert.ok(first.outcomes.every(o=>o.status==='queued_delivery_disabled'));
});

test('routine issues stay in the action list; only new critical issues are emailed',async()=>{
 const now=new Date('2026-11-14T00:00:00Z');
 const db=memoryDb({
  reporting_order_facts:[{id:'aged-order',status:'paid',created_at:'2026-11-01'}],
  order_pdf_generations:[{order_id:'pdf-order',status:'failed'}],
  shipment_tracking_notifications:[{id:'shipment',order_id:'shipping-order',status:'failed'}],
  report_deliveries:[{id:'failed-report',delivery_key:'daily:old',status:'failed',created_at:'2026-11-13',updated_at:'2026-11-13'}],
  operation_health:[{id:'pdf-worker',status:'ok',checked_at:now.toISOString(),max_age_minutes:45}],
 });
 const incidents=new Map(),messages=[],announced=new Set();
 db.rpc=async(name,args)=>{
  if(name==='claim_operation_alert'){
   const fresh=args.p_items.filter(i=>!announced.has(i.id+':'+i.version));
   if(!fresh.length)return{data:{status:'unchanged'}};
   fresh.forEach(i=>announced.add(i.id+':'+i.version));
   const row={id:'alert-claim',delivery_key:'alert:critical:fixture',status:'sending',report:{exceptions:fresh}};db.tables.report_deliveries.push(row);
   return{data:{status:'claimed',id:row.id,report:row.report}};
  }
  assert.equal(name,'open_operation_exception');
  if(!incidents.has(args.p_key))incidents.set(args.p_key,{id:args.p_key,version:1,issue:args.p_issue,owner:args.p_owner,next_action:args.p_next});
  return{data:incidents.get(args.p_key)};
 };
 const args={db,now,env:{SUPABASE_URL:'https://jsxkyzdijoawzaiwfkfc.supabase.co',REPORT_TEST_RECIPIENTS:'owner@example.invalid',OPERATION_ALERTS_ENABLED:'true',OPERATIONS_OWNER:'Assigned owner',DASHBOARD_APP_URL:'https://dashboard.invalid',CUSTOMER_APP_URL:'https://storefront.invalid'},fetchImpl:async()=>Response.json({ok:true}),prepareMailer:async()=>({send:async email=>{messages.push(email);return 'fixture-receipt';}})};
 const first=await monitorOperations(args);await monitorOperations(args);
 assert.equal(first.findings,4);assert.equal(incidents.size,4);assert.equal(messages.length,1);
 assert.equal(messages[0].to,'owner@example.invalid');assert.match(messages[0].text,/Assigned owner/);
 assert.match(messages[0].text,/Print files need attention/);assert.doesNotMatch(messages[0].text,/Orders waiting too long|Shipping emails need review|Report emails need review/);
 assert.ok(incidents.has('aged:aged-order'));assert.ok(incidents.has('pdf:pdf-order'));assert.ok(incidents.has('shipping:shipment'));assert.ok(incidents.has('delivery:failed-report'));
});

test('paused reporting does not create stale report or feedback scheduler alerts',async()=>{
 const now=new Date('2026-11-17T12:00:00Z'),keys=[];
 const db=memoryDb({operation_health:[{id:'report-scheduler',status:'failed',checked_at:'2026-01-01',max_age_minutes:45},{id:'feedback-scheduler',status:'failed',checked_at:'2026-01-01',max_age_minutes:45},{id:'pdf-worker',status:'ok',checked_at:now.toISOString(),max_age_minutes:150}]});
 db.rpc=async(name,args)=>{keys.push(args.p_key);return{data:{id:args.p_key,version:1}};};
 const result=await monitorOperations({db,env:{REPORT_DELIVERY_ENABLED:'false',FEEDBACK_AUTOMATION_ENABLED:'false',OPERATION_ALERTS_ENABLED:'false',DASHBOARD_APP_URL:'https://dashboard.invalid',CUSTOMER_APP_URL:'https://storefront.invalid'},now,fetchImpl:async()=>Response.json({ok:true}),prepareMailer:()=>assert.fail('disabled alerts must not prepare mail')});
 assert.deepEqual(keys,[]);assert.deepEqual(result.outcomes,[]);
});

test('reaching the email limit reserves one aggregate webhook without sending email',async()=>{
 const now=new Date(),db=memoryDb({order_pdf_generations:[{order_id:'pdf',status:'failed'}],operation_health:[{id:'pdf-worker',status:'ok',checked_at:now.toISOString(),max_age_minutes:150}]});
 let webhooks=0;
 db.rpc=async(name,args)=>{
  if(name==='open_operation_exception')return{data:{id:'incident',version:1,source_key:args.p_key}};
  if(name==='claim_operation_alert')return{data:{status:'daily_limit',exceptions:args.p_items}};
  assert.equal(name,'claim_operation_alert_webhook');webhooks++;return{data:{status:'claimed',id:'webhook-id',count:args.p_items.length}};
 };
 const result=await monitorOperations({db,env:{SUPABASE_URL:'https://jsxkyzdijoawzaiwfkfc.supabase.co',REPORT_TEST_RECIPIENTS:'one@example.invalid,two@example.invalid',OPERATION_ALERTS_ENABLED:'true',DASHBOARD_APP_URL:'https://dashboard.invalid',CUSTOMER_APP_URL:'https://storefront.invalid'},now,fetchImpl:async()=>Response.json({ok:true}),prepareMailer:()=>assert.fail('limit must prevent mail preparation')});
 assert.equal(webhooks,1);assert.deepEqual(result.webhook,{id:'webhook-id',count:1});assert.ok(result.outcomes.every(o=>o.status==='daily_limit'));
});
