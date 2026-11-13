import test from 'node:test';
import assert from 'node:assert/strict';
import {sendFallbackAlert} from './operations-fallback-alert.mjs';
test('Discord uses content and disables mentions; other webhooks use text',async()=>{
 for(const host of ['discord.com','hooks.slack.com']){
  await sendFallbackAlert({env:{ALERT_URL:'https://'+host+'/api/webhooks/test',GITHUB_REPOSITORY:'org/repo',GITHUB_RUN_ID:'123'},fetchImpl:async(_url,init)=>{
   const body=JSON.parse(init.body);assert.match(host==='discord.com'?body.content:body.text,/org\/repo\/actions\/runs\/123/);
   if(host==='discord.com')assert.deepEqual(body.allowed_mentions,{parse:[]});
   assert.equal(init.redirect,'error');return new Response(null,{status:204});
  }});
 }
 await assert.rejects(sendFallbackAlert({env:{ALERT_URL:'http://insecure.invalid'}}),/Configure/);
});
