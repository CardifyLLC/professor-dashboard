import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrintsLeaderboardHandler } from '../server/prints-leaderboard.mjs';
async function run({ token='user-token', admin=true, revoked=false, sort='prints', fail=false } = {}) {
  let checks=0, calls=0;
  const createClient=(_url,key) => key === 'service' ? { rpc: async (name,args) => {
    calls++; assert.equal(name,'get_prints_leaderboard'); assert.equal(args.p_sort,sort);
    return { error: fail ? {} : null, data: [{ affiliate_id:'private-id', email:'private', display_name:'Anonymous', referral_count:2, earned_prints:10, unidentified_rewards:0 }] };
  } } : { auth: { getUser: async () => ({ data:{user:{id:'u',user_metadata:{role:'admin'}}} }) }, from() { const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:admin && !(revoked && ++checks>1) ? {user_id:'u'} : null})};return q;} };
  const handler=createPrintsLeaderboardHandler({ createClient, env:{ VITE_SUPABASE_URL:'https://example.invalid', VITE_SUPABASE_ANON_KEY:'anon', SUPABASE_SERVICE_ROLE_KEY:'service' } });
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};
  await handler({method:'GET',url:'/api/prints-leaderboard?sort='+sort,headers:token?{authorization:'Bearer '+token}:{}},res);
  return {res,calls};
}
test('logged out, ordinary users, agent tokens and service keys cannot query',async()=>{
  for(const opts of [{token:''},{admin:false},{token:'tcgp_agent_fake'},{token:'service'}]) { const {res,calls}=await run(opts); assert.ok([401,403].includes(res.statusCode)); assert.equal(calls,0); }
});
test('both sort orders return a minimal, uncached response',async()=>{
  for(const sort of ['prints','referrals']) { const {res,calls}=await run({sort}); assert.equal(res.statusCode,200); assert.equal(calls,1); assert.match(res.headers['Cache-Control'],/no-store/); assert.deepEqual(Object.keys(res.body.rows[0]),['rank','display_name','referral_count','earned_prints','unidentified_rewards']); }
});
test('invalid sort, revocation and database errors fail closed',async()=>{
  assert.equal((await run({sort:'email'})).res.statusCode,400);
  assert.equal((await run({revoked:true})).res.statusCode,403);
  assert.equal((await run({fail:true})).res.statusCode,503);
});
