import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deliverFeedback,feedbackToken} from '../server/feedback-delivery.mjs';

const secret='sandbox-only-secret-at-least-32-characters';
const invitationId='00000000-0000-0000-0000-000000000004';
function fixture({suppressed=false,persistFailure=false}={}){
  let status='pending';let sends=0;
  const db={
    async rpc(){
      if(suppressed||!['pending','failed'].includes(status))return{data:null};
      status='sending';
      return{data:{email:'sandbox@example.invalid',subject:'Feedback',text:'Please share feedback',token_hash:createHash('sha256').update(feedbackToken(invitationId,secret)).digest('hex')}};
    },
    from(){return{update(change){return{eq(){return this;},select(){return this;},async maybeSingle(){
      if(persistFailure)return{error:new Error('storage unavailable')};
      status=change.status;return{data:{id:invitationId}};
    }}}};},
  };
  const args={db,invitationId,secret,origin:'https://example.invalid',unsubscribeUrl:()=> 'https://example.invalid/unsubscribe',sendEmail:async()=>{sends++;}};
  return{args,get status(){return status;},get sends(){return sends;}};
}
test('duplicate workers send one invitation and retain fragment token',async()=>{
  const f=fixture();let message;
  const args={...f.args,sendEmail:async email=>{message=email;await f.args.sendEmail(email);}};
  await Promise.all([deliverFeedback(args),deliverFeedback(args)]);
  assert.equal(f.sends,1);assert.equal(f.status,'sent');
  assert.match(message.text,/\/feedback#token=[a-f0-9]{64}/);
  assert.match(message.text,/does not subscribe/);
});
test('suppressed or paused invitations never reach mail provider',async()=>{
  const f=fixture({suppressed:true});await deliverFeedback(f.args);assert.equal(f.sends,0);
});
test('ambiguous provider failure is retained for review and never automatically resent',async()=>{
  const f=fixture();let calls=0;
  const args={...f.args,sendEmail:async()=>{calls++;throw new Error('network timeout');}};
  assert.equal((await deliverFeedback(args)).status,'uncertain');
  await deliverFeedback(args);assert.equal(calls,1);
});
test('definite rejection permits retry without treating failed mail as sent',async()=>{
  const f=fixture();
  assert.equal((await deliverFeedback({...f.args,sendEmail:async()=>{throw Object.assign(new Error('rejected'),{retrySafe:true});}})).status,'failed');
  assert.equal((await deliverFeedback(f.args)).status,'sent');assert.equal(f.sends,1);
});
test('database failure after email keeps claim locked against duplicate delivery',async()=>{
  const f=fixture({persistFailure:true});
  await assert.rejects(deliverFeedback(f.args),/outcome uncertain/);
  await deliverFeedback(f.args);assert.equal(f.sends,1);assert.equal(f.status,'sending');
});
test('rotated signing key cannot send an unusable invitation',async()=>{
  const f=fixture();await assert.rejects(deliverFeedback({...f.args,secret:secret+'rotated'}),/Signing key mismatch/);
  assert.equal(f.sends,0);
});
