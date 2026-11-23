import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdAttributionHandler } from '../server/ad-attribution.mjs';
import { acquisitionCsv } from '../src/services/acquisitionCsv.mjs';

async function request({ token='user-token', admin=true, verified=true, url='/api/ad-attribution?source=reddit', dbError=false, rows=[] }={}) {
  const calls=[];
  const createClient = (_url, key) => key==='service-key' ? { rpc(name,args) { calls.push({ name,args }); return { abortSignal: async()=>({data:rows,error:dbError?{}:null}) }; } } : {
    auth: { getUser: async()=>({data:verified?{user:{id:'user-id'}}:{},error:verified?null:{}}) },
    from:()=>{ const q={ select:()=>q,eq:()=>q,maybeSingle:async()=>({data:admin?{user_id:'user-id'}:null}) }; return q; },
  };
  const handler=createAdAttributionHandler({createClient,env:{VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-key'}});
  const response={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=JSON.parse(body)}};
  await handler({method:'GET',headers:{authorization: token ? `Bearer ${token}` : ''},url},response);
  return {response,calls};
}
test('anonymous, unverified and non-admin requests cannot read attribution',async()=>{
  for(const input of [{token:''},{verified:false},{admin:false},{token:'service-key'}]) {
    const {response,calls}=await request(input);
    assert.ok([401,403].includes(response.statusCode)); assert.equal(calls.length,0);
  }
});
test('admin report preserves filters and uses bounded keyset pages',async()=>{
  const rows=Array.from({length:500},(_,i)=>({account_id:`id-${i}`,profile_created_at:'2026-11-23T00:00:00Z'}));
  const {response,calls}=await request({url:'/api/ad-attribution?source=reddit&campaign=nov2026&content=mtg_retrodeckhook',rows});
  assert.equal(response.statusCode,200);
  assert.equal(calls[0].args.p_limit,500); assert.equal(calls[0].args.p_source,'reddit');
  assert.equal(calls[0].args.p_campaign,'nov2026'); assert.equal(response.body.next.before_id,'id-499');
  assert.match(response.headers['Cache-Control'],/no-store/);
});
test('invalid filters and cursors are rejected before querying account data',async()=>{
  for(const url of ['/api/ad-attribution?source=a&source=b','/api/ad-attribution?before=bad','/api/ad-attribution?unknown=1']) {
    const {response,calls}=await request({url}); assert.equal(response.statusCode,400); assert.equal(calls.length,0);
  }
});
test('query failures produce an error instead of partial or zero totals',async()=>{
  const {response}=await request({dbError:true}); assert.equal(response.statusCode,503); assert.equal(response.body.rows,undefined);
});
test('CSV quotes fields, preserves line breaks, and neutralizes spreadsheet formulas',()=>{
  const csv=acquisitionCsv([{full_name:'=HYPERLINK("https://example.invalid")',email:'a,b@example.invalid',acq_first_content:'line1\nline2',paid_order_count:2}]);
  assert.ok(csv.startsWith('\ufeff')); assert.ok(csv.includes('"\'=HYPERLINK(""https://example.invalid"")"'));
  assert.ok(csv.includes('"a,b@example.invalid"')); assert.ok(csv.includes('"line1\nline2"'));
});
