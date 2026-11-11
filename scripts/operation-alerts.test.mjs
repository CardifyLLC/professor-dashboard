import test from 'node:test';
import assert from 'node:assert/strict';
import {monitorOperations} from '../server/operation-alerts.mjs';
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
