import test from 'node:test';
import assert from 'node:assert/strict';
import {applyReconciliationEvidence} from '../server/reconciliation-evidence.mjs';
import {buildBusinessReport} from '../server/business-metrics.mjs';
const start='2026-11-02T00:00:00Z',end='2026-11-03T00:00:00Z';
const order={id:'o',total_amount_cents:500,currency:'usd',payment_status:'paid',status:'paid',created_at:start,metadata:{},wallet_prints_spent:0};
const sale={id:'stripe:tx',provider:'stripe',kind:'sale',amount_minor:500,original_amount_minor:500,currency:'USD',original_currency:'USD',created_at:start,references:['o']};
const coverage=Object.fromEntries(['stripe','storefront','prints_ledger','reconciliation_evidence'].map(k=>[k,{status:'available'}]));
coverage.paypal={status:'unavailable',reason:'Not integrated'};
const evidence={order_id:'o',provider:'stripe',provider_reference:'stripe:tx',event_kind:'sale',amount_minor:500,currency:'USD',occurred_at:start};
const build=(orders,movements)=>buildBusinessReport({start,end,fetchedAt:end,orders,movements,coverage});
test('verified historical evidence fills a timestamp without rewriting the original record',()=>{
 const orders=applyReconciliationEvidence([order],[evidence]);
 assert.equal(order.metadata.paid_at,undefined);assert.equal(orders[0].metadata.paid_at,start);
 const report=build(orders,[sale]);assert.equal(report.financials.reconciliation.stripe_and_prints.status,'matched');
 assert.equal(report.financials.status,'partial');assert.equal(report.financials.reconciliation.status,'unreconciled');
 assert.equal(applyReconciliationEvidence([order],[{...evidence,amount_minor:900}])[0].metadata.paid_at,undefined);
});
test('fees and payouts remain visible without pretending to be missing sales; adjustments stay exceptions',()=>{
 const orders=applyReconciliationEvidence([order],[evidence]);
 const payout={...sale,id:'stripe:payout',kind:'payout',signed_amount_minor:-200};
 const r=build(orders,[sale,payout]);assert.equal(r.financials.reconciliation.stripe_and_prints.status,'matched');
 assert.equal(r.financials.reconciliation.excluded_movements[0].amount_minor,-200);
 assert.equal(r.financials.currencies[0].net_cash_minor,500);
 assert.equal(build(orders,[sale,{...payout,kind:'adjustment'}]).financials.reconciliation.stripe_and_prints.status,'unreconciled');
});
test('partial refund evidence matches the exact provider reference, amount and currency',()=>{
 const refund={...sale,id:'stripe:refund',kind:'refund',amount_minor:100,original_amount_minor:100};
 const orders=applyReconciliationEvidence([order],[evidence,{...evidence,event_kind:'refund',provider_reference:refund.id,amount_minor:100}]);
 assert.equal(build(orders,[sale,refund]).financials.reconciliation.issues.length,0);
 assert.ok(build(orders,[sale,{...refund,original_amount_minor:101}]).financials.reconciliation.issues.length);
});
