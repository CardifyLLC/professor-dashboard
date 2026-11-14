import test from 'node:test';
import assert from 'node:assert/strict';
import {reportEmail,operationsEmail,emailMoney,emailPeriod} from '../server/report-email.mjs';
import {deliverReport,reportDeliveryKey} from '../server/report-delivery.mjs';
import {memoryDb} from './test-helpers/memory-db.mjs';

export function sampleReport() {
  return {
    kind:'daily',version:'business-v3',
    financials:{
      period:{start:'2026-11-13T00:00:00.000Z',end:'2026-11-14T00:00:00.000Z'},
      fetched_at:'2026-11-14T03:30:41.826Z',status:'partial',
      currencies:[{currency:'USD',cash_collected_minor:42192,refunds_minor:6625,net_cash_minor:35567}],
      prints:{purchased:100,redeemed:39,redemption_reversed:0,feedback_awarded:0},
      coverage:{stripe:{status:'available'},paypal:{status:'unavailable',reason:'PayPal reporting credentials/environment missing'}},
      reconciliation:{status:'unreconciled',stripe_and_prints:{status:'unreconciled'},
        issues:[{provider:'stripe',reference:'private-transaction-reference',reason:'provider_refund_not_recorded_on_order'}],
        excluded_movements:[{kind:'payout',currency:'USD',amount_minor:-37841}]},
    },
    comparison:{status:'unverified',currencies:[{currency:'USD',net_cash_minor:52843}],net_cash_change:null},
    conversion:{status:'unverified',matured:false,unlinked_attempts:7,stages:{visit:45,design_start:1,import_complete:0,preview:0,checkout_start:0,payment_confirmed:0},visit_to_paid:null},
    operations:{aged_threshold_hours:72,aged_orders:Array(365).fill({order_id:'private-order-id'}),pdf_failures:Array(5).fill({}),health_failures:[],shipping_exceptions:[],delivery_exceptions:[],exceptions:Array(400).fill({issue:'private-raw-detail'})},
    growth:{repeat_paid_orders:2,affiliate_orders:2,partner_orders:0,experiments:[]},
    campaigns:[{name:'Feedback for 5 PRINTS',enabled:false,paused:true,invitations:0,completed:0,prints_awarded:0,failures:0,opt_outs:0,email_cost_minor:null,currency:'USD',repeat_orders_after_feedback:0}],
  };
}
test('business report converts minor amounts, labels dates and keeps partial data explicit',()=>{
  const email=reportEmail(sampleReport(),{aiEnabled:false});
  assert.match(email.text,/Money received \(USD\): \$421\.92/);
  assert.match(email.text,/Refunds \(USD\): \$66\.25/);
  assert.match(email.text,/Cash after refunds \(USD\): \$355\.67/);
  assert.match(email.text,/13 Nov 2026 · UTC/);
  assert.match(email.text,/PayPal.*unavailable/);
  assert.match(email.text,/not profit/);
  assert.match(email.text,/refunds need to be matched/i);
  assert.match(email.text,/-\$378\.41/);
  assert.match(email.text,/Used on orders: 39/);
  assert.match(email.text,/Automatic AI suggestions are off/);
  assert.doesNotMatch(email.text,/minor units|business-v3|cash_collected_minor|private-transaction|private-order|private-raw|JSON|2026-11-13T/);
  assert.match(email.html,/<h1[^>]*>Daily business summary/);
  assert.match(email.html,/text\/html|<!doctype html>/);
  assert.ok(email.html.length<40000);
  assert.ok(email.text.length<6500);
});
test('currency precision and exclusive weekly end date stay correct',()=>{
  assert.equal(emailMoney(1234,'JPY'),'¥1,234');
  assert.match(emailMoney(1234,'BHD'),/1\.234/);
  assert.equal(emailMoney(null,'USD'),'Unavailable');
  assert.equal(emailMoney(1.5,'USD'),'Unavailable');
  assert.equal(emailPeriod({start:'2026-10-28',end:'2026-11-04'}),'28 Oct 2026 – 3 Nov 2026');
});
test('unavailable counts are not presented as zero and unverified comparisons/rates are withheld',()=>{
  const report=sampleReport();
  report.financials.currencies=[];report.financials.prints=null;
  report.operations={aged_orders:null,pdf_failures:null,health_failures:null,shipping_exceptions:null,delivery_exceptions:null,exceptions:null};
  report.comparison.net_cash_change=[{currency:'USD',change_minor:10000,change_percent:35}];
  report.conversion.visit_to_paid=0.5;
  report.campaigns=null;
  const {text}=reportEmail(report);
  assert.match(text,/Cash totals are unavailable/);
  assert.match(text,/Purchased: Unavailable/);
  assert.match(text,/Some operational checks are unavailable/);
  assert.match(text,/Visit-to-payment rate: Not verified/);
  assert.doesNotMatch(text,/35\.0%|50\.0%|No issues were found|Money received.*\$0/);
  assert.match(text,/Campaign data is unavailable/);
});
test('HTML escapes stored content and unsafe dashboard links fall back to the correct environment',()=>{
  const report=sampleReport();report.campaigns[0].name='<img src=x onerror=alert(1)>';
  const {html,subject,text}=reportEmail(report,{testing:true,dashboardUrl:'javascript:alert(1)'});
  assert.match(subject,/^\[TEST\]/);assert.match(text,/testing data/);
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|href="javascript/);
  assert.match(html,/href="https:\/\/testing-dashboard-phi\.vercel\.app\/"/);
});
test('large operation lists become a bounded digest with owner and next steps',()=>{
  const items=Array.from({length:2000},(_,index)=>({id:'private-'+index,source_key:index%2?'aged:'+index:'pdf:'+index,order_id:'private-customer-order',owner:'Operations owner',issue:'private issue detail'}));
  const email=operationsEmail(items,{testing:true,now:'2026-11-14T03:30:00Z'});
  assert.match(email.subject,/^\[TEST\].*2,000/);
  assert.match(email.text,/Print files need attention: 1,000/);
  assert.match(email.text,/Orders waiting too long: 1,000/);
  assert.match(email.text,/Operations owner/);
  assert.match(email.text,/Check order progress/);
  assert.doesNotMatch(email.text,/private-customer-order|private issue|private-\d/);
  assert.ok(email.html.length<12000);assert.ok(email.text.length<2000);
});
test('report retries format the saved report and preserve exactly-once delivery',async()=>{
  const saved=sampleReport(),recipient='reader@example.invalid',messages=[];
  const db=memoryDb({report_deliveries:[{id:'saved-report',delivery_key:reportDeliveryKey(saved,recipient),recipient,report:saved,status:'pending',send_attempts:0}]});
  const fresh=structuredClone(saved);fresh.financials.currencies[0].net_cash_minor=999999;
  const args={db,env:{SUPABASE_URL:'https://jsxkyzdijoawzaiwfkfc.supabase.co',REPORT_TEST_RECIPIENTS:recipient,REPORT_DELIVERY_ENABLED:'true',GROWTH_IDEAS_ENABLED:'false'},report:fresh,prepareMailer:async()=>({send:async email=>{messages.push(email);return 'mail-receipt';}})};
  await deliverReport(args);await deliverReport(args);
  assert.equal(messages.length,1);assert.match(messages[0].text,/\$355\.67/);assert.doesNotMatch(messages[0].text,/\$9,999\.99/);
  assert.match(messages[0].html,/Daily business summary/);assert.match(messages[0].subject,/^\[TEST\]/);
});
