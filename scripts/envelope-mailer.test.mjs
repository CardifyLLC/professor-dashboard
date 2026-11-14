import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEnvelopeMessage} from '../supabase/functions/_shared/envelope-mailer.mjs';
const email={to:'reader@example.invalid',subject:'Report — £12.34',text:'Cash after refunds: £12.34\nDetails follow.'};
test('plain-text callers retain the existing format, including empty bodies',()=>{
  const raw=buildEnvelopeMessage(email,'order-1','sender@example.invalid');
  assert.match(raw,/Content-Type: text\/plain; charset=utf-8/);
  assert.doesNotMatch(raw,/multipart|text\/html/);
  assert.equal(Buffer.from(raw.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString(),email.text);
  assert.doesNotThrow(()=>buildEnvelopeMessage({...email,text:''},'empty','sender@example.invalid'));
});
test('HTML reports include both complete UTF-8 MIME alternatives with legal line lengths',()=>{
  const html='<html><body><h1>Cash — £12.34</h1><p>'+'Details '.repeat(100)+'</p></body></html>';
  const raw=buildEnvelopeMessage({...email,html},'report-1','sender@example.invalid');
  const boundary=raw.match(/boundary="([^"]+)"/)[1];
  const parts=raw.split('--'+boundary).slice(1,-1);
  assert.equal(parts.length,2);
  for(const [index,part] of parts.entries()){
    const content=part.split('\r\n\r\n')[1].trim(),lines=content.split('\r\n');
    assert.ok(lines.every(line=>line.length<=76));
    assert.equal(Buffer.from(lines.join(''),'base64').toString('utf8'),index?html:email.text);
  }
  assert.match(parts[0],/text\/plain/);assert.match(parts[1],/text\/html/);
  assert.ok(raw.endsWith('--'+boundary+'--\r\n'));
});
test('mail headers cannot inject recipients or extra headers',()=>{
  assert.throws(()=>buildEnvelopeMessage({...email,subject:'Report\r\nBcc: attacker@example.invalid'},'test','sender@example.invalid'));
  assert.throws(()=>buildEnvelopeMessage(email,'test\r\nBcc: attacker@example.invalid','sender@example.invalid'));
});
