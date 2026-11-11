import {createHmac} from 'node:crypto';
import {prepareFeedback,deliverFeedback,feedbackToken} from './feedback-delivery.mjs';
import {createEnvelopeMailer} from '../supabase/functions/_shared/envelope-mailer.mjs';
import {validateCampaign} from '../shared/feedback-campaign.mjs';
export function deliveryBlockers(env){
  const reasons=[];
  if(env.VITE_SUPABASE_URL!=='https://jsxkyzdijoawzaiwfkfc.supabase.co')reasons.push('Targeted test sending requires the testing database');
  if(env.FEEDBACK_DELIVERY_READY!=='true')reasons.push('FEEDBACK_DELIVERY_READY must be true');
  if(env.CUSTOMER_APP_URL!=='https://testing123-prof.vercel.app')reasons.push('CUSTOMER_APP_URL must be https://testing123-prof.vercel.app');
  try{feedbackToken('check',env.FEEDBACK_SIGNING_SECRET);}catch{reasons.push('FEEDBACK_SIGNING_SECRET must contain at least 32 characters');}
  if(!(env.MARKETING_UNSUBSCRIBE_SECRET||env.MARKETING_SYNC_SECRET))reasons.push('Missing unsubscribe signing secret');
  try{const account=JSON.parse(env.GMAIL_SERVICE_ACCOUNT_JSON);if(!account.client_email||!account.private_key)throw new Error();}catch{reasons.push('Missing or invalid Gmail service account configuration');}
  return reasons;
}
export async function sendTargetedFeedback({db,env,campaignId,orderId,expectedEmail,prepareMailer=()=>createEnvelopeMailer({env:name=>env[name]}).prepare()}){
  const blockers=deliveryBlockers(env);if(blockers.length)throw new Error(blockers.join('; '));
  const c=await db.from('feedback_campaigns').select('*').eq('id',campaignId).single();
  if(c.error||!c.data?.enabled||c.data.paused)throw new Error('Campaign must be approved and enabled first.');
  validateCampaign(c.data);
  const o=await db.from('orders').select('id,user_id').eq('id',orderId).single();
  if(o.error||!o.data?.user_id)throw new Error('Order has no linked account.');
  const p=await db.from('profiles').select('email').eq('id',o.data.user_id).single();
  if(p.error||!p.data?.email||p.data.email.toLowerCase()!==expectedEmail.toLowerCase())throw new Error('Recipient changed. Refresh eligibility before sending.');
  const existing=await db.from('feedback_invitations').select('id,status').eq('campaign_id',campaignId).eq('order_id',orderId).maybeSingle();
  if(existing.error)throw new Error('Cannot check previous delivery.');
  if(existing.data)return {sent:false,status:existing.data.status,already_exists:true};
  const mailer=await prepareMailer();
  const invitation=await prepareFeedback({db,campaignId,orderId,secret:env.FEEDBACK_SIGNING_SECRET});
  // A concurrent request may have prepared the same order after the check above.
  if(invitation.already_prepared)return {sent:false,status:'already_prepared',already_exists:true};
  return deliverFeedback({db,invitationId:invitation.id,secret:env.FEEDBACK_SIGNING_SECRET,origin:env.CUSTOMER_APP_URL,expectedEmail,
    sendEmail:async email=>{try{return await mailer.send(email,'feedback-'+invitation.id);}catch(error){error.retrySafe=error.definitelyRejected===true;throw error;}},
    unsubscribeUrl:email=>{const normalized=email.trim().toLowerCase();const token=createHmac('sha256',env.MARKETING_UNSUBSCRIBE_SECRET||env.MARKETING_SYNC_SECRET).update(normalized).digest('hex');return env.CUSTOMER_APP_URL+'/unsubscribe?'+new URLSearchParams({email:normalized,token});},
  });
}
