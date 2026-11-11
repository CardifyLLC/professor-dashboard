import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBusinessReport} from '../server/business-metrics.mjs';
import {decimalMinor,stripeMovements,paypalMovements,collectBusinessReport} from '../server/report-sources.mjs';
import {reportWindow,aiReportInput,secretMatches,createBusinessReportHandler} from '../server/business-report.mjs';
const start='2026-01-10T00:00:00.000Z',end='2026-01-11T00:00:00.000Z';
const coverage=Object.fromEntries(['stripe','paypal','storefront','prints_ledger','journey','attempts'].map(k=>[k,{status:'available'}]));
const order={id:'o1',user_id:'u',total_amount_cents:500,currency:'usd',payment_status:'paid',status:'paid',created_at:start,metadata:{paid_at:start},wallet_prints_spent:10};
const debit={id:'l1',entry_type:'order_debit',prints_delta:-10,related_order_id:'o1',created_at:start};
const movement={id:'stripe:t1',provider:'stripe',kind:'sale',amount_minor:500,currency:'USD',original_amount_minor:500,original_currency:'USD',created_at:start,references:['o1']};
const build=changes=>buildBusinessReport({start,end,fetchedAt:'2026-01-20T00:00:00Z',orders:[order],ledger:[debit],movements:[movement],coverage,...changes});
test('mixed tender counts cash and PRINTS separately, duplicates once',()=>{
 const r=build({movements:[movement,movement]});assert.equal(r.financials.currencies[0].cash_collected_minor,500);assert.equal(r.financials.prints.redeemed,10);assert.equal(r.financials.reconciliation.status,'matched');
});
test('wallet-only order does not invent cash revenue',()=>{
 const r=build({movements:[],orders:[{...order,total_amount_cents:0}]});assert.deepEqual(r.financials.currencies,[]);assert.equal(r.financials.prints.redeemed,10);assert.equal(r.financials.reconciliation.status,'matched');
});
test('package purchase and later redemption count one cash sale',()=>{
 const purchase={id:'package',entry_type:'purchase',prints_delta:100,external_reference:'cs_package',created_at:start};
 const r=build({orders:[{...order,total_amount_cents:0}],ledger:[purchase,debit],movements:[{...movement,references:['cs_package'],package:{amount_minor:500,currency:'USD',prints:100}}]});
 assert.equal(r.financials.reconciliation.status,'matched');assert.equal(r.financials.prints.purchased,100);assert.equal(r.financials.currencies[0].net_cash_minor,500);
});
test('refund of earlier-period payment belongs to refund period, partial/full and currency stay distinct',()=>{
 const refund={...movement,id:'re1',kind:'refund',amount_minor:125,original_amount_minor:125};
 const r=build({orders:[{...order,created_at:'2026-01-01',metadata:{paid_at:'2026-01-01'},refunded_at:start}],ledger:[],movements:[refund,{...refund,id:'re2',currency:'EUR',original_currency:'EUR',amount_minor:400}]});
 assert.deepEqual(r.financials.currencies.map(c=>[c.currency,c.net_cash_minor]),[['EUR',-400],['USD',-125]]);
});
test('UTC end boundary excluded; unmatched, cancelled and missing sources visible',()=>{
 const r=build({orders:[{...order,status:'cancelled'}],movements:[movement,{...movement,id:'next',created_at:end}],coverage:{...coverage,paypal:{status:'unavailable',reason:'No access'}}});
 assert.equal(r.financials.currencies[0].cash_collected_minor,500);assert.equal(r.financials.status,'partial');assert.ok(r.financials.reconciliation.issues.some(i=>i.reason==='cancelled_order_with_cash'));assert.ok(r.financials.warnings.some(w=>w.includes('No access')));
 const missing=build({movements:[{...movement,references:['unknown']}]});assert.ok(missing.financials.reconciliation.issues.some(i=>i.reason==='unmatched_provider_movement'));
});
test('conflicting duplicates and amount mismatches never reconcile',()=>{
 assert.throws(()=>build({movements:[movement,{...movement,amount_minor:999}]}),/contradictory/);
 assert.equal(build({orders:[{...order,total_amount_cents:null}]}).financials.reconciliation.status,'unreconciled');
});
test('conversion uses matured visit cohorts, deduplicated sessions and server linkage',()=>{
 const events=[{id:'1',stage:'visit',session_id:'s',created_at:start},{id:'2',stage:'payment_confirmed',source:'server',session_id:'s',attempt_id:'a',order_id:'o1',created_at:end}];
 const input={events,attempts:[{id:'a',session_id:'s',order_id:'o1'}],conversionValidated:true};
 assert.equal(build(input).conversion.visit_to_paid,1);
 assert.equal(build({...input,events:[events[0],{...events[1],source:'client'}]}).conversion.visit_to_paid,null);
 assert.equal(build({...input,fetchedAt:end}).conversion.status,'unverified');
 assert.equal(build({...input,events:[events[0],{...events[1],created_at:'2026-01-18'}]}).conversion.visit_to_paid,0);
});
test('decimal currency parsing is exact and rejects precision loss',()=>{
 assert.equal(decimalMinor('19.99','USD'),1999);assert.equal(decimalMinor('500','JPY'),500);assert.equal(decimalMinor('-1.005','KWD'),-1005);assert.throws(()=>decimalMinor('1.001','USD'));assert.throws(()=>decimalMinor('1e3','USD'));
});
test('Stripe balance time controls captured cash and pagination follows all pages',async()=>{
 let count=0;
 const rows=await stripeMovements({env:{STRIPE_SECRET_KEY:'test'},start,end,fetchImpl:async url=>{
  const u=new URL(url);assert.ok(u.pathname.endsWith('balance_transactions'));count++;
  return Response.json({data:[{id:'t'+count,type:'charge',amount:100,created:Date.parse(start)/1000,currency:'usd',source:{status:'succeeded',paid:true,captured:true,id:'ch'+count,amount:200,amount_captured:100,currency:'usd',metadata:{order_id:'o1'}}}],has_more:count===1});
 }});assert.equal(rows.length,2);assert.equal(rows[0].original_amount_minor,100);
});
test('PayPal uses balance-affecting pages and classifies refunds without counting authorization',async()=>{
 const rows=await paypalMovements({env:{PAYPAL_CLIENT_ID:'test',PAYPAL_CLIENT_SECRET:'test',PAYPAL_ENV:'sandbox'},start,end,fetchImpl:async url=>{
  if(url.endsWith('/token'))return Response.json({access_token:'test'});
  assert.equal(new URL(url).searchParams.get('balance_affecting_records_only'),'Y');
  return Response.json({total_pages:1,transaction_details:[['T0006','10.00'],['T1107','-2.50'],['T1300','10.00']].map(([code,value],i)=>({transaction_info:{transaction_id:String(i),transaction_event_code:code,transaction_status:'S',transaction_amount:{value,currency_code:'USD'},transaction_initiation_date:start}}))});
 }});assert.deepEqual(rows.map(r=>r.kind),['sale','refund','T1300']);
});
test('report dates and job authentication fail closed; AI sees no order identities',()=>{
 assert.equal(reportWindow(new URLSearchParams('kind=daily&date=2026-01-10'),new Date(end)).end,end);
 assert.throws(()=>reportWindow(new URLSearchParams('date=2026-02-30')));assert.throws(()=>reportWindow(new URLSearchParams('kind=range&days=all')));
 assert.equal(secretMatches('short','short'),false);assert.equal(secretMatches('a'.repeat(32),'b'.repeat(32)),false);
 assert.equal(JSON.stringify(aiReportInput(build())).includes('o1'),false);
});
test('private report rejects an unauthenticated request before loading business data',async()=>{
 let status;
 const handler=createBusinessReportHandler({env:{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'server'},createClient:()=>assert.fail(),collect:()=>assert.fail()});
 await handler({method:'GET',headers:{}},{setHeader(){},set statusCode(v){status=v;},end(){}});assert.equal(status,401);
});
test('collector integrates provider cash, retained facts, prior period and PDF failures',async()=>{
 const tables={reporting_order_facts:[order],reporting_ledger_facts:[debit],order_pdf_generations:[{order_id:'o1',status:'failed'}]};
 const db={from(table){const query={select(){return this;},order(key){if(table==='order_pdf_generations')assert.equal(key,'order_id');return this;},range(){return Promise.resolve({data:tables[table]||[]});},limit(){return Promise.resolve({data:tables[table]||[]});}};return query;}};
 const report=await collectBusinessReport({db,env:{STRIPE_SECRET_KEY:'test',PAYPAL_CLIENT_ID:'test',PAYPAL_CLIENT_SECRET:'test',PAYPAL_ENV:'sandbox'},start,end,now:new Date('2026-01-20'),fetchImpl:async url=>{
  if(url.includes('/oauth2/token'))return Response.json({access_token:'test'});
  if(url.includes('/reporting/transactions'))return Response.json({total_pages:0,transaction_details:[]});
  return Response.json({data:[{id:'txn',type:'charge',amount:500,currency:'usd',created:Date.parse(start)/1000,source:{status:'succeeded',paid:true,captured:true,id:'ch',amount:500,amount_captured:500,currency:'usd',metadata:{order_id:'o1'}}}],has_more:false});
 }});
 assert.equal(report.financials.reconciliation.status,'matched');assert.equal(report.operations.pdf_failures[0].order_id,'o1');assert.equal(report.comparison.net_cash_change[0].change_minor,500);
});
