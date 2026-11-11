import { readAll } from './report-sources.mjs';
import { validateCampaign } from '../shared/feedback-campaign.mjs';

export function evaluateEligibility({order:o,campaign:c,profiles,subscribers,orders,invitations,now=Date.now()}) {
  const reasons=[];
  const profile=profiles.find(p=>p.id===o.user_id);
  const email=profile?.email||o.customer_email||null;
  if(!o.user_id||!profile)reasons.push('Missing account link');
  if(o.payment_status!=='paid')reasons.push('Payment not paid');
  if(o.refunded_at||o.status==='cancelled')reasons.push('Order refunded or cancelled');
  if(!c.qualifying_statuses?.includes(o.status))reasons.push('Order status does not qualify');
  if(!profile?.email||!subscribers.some(s=>s.email?.toLowerCase()===profile.email.toLowerCase()&&s.status==='subscribed'&&s.consented_at&&s.consent_text?.trim()))reasons.push('Missing marketing consent');
  const trigger=o[c.timing_trigger]??o.metadata?.[c.timing_trigger];
  const timestamp=Date.parse(trigger);
  if(!Number.isFinite(timestamp))reasons.push('Missing campaign timing timestamp');
  else if(timestamp>now-Number(c.delay_days)*86400000)reasons.push('Waiting for campaign delay');
  const prior=orders.some(p=>p.user_id===o.user_id&&p.id!==o.id&&p.payment_status==='paid'&&Date.parse(p.created_at)<Date.parse(o.created_at));
  if(!['all_consented_customers','first_order_customers','repeat_customers'].includes(c.audience)||(c.audience==='first_order_customers'&&prior)||(c.audience==='repeat_customers'&&!prior))reasons.push('Outside campaign audience');
  const own=invitations.filter(i=>i.user_id===o.user_id);
  const campaignInvites=invitations.filter(i=>i.campaign_id===c.id);
  if(campaignInvites.some(i=>i.order_id===o.id))reasons.push('Already invited for this campaign');
  if(own.some(i=>Date.parse(i.created_at)>now-Number(c.invitation_frequency_days)*86400000))reasons.push('Invitation frequency limit');
  if(campaignInvites.filter(i=>i.user_id===o.user_id).length>=c.reward_limit_per_customer)reasons.push('Customer invitation limit');
  if(campaignInvites.length>=c.max_invitations||(campaignInvites.length+1)*5>c.budget_prints||(campaignInvites.length+1)*c.email_unit_cost_minor>c.budget_email_minor||(campaignInvites.reduce((n,i)=>n+i.send_attempts,0)+1)*c.email_unit_cost_minor>c.budget_email_minor)reasons.push('Campaign budget or invitation limit');
  return {order_id:o.id,email,account_linked:Boolean(o.user_id&&profile),payment_status:o.payment_status,order_status:o.status,eligible:reasons.length===0,reasons};
}

export async function feedbackEligibility(db,campaignId,env){
  const campaignResult=await db.from('feedback_campaigns').select('*').eq('id',campaignId).single();
  if(campaignResult.error||!campaignResult.data)throw new Error('Campaign unavailable');
  const campaign=campaignResult.data;
  const [orders,profiles,subscribers,invitations]=await Promise.all([
    readAll(db,'orders'),readAll(db,'profiles','id,email'),
    readAll(db,'marketing_subscribers','email,status,consented_at,consent_text',q=>q,'email'),
    readAll(db,'feedback_invitations','id,campaign_id,order_id,user_id,status,created_at,send_attempts'),
  ]);
  const blockers=[];
  try{validateCampaign(campaign);}catch{blockers.push('Campaign configuration incomplete');}
  if(!campaign.enabled||campaign.paused)blockers.push('Campaign disabled or paused');
  if(env.FEEDBACK_DELIVERY_READY!=='true')blockers.push('Email delivery setup not enabled');
  const now=Date.now();
  return {checked_at:new Date(now).toISOString(),blockers,rows:orders.map(order=>evaluateEligibility({order,campaign,profiles,subscribers,orders,invitations,now})),note:'Read-only eligibility check. Sending must recheck current eligibility and delivery configuration.'};
}
