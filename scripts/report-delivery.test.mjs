import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverOnce,reportRecipients} from '../server/report-delivery.mjs';
function fixture(){let row=null,sends=0,failPersistence=false;const db={from(){return{
 async upsert(value){row ||= {...value,id:'one',status:'pending'};return{};},
 select(){return this;},eq(){return this;},async single(){return{data:{...row}};},
 update(change){const filters=[];return{eq(k,v){filters.push([k,v]);return this;},select(){return this;},async maybeSingle(){
  if(change.status!=='sending'&&failPersistence)return{error:{}};
  if(!filters.every(([k,v])=>row[k]===v))return{data:null};row={...row,...change};return{data:{...row}};
 }}}};}};
 const args={db,key:'daily:date:recipient',recipient:'test@example.invalid',report:{version:'business-v2'},subject:'Test',text:'Test',sendEmail:async()=>{sends++;return'receipt';}};
 return{args,get row(){return row;},get sends(){return sends;},fail(){failPersistence=true;}};
}
test('concurrent daily jobs send one copy per recipient',async()=>{const f=fixture();await Promise.all([deliverOnce(f.args),deliverOnce(f.args)]);assert.equal(f.sends,1);assert.equal(f.row.provider_reference,'receipt');await deliverOnce(f.args);assert.equal(f.sends,1);});
test('ambiguous mail timeout stays uncertain and cannot auto resend',async()=>{const f=fixture();let calls=0;const args={...f.args,sendEmail:async()=>{calls++;throw new Error('timeout');}};await deliverOnce(args);await deliverOnce(args);assert.equal(calls,1);assert.equal(f.row.status,'uncertain');});
test('definite mail rejection is retryable independently',async()=>{const f=fixture();await deliverOnce({...f.args,sendEmail:async()=>{throw Object.assign(new Error('denied'),{definitelyRejected:true});}});assert.equal(f.row.status,'failed');await deliverOnce(f.args);assert.equal(f.row.status,'sent');});
test('persistence failure after send retains sending state for manual reconciliation',async()=>{const f=fixture();f.fail();await assert.rejects(deliverOnce(f.args));await deliverOnce(f.args);assert.equal(f.sends,1);assert.equal(f.row.status,'sending');});
test('production recipients are fixed; testing never inherits production addresses',()=>{assert.deepEqual(reportRecipients({SUPABASE_URL:'https://dunoesykjvdnpeavojsi.supabase.co'}),['superiorvideo@gmail.com','placeparks@gmail.com']);assert.throws(()=>reportRecipients({SUPABASE_URL:'https://jsxkyzdijoawzaiwfkfc.supabase.co'}));assert.deepEqual(reportRecipients({REPORT_TEST_RECIPIENTS:'test@example.invalid'}),['test@example.invalid']);});
