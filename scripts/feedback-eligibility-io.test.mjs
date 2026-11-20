import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackEligibility } from '../server/feedback-eligibility.mjs';

test('eligibility keeps consent, refund and metadata timing rules without loading artwork', async () => {
  for (const mode of ['eligible', 'refunded', 'no-consent']) {
    const campaign = { id:'campaign', enabled:true, timing_trigger:'paid_at', delay_days:1, qualifying_statuses:['paid'], audience:'all_consented_customers', invitation_frequency_days:30, reward_limit_per_customer:1, max_invitations:10, budget_prints:100, budget_email_minor:100, email_unit_cost_minor:1 };
    const order = { id:'order', user_id:'user', customer_email:'fallback@example.test', payment_status:'paid', status:'paid', refunded_at:mode==='refunded'?'2026-01-01':null, created_at:'2025-01-01', completed_at:null, metadata:{paid_at:'2025-01-02'}, get card_data(){ throw Error('Artwork must not be loaded for eligibility'); } };
    const rows = { orders:[order], profiles:[{id:'user',email:'owner@example.test'}], marketing_subscribers:mode==='no-consent'?[]:[{email:'owner@example.test',status:'subscribed',consented_at:'2025-01-01',consent_text:'Yes'}], feedback_invitations:[] };
    const db = { from(table) {
      let fields;
      const q = { select(value){ fields=value; return q; }, eq(){return q;}, order(){return q;},
        async single(){ assert.equal(table,'feedback_campaigns'); return {data:campaign}; },
        async range(from,to){
          const data=rows[table].slice(from,to+1).map(row=>fields==='*'?{...row}:Object.fromEntries(fields.split(',').map(key=>[key,row[key]])));
          return {data};
        },
      };
      return q;
    } };
    const result = await feedbackEligibility(db, 'campaign', {FEEDBACK_DELIVERY_READY:'true'});
    assert.equal(result.rows.length,1); assert.equal(result.rows[0].email,'owner@example.test');
    assert.equal(result.rows[0].eligible,mode==='eligible');
    if(mode==='refunded') assert.ok(result.rows[0].reasons.includes('Order refunded or cancelled'));
    if(mode==='no-consent') assert.ok(result.rows[0].reasons.includes('Missing marketing consent'));
    assert.ok(!result.rows[0].reasons.includes('Missing campaign timing timestamp'));
  }
});
