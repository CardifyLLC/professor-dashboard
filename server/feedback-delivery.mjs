import {createHmac,createHash,randomUUID} from 'node:crypto';
import { createEnvelopeMailer } from '../supabase/functions/_shared/envelope-mailer.mjs';
export function feedbackToken(id,secret){if(typeof secret!=='string'||secret.length<32)throw new Error('Feedback signing secret is not configured.');return createHmac('sha256',secret).update('feedback:'+id).digest('hex');}
export async function prepareFeedback({db,campaignId,orderId,secret}){
  const id=randomUUID();const token=feedbackToken(id,secret);
  const result=await db.rpc('prepare_feedback_invitation',{p_campaign:campaignId,p_order:orderId,p_invitation:id,p_token_hash:createHash('sha256').update(token).digest('hex')});
  if(result.error)throw new Error('Invitation not eligible or unavailable.');return result.data;
}
export async function deliverFeedback({db,invitationId,secret,origin,sendEmail,unsubscribeUrl}){
  const token=feedbackToken(invitationId,secret);
  if(new URL(origin).protocol!=='https:')throw new Error('HTTPS customer origin required.');
  const claimed=await db.rpc('claim_feedback_send',{p_invitation:invitationId});
  if(claimed.error)throw new Error('Could not verify invitation eligibility.');
  if(!claimed.data)return{sent:false,reason:'paused_suppressed_expired_or_already_claimed'};
  const invitation=claimed.data;
  if(createHash('sha256').update(token).digest('hex')!==invitation.token_hash)throw new Error('Signing key mismatch; invitation retained for review.');
  let status='sent';
  try{
    await sendEmail({to:invitation.email,subject:invitation.subject,text:`${invitation.text}\n\n${origin.replace(/\/$/,'')}/feedback#token=${token}\n\nUnsubscribe: ${unsubscribeUrl(invitation.email)}\n\nCompleting feedback does not subscribe you to marketing.`});
  }catch(error){status=error?.retrySafe===true?'failed':'uncertain';}
  const saved=await db.from('feedback_invitations').update({status,...(status==='sent'?{sent_at:new Date().toISOString()}:{})}).eq('id',invitationId).eq('status','sending').select('id').maybeSingle();
  if(saved.error||!saved.data)throw new Error('Delivery outcome uncertain; inspect mail provider before retrying.');
  return{sent:status==='sent',status};
}

// Called by the approved admin endpoint. No new schedule or unsolicited delivery is enabled.
export async function runFeedbackBatch({db,campaignId,after,env}){
  const campaign=await db.from('feedback_campaigns').select('enabled,paused').eq('id',campaignId).single();
  if(campaign.error||!campaign.data?.enabled||campaign.data.paused)throw new Error('Campaign disabled.');
  const origin=env.CUSTOMER_APP_URL;
  const secret=env.FEEDBACK_SIGNING_SECRET;
  const unsubscribeSecret=env.MARKETING_UNSUBSCRIBE_SECRET||env.MARKETING_SYNC_SECRET;
  if(!origin||!unsubscribeSecret)throw new Error('Customer origin and unsubscribe configuration required.');
  feedbackToken('configuration-check',secret);
  // Prepare provider authentication before claiming any send.
  const mailer=await createEnvelopeMailer({env:name=>env[name]}).prepare();
  let query=db.from('orders').select('id').eq('payment_status','paid').order('id').limit(3);
  if(after)query=query.gt('id',after);
  const orders=await query;if(orders.error)throw new Error('Order selection unavailable.');
  const results=[];
  for(const order of orders.data){
    try{
      const invitation=await prepareFeedback({db,campaignId,orderId:order.id,secret});
      const result=await deliverFeedback({db,invitationId:invitation.id,secret,origin,
        sendEmail:async email=>{try{return await mailer.send(email,'feedback-'+invitation.id);}catch(error){error.retrySafe=error.definitelyRejected===true;throw error;}},
        unsubscribeUrl:email=>{
          const normalized=email.trim().toLowerCase();const token=createHmac('sha256',unsubscribeSecret).update(normalized).digest('hex');
          return origin.replace(/\/$/,'')+'/unsubscribe?'+new URLSearchParams({email:normalized,token});
        },
      });results.push({order_id:order.id,...result});
    }catch{results.push({order_id:order.id,status:'not_sent',reason:'Eligibility or delivery check failed; inspect the invitation before retrying.'});}
  }
  return{results,nextCursor:orders.data.length===3?orders.data.at(-1).id:null};
}
