// Pure, versioned contract used by the private dashboard, reports and AI input.
export const METRIC_VERSION = 'business-v3';
const meta = row => typeof row?.metadata === 'object' && row.metadata ? row.metadata : {};
const time = value => typeof value === 'number' ? value * 1000 : Date.parse(value);
const inside = (value, start, end) => time(value) >= start && time(value) < end;
const int = value => value !== null && value !== undefined && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export function uniqueRows(rows, label) {
  const seen = new Map();
  for (const row of rows) {
    if (!row?.id) throw new Error(`${label}: missing identity`);
    const previous = seen.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error(`${label}: contradictory duplicate`);
    seen.set(row.id, row);
  }
  return [...seen.values()];
}
export function buildBusinessReport({ start, end, fetchedAt, movements = [], orders = [], ledger = [], coverage, exceptions = [], ideas = [], events = [], attempts = [], health = [], campaigns = [], invitations = [], claims = [], agedHours = 72, conversionValidated = false }) {
  start = time(start); end = time(end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('Invalid report window');
  orders = uniqueRows(orders, 'orders'); ledger = uniqueRows(ledger, 'ledger');
  movements = uniqueRows(movements, 'movements');
  const issues = [], excludedMovements = [], currencies = new Map(), matched = new Set(), refundedByOrder = new Map();
  const ledgerById=new Map(ledger.map(l=>[l.id,l])),purchasesByReference=new Map(),debitsByOrder=new Map();
  for(const entry of ledger){
    if(entry.entry_type==='purchase'&&entry.external_reference){const rows=purchasesByReference.get(entry.external_reference)||[];rows.push(entry);purchasesByReference.set(entry.external_reference,rows);}
    if(entry.entry_type==='order_debit'&&entry.related_order_id)debitsByOrder.set(entry.related_order_id,(debitsByOrder.get(entry.related_order_id)||0)-Number(entry.prints_delta));
  }
  const orderIndex = new Map();
  const index = (reference, order) => { if (!reference) return; const rows = orderIndex.get(reference) || []; rows.push(order); orderIndex.set(reference, rows); };
  for (const order of orders) for (const ref of new Set([order.id, order.stripe_session_id, order.paypal_order_id, order.paypal_capture_id, meta(order).paypal_capture_id, meta(order).payment_intent, meta(order).stripe_payment_intent_id, meta(order).tempOrderId])) index(ref, order);
  const issue = (reference, reason, provider = 'storefront') => issues.push({ reference, reason, provider });
  const periodMovements = movements.filter(m => inside(m.created_at, start, end));
  for (const movement of periodMovements) {
    if (!/^[A-Z]{3}$/.test(movement.currency) || !Number.isSafeInteger(movement.amount_minor)) throw new Error('Invalid money movement');
    if (!['sale','refund'].includes(movement.kind)) {
      excludedMovements.push({reference:movement.id,provider:movement.provider,kind:movement.kind,currency:movement.currency,amount_minor:movement.signed_amount_minor??null});
      // Normal settlements and fees are outside gross customer cash. Disputes,
      // adjustments and unknown types still need explicit reconciliation.
      if(!['payout','payout_cancel','payout_failure','stripe_fee','stripe_fx_fee'].includes(movement.kind))issue(movement.id,'review_'+movement.kind,movement.provider);
      continue;
    }
    const bucket = currencies.get(movement.currency) || {currency:movement.currency,cash_collected_minor:0,refunds_minor:0,net_cash_minor:0};
    if (movement.kind === 'sale') bucket.cash_collected_minor += movement.amount_minor;
    else bucket.refunds_minor += movement.amount_minor;
    bucket.net_cash_minor = bucket.cash_collected_minor - bucket.refunds_minor;
    if (!Object.values(bucket).filter(v=>typeof v==='number').every(Number.isSafeInteger)) throw new Error('Money overflow');
    currencies.set(movement.currency,bucket);
    const candidates = new Map();
    for (const ref of movement.references || []) for (const order of orderIndex.get(ref) || []) candidates.set(order.id,order);
    const purchases = [...new Map((movement.references||[]).flatMap(ref=>purchasesByReference.get(ref)||[]).map(l=>[l.id,l])).values()];
    if (candidates.size !== 1) {
      if (candidates.size===0 && purchases.length===1 && movement.kind==='sale') {
        matched.add('ledger:'+purchases[0].id);
        if (movement.package?.amount_minor!==movement.original_amount_minor || movement.package?.currency!==movement.original_currency || movement.package?.prints!==Number(purchases[0].prints_delta)) issue(movement.id,'package_cash_amount_or_units_mismatch',movement.provider);
      } else issue(movement.id,candidates.size>1?'ambiguous_order_link':'unmatched_provider_movement',movement.provider);
      continue;
    }
    const order = [...candidates.values()][0];
    if (movement.kind==='sale') {
      matched.add(order.id);
      if (int(order.total_amount_cents)!==movement.original_amount_minor || String(order.currency).toUpperCase()!==movement.original_currency) issue(order.id,'cash_amount_or_currency_mismatch',movement.provider);
      if (!['paid','refunded'].includes(order.payment_status)) issue(order.id,'provider_paid_order_not_paid',movement.provider);
      if (order.status==='cancelled' && order.payment_status!=='refunded') issue(order.id,'cancelled_order_with_cash',movement.provider);
    } else {
      const recordedRefund=meta(order).refund_evidence?.some(row=>row.provider_reference===movement.id&&row.amount_minor===movement.original_amount_minor&&row.currency===movement.original_currency);
      if (!order.refunded_at && order.payment_status!=='refunded'&&!recordedRefund) issue(order.id,'provider_refund_not_recorded_on_order',movement.provider);
      if (String(order.currency).toUpperCase()!==movement.original_currency) issue(order.id,'refund_currency_mismatch',movement.provider);
      const total=(refundedByOrder.get(order.id)||0)+movement.original_amount_minor;
      refundedByOrder.set(order.id,total);
      if(!Number.isSafeInteger(total)||int(order.total_amount_cents)===null||total>Number(order.total_amount_cents))issue(order.id,'refund_exceeds_recorded_cash',movement.provider);
    }
  }
  const periodOrders = orders.filter(o=>inside(meta(o).paid_at || o.paid_at || o.created_at,start,end) && ['paid','refunded'].includes(o.payment_status));
  const units = {purchased:0,redeemed:0,redemption_reversed:0,feedback_awarded:0};
  for (const l of ledger.filter(l=>inside(l.created_at,start,end))) {
    const delta=int(l.prints_delta); if (delta===null) { issue(l.id,'invalid_prints_delta','prints'); continue; }
    if (l.entry_type==='purchase' && delta>0) { units.purchased+=delta; if (!matched.has('ledger:'+l.id)) issue(l.id,'package_purchase_requires_provider_match','prints'); }
    if (['order_debit'].includes(l.entry_type) && delta<0) units.redeemed-=delta;
    if (['refund','order_credit','reversal'].includes(l.entry_type) && delta>0) units.redemption_reversed+=delta;
    if (meta(l).source==='feedback' && delta===5) units.feedback_awarded+=delta;
  }
  for (const o of periodOrders) {
    const spent=int(o.wallet_prints_spent)||0;
    const redeemed=debitsByOrder.has(o.id)?debitsByOrder.get(o.id):0;
    if(int(o.total_amount_cents)===null)issue(o.id,'order_cash_amount_missing');
    if (spent!==redeemed) issue(o.id,'wallet_redemption_mismatch','prints');
    if (int(o.total_amount_cents)>0 && !matched.has(o.id)) issue(o.id,'paid_order_without_period_cash_match');
    if (!meta(o).paid_at && !o.paid_at) issue(o.id,'paid_timestamp_missing_created_at_fallback');
    if (int(o.total_amount_cents)===0 && spent===0) issue(o.id,'zero_cash_order_without_wallet_evidence');
  }
  for (const claim of claims) {
    const l=ledgerById.get(claim.ledger_id);
    if (!l || Number(l.prints_delta)!==5 || l.external_reference!==`feedback:${claim.invitation_id}`) issue(claim.invitation_id,'feedback_claim_ledger_mismatch','prints');
  }
  if(!Object.values(units).every(Number.isSafeInteger))throw new Error('PRINTS total exceeds safe integer range');
  const unavailable=Object.entries(coverage).filter(([,v])=>v.status!=='available');
  const financialAvailable=['stripe','paypal'].every(key=>coverage[key]?.status==='available');
  const settled=financialAvailable && !issues.length && ['storefront','prints_ledger'].every(key=>coverage[key]?.status==='available') && coverage.reconciliation_evidence?.status!=='unavailable';
  const stripePrintsMatched=['stripe','storefront','prints_ledger'].every(key=>coverage[key]?.status==='available')
    && coverage.reconciliation_evidence?.status!=='unavailable' && !issues.some(i=>i.provider!=='paypal');
  const financials={version:METRIC_VERSION,period:{start:new Date(start).toISOString(),end:new Date(end).toISOString(),timezone:'UTC',end_exclusive:true},source:'Stripe balance movements + PayPal transaction search + storefront + PRINTS ledger',fetched_at:fetchedAt,
    status:financialAvailable?'available':'partial',coverage,currencies:[...currencies.values()].sort((a,b)=>a.currency.localeCompare(b.currency)),prints:coverage.prints_ledger?.status==='available'?units:null,
    reconciliation:{status:settled?'matched':'unreconciled',reconciled_at:settled?fetchedAt:null,issues,stripe_and_prints:{status:stripePrintsMatched?'matched':'unreconciled',excludes:'PayPal; overall coverage remains separate'},excluded_movements:excludedMovements},warnings:[...unavailable.map(([key,v])=>`${key}: ${v.reason || v.status}`),'Cash is before provider fees. Payouts and fees are listed separately; disputes, transfers and adjustments require review. PRINTS redemptions are units, never a second cash sale.']};
  const aged=orders.filter(o=>!o.archived_at && ['paid','processing','printing'].includes(o.status) && Date.parse(fetchedAt)-Date.parse(o.created_at)>agedHours*3600000).map(o=>({order_id:o.id,age_hours:Math.floor((Date.parse(fetchedAt)-Date.parse(o.created_at))/3600000),issue:'aged_order',owner:'Operations',next_action:'Review production status and customer update'}));
  const pdfFailures=orders.filter(o=>o.pdf_status==='failed' || meta(o).pdf_status==='failed' || meta(o).order_pdf_status==='failed').map(o=>({order_id:o.id,issue:'pdf_failed',owner:'Production',next_action:'Inspect PDF job and retry after correction'}));
  const now=Date.parse(fetchedAt);
  const failingHealth=health.filter(h=>h.status!=='ok' || now-Date.parse(h.checked_at)>Number(h.max_age_minutes||15)*60000);
  const cohort=events.filter(e=>e.stage==='visit' && inside(e.created_at,start,end));
  const sessions=new Set(cohort.map(e=>e.session_id));
  const visitTimes=new Map(cohort.map(e=>[e.session_id,time(e.created_at)]));
  const inCohort=e=>sessions.has(e.session_id)&&time(e.created_at)>=visitTimes.get(e.session_id)&&time(e.created_at)<visitTimes.get(e.session_id)+7*86400000;
  const stages=['visit','design_start','import_complete','preview','checkout_start','payment_confirmed'];
  const stageCounts=Object.fromEntries(stages.map(stage=>[stage,coverage.journey?.status==='available'?new Set(events.filter(e=>e.stage===stage && inCohort(e)).map(e=>e.session_id)).size:null]));
  const linked=attempts.filter(a=>sessions.has(a.session_id));
  const paymentEvents=events.filter(e=>e.stage==='payment_confirmed' && inCohort(e));
  const linkageGood=paymentEvents.every(e=>e.source==='server' && e.order_id && e.attempt_id && linked.some(a=>a.id===e.attempt_id&&a.order_id===e.order_id));
  const unlinkedAttempts=attempts.filter(a=>inside(a.created_at,start,end)&&!a.session_id).length;
  const matured=now>=end+7*86400000;
  const verified=conversionValidated && matured && linkageGood && unlinkedAttempts===0 && coverage.journey?.status==='available' && coverage.attempts?.status==='available';
  const firstPaidOrder=new Map();
  for(const o of orders.filter(o=>['paid','refunded'].includes(o.payment_status)&&o.user_id))firstPaidOrder.set(o.user_id,Math.min(firstPaidOrder.get(o.user_id)??Infinity,time(o.created_at)));
  const repeat=periodOrders.filter(o=>o.user_id && firstPaidOrder.get(o.user_id)<time(o.created_at));
  return {version:METRIC_VERSION,financials,conversion:{status:verified?'verified':'unverified',cohort:'Visits in reporting window, followed for 7 days; session counts, not people. PRINTS package purchases are outside the card-design journey.',matured,linkage_valid:linkageGood,unlinked_attempts:unlinkedAttempts,stages:stageCounts,visit_to_paid:verified&&sessions.size?stageCounts.payment_confirmed/sessions.size:null},
    operations:{aged_threshold_hours:agedHours,aged_orders:aged,pdf_failures:pdfFailures,health_failures:failingHealth,exceptions:exceptions.filter(e=>e.status!=='resolved'),shipping_readiness:'Requires operational verification; no automated holiday delivery commitments'},
    growth:{repeat_paid_orders:repeat.length,guest_repeat_customers:'unavailable_without_verified_identity',affiliate_orders:periodOrders.filter(o=>meta(o).affiliateReferralCode||o.affiliate_id).length,partner_orders:periodOrders.filter(o=>meta(o).partnerId||o.partner_id).length,experiments:ideas.map(({id,title,status,outcome,success_measure,owner})=>({id,title,status,outcome,success_measure,owner}))},
    campaigns:campaigns.map(c=>{const rows=invitations.filter(i=>i.campaign_id===c.id),ids=new Set(rows.map(i=>i.id)),completed=claims.filter(cl=>ids.has(cl.invitation_id));return{id:c.id,name:c.name,enabled:c.enabled,paused:c.paused,invitations:rows.length,completed:completed.length,prints_awarded:completed.length*5,failures:rows.filter(i=>['failed','uncertain','sending'].includes(i.status)).length,opt_outs:rows.filter(i=>i.status==='suppressed').length,email_cost_minor:rows.reduce((n,i)=>n+Number(i.send_attempts||0),0)*Number(c.email_unit_cost_minor||0),currency:c.currency,repeat_orders_after_feedback:orders.filter(o=>o.payment_status==='paid'&&completed.some(cl=>cl.user_id===o.user_id&&time(o.created_at)>time(cl.created_at))).length};})};
}
