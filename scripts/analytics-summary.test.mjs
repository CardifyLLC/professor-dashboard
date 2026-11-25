import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsSummaryHandler } from '../server/analytics-summary.mjs';

async function request({ token='user-token', admin=true, verified=true, revoked=false, authFails=false, databaseFails=false, rows=[], url='/api/analytics-summary?days=7', method='GET' }={}){
  const calls=[],headers={}; let checks=0, serviceCreated=0;
  const createClient=(_url,key)=> {
    if(key==='service-key'){
      serviceCreated++;
      return {from(table){
        const q={select:()=>q,limit(n){q.size=n;return q;},order:()=>q,gte(column,value){q.cutoff={column,value};return q;},
          then(resolve,reject){calls.push({table,size:q.size,cutoff:q.cutoff}); return Promise.resolve({data:rows,error:databaseFails?{}:null}).then(resolve,reject);}};
        return q;
      }};
    }
    return {
      auth:{getUser:async()=>({data:verified?{user:{id:'user',user_metadata:{role:'admin'}}}:null,error:authFails?{status:500}:verified?null:{status:401}})},
      from(){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:admin && !(revoked && ++checks>1)?{user_id:'user'}:null})};return q;},
    };
  };
  const handler=createAnalyticsSummaryHandler({createClient,env:{VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-key'}});
  const response={setHeader(k,v){headers[k]=v;},end(body){this.body=JSON.parse(body);}};
  await handler({method,url,headers:token?{authorization:'Bearer '+token}:{}},response);
  return {response,headers,calls,serviceCreated};
}
test('logged-out, forged admin metadata, expired sessions and service tokens cannot read summaries',async()=>{
  for(const options of [{token:''},{admin:false},{verified:false},{token:'service-key'},{token:'tcgp_agent_fake'}]){
    const r=await request(options); assert.ok([401,403].includes(r.response.statusCode)); assert.equal(r.serviceCreated,0); assert.equal(r.calls.length,0);
  }
});
test('verified administrator gets all five bounded summaries and no-store headers',async()=>{
  const r=await request({rows:[{n:12}]}); assert.equal(r.response.statusCode,200); assert.equal(r.calls.length,5);
  assert.deepEqual(r.response.body.design.data,[{n:12}]); assert.ok(r.calls.every(c=>c.size===1000 && c.cutoff));
  assert.match(r.headers['Cache-Control'],/no-store/); assert.equal(r.headers['Vercel-CDN-Cache-Control'],'no-store');
});
test('revocation before response discards privileged results',async()=>{
  const r=await request({revoked:true,rows:[{private:'data'}]}); assert.equal(r.response.statusCode,403); assert.equal(r.response.body.design,undefined);
});
test('invalid parameters and unsupported methods do not query views',async()=>{
  for(const options of [{url:'/api/analytics-summary?days=31'},{url:'/api/analytics-summary?days=7&days=30'},{url:'/api/analytics-summary?table=profiles'},{method:'POST'}]){
    const r=await request(options); assert.ok([400,405].includes(r.response.statusCode)); assert.equal(r.calls.length,0);
  }
});
test('outages and truncated datasets are explicit errors rather than zero or partial totals',async()=>{
  const auth=await request({authFails:true}); assert.equal(auth.response.statusCode,503); assert.equal(auth.calls.length,0);
  for(const options of [{databaseFails:true},{rows:Array(1000).fill({n:1})}]){
    const r=await request(options); assert.ok(r.response.body.design.error); assert.equal(r.response.body.design.data,undefined);
  }
});

