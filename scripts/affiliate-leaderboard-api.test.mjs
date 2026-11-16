import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readSection } from '../server/section-reader.mjs';
import { createAgentReadHandler } from '../server/agent-access.mjs';
import { TEAM_PERMISSION_IDS, TEAM_MEMBER_PERMISSION_IDS } from '../shared/team-permissions.mjs';
import { PGlite } from '@electric-sql/pglite';

const SECTION = 'affiliate-leaderboard';
const key = 'tcgp_agent_' + 'A'.repeat(43);
const agent = '00000000-0000-4000-8000-000000000001';
const version = '00000000-0000-4000-8000-000000000002';
const row = (n=1) => ({ affiliate_id: `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`, display_name: 'Affiliate '+n, earned_prints: 1000, referral_count: 12, unidentified_rewards: 0 });
const params = extra => new URLSearchParams('section='+SECTION+(extra ? '&'+extra : ''));

test('same Discord RPC and rank order, max 15, fixed fields without customer or wallet data', async () => {
  const fixture = Array.from({length:20}, (_,i) => ({...row(i+1), earned_prints: String(1000-i), email:'private@example.com', user_id:'private-profile', balance:999, metadata:{secret:'private'}}));
  let calls = 0;
  const result = await readSection({rpc:async name => { calls++; assert.equal(name,'get_affiliate_leaderboard'); return {data:fixture}; }},params());
  assert.equal(calls,1);
  assert.equal(result.rows.length,15);
  assert.deepEqual(result.rows.map(r=>r.id),fixture.slice(0,15).map(r=>r.affiliate_id));
  assert.deepEqual(result.rows.map(r=>r.rank),Array.from({length:15},(_,i)=>i+1));
  assert.equal(result.rows[0].earned_prints,'1000');
  assert.equal(result.rows[0].referral_count,'12');
  assert.equal(result.rows[0].referrals_complete,true);
  assert.equal(result.period,'all_time');
  assert.equal(result.nextOffset,null);
  assert.doesNotMatch(JSON.stringify(result),/private|balance|metadata/);
});

test('whole bigint strings are preserved and missing-customer rewards are explained',async()=>{
  const result = await readSection({rpc:async()=>({data:[{...row(),earned_prints:'9007199254740993',unidentified_rewards:'2'}]})},params('offset=0&q='));
  assert.equal(result.rows[0].earned_prints,'9007199254740993');
  assert.equal(result.rows[0].referrals_complete,false);
  assert.match(result.notes.join(' '),/referral counts may be incomplete/);
});

test('empty history is a valid empty list, not a provider failure',async()=>{
  const result = await readSection({rpc:async()=>({data:[]})},params());
  assert.deepEqual(result.rows,[]);
  assert.equal(result.nextOffset,null);
});

test('invalid data and RPC failures cannot masquerade as zero rewards',async()=>{
  for (const data of [null,{},[null],[{...row(),earned_prints:null}],[{...row(),referral_count:-1}],[{...row(),earned_prints:9007199254740992}],[{...row(),earned_prints:'1e3'}],[{...row(),unidentified_rewards:undefined}]]) {
    await assert.rejects(readSection({rpc:async()=>({data})},params()),e=>e.status===503);
  }
  await assert.rejects(readSection({rpc:async()=>({error:{message:'private database details'}})},params()),e=>e.status===503 && !e.message.includes('private'));
});

test('unsupported filters, duplicate parameters and arbitrary queries never reach the RPC',async()=>{
  let calls=0;
  const db = {rpc:()=>{calls++;throw new Error('Unexpected access');}};
  for(const query of ['offset=1','offset=-1','offset=1.5','q=alice','q=%20','id='+agent,'from=2026-11-01T00:00:00.000Z','before=2026-11-15T00:00:00.000Z','status=all','limit=100','table=profiles','select=*','section=orders','offset=0&offset=0']) {
    await assert.rejects(readSection(db,params(query)),e=>e.status===400,query);
  }
  assert.equal(calls,0);
});

async function request({permissions=[SECTION],status='ok',method='GET',authorization='Bearer '+key,revoked=false,changed=false,rpcError=false,query='',retry_after=60}={}) {
  const events=[]; let reads=0; let authCalls=0;
  const db = {
    async rpc(name, args) {
      if(name==='authorize_agent_section_read') {
        authCalls++;
        assert.equal(args.p_section,SECTION);
        return {data:{status:status==='ok'&&!permissions.includes(SECTION)?'forbidden':status,agent_id:agent,permissions,permissions_version:version,retry_after}};
      }
      assert.equal(name,'get_affiliate_leaderboard'); reads++;
      return rpcError ? {error:{message:'private database failure'}} : {data:[row()]};
    },
    from(table) {
      if(table==='agent_access_events') return {insert:async event=>{events.push(event);return {data:null};}};
      assert.equal(table,'agent_access_keys');
      const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{revoked_at:revoked?'2026-11-16T00:00:00Z':null,permissions_version:changed?agent:version}})};
      return q;
    },
  };
  const response={headers:{},setHeader(name,value){this.headers[name]=value;},end(value){this.body=JSON.parse(value);}};
  await createAgentReadHandler({createClient:()=>db,env:{VITE_SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key'}})(
    {method,url:'/api/agent-read?section='+SECTION+query,headers:{authorization}},response);
  return {...response,events,reads,authCalls};
}

test('authorized key receives the leaderboard, no-store headers and read audit',async()=>{
  const result=await request();
  assert.equal(result.statusCode,200);
  assert.equal(result.body.rows.length,1);
  assert.equal(result.headers['Cache-Control'],'private, no-store');
  assert.equal(result.events[0].section,SECTION);
  assert.equal(result.events[0].outcome,200);
});

test('affiliate applications permission alone never grants leaderboard access',async()=>{
  const result=await request({permissions:['affiliates']});
  assert.equal(result.statusCode,403);
  assert.equal(result.reads,0);
  assert.equal(result.events[0].outcome,403);
});

test('missing and invalid credentials, revoked key, and writes are rejected',async()=>{
  for(const authorization of ['', 'Bearer service-role-test', 'Bearer tcgp_agent_short']) {
    const result=await request({authorization}); assert.equal(result.statusCode,401); assert.equal(result.authCalls,0); assert.equal(result.reads,0);
  }
  const revoked=await request({status:'unauthorized'}); assert.equal(revoked.statusCode,401); assert.equal(revoked.reads,0);
  const write=await request({method:'POST'}); assert.equal(write.statusCode,405); assert.equal(write.authCalls,0); assert.equal(write.reads,0);
});

test('shared rate limit and permission changes are enforced',async()=>{
  const limited=await request({status:'rate_limited',retry_after:17});
  assert.equal(limited.statusCode,429); assert.equal(limited.headers['Retry-After'],'17'); assert.equal(limited.reads,0);
  const revoked=await request({revoked:true}); assert.equal(revoked.statusCode,401); assert.equal(revoked.body.rows,undefined);
  const changed=await request({changed:true}); assert.equal(changed.statusCode,403); assert.equal(changed.body.rows,undefined);
});

test('handler reports RPC failure and audits invalid requests without leaking details',async()=>{
  const failed=await request({rpcError:true}); assert.equal(failed.statusCode,503); assert.doesNotMatch(JSON.stringify(failed.body),/private/);
  const invalid=await request({query:'&q=test'}); assert.equal(invalid.statusCode,400); assert.equal(invalid.reads,0); assert.equal(invalid.events[0].outcome,400);
});

test('OpenAPI makes the new section discoverable and gives it a distinct response schema',async()=>{
  const spec=JSON.parse(await readFile(new URL('../public/agent-openapi.json',import.meta.url),'utf8'));
  const get=spec.paths['/api/agent-read'].get;
  assert.ok(get.parameters.find(p=>p.name==='section').schema.enum.includes(SECTION));
  assert.ok(get.responses['200'].content['application/json'].schema.oneOf.some(r=>r.$ref.endsWith('/AffiliateLeaderboard')));
  assert.ok(!spec.components.schemas.SectionPage.properties.section.enum.includes(SECTION));
  const result=await readSection({rpc:async()=>({data:[row()]})},params());
  const schema=spec.components.schemas.AffiliateLeaderboard;
  assert.deepEqual(Object.keys(result).sort(),schema.required.toSorted());
  assert.deepEqual(Object.keys(result.rows[0]).sort(),schema.properties.rows.items.required.toSorted());
});

test('migration preserves existing grants, permits the new section and retains restrictions',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE agent_access_keys(id int primary key,permissions text[] not null, constraint agent_access_keys_sections_check check(cardinality(permissions) between 1 and 9));
      CREATE TABLE dashboard_viewers(id int primary key,permissions text[] not null, constraint dashboard_viewers_permissions_check check(cardinality(permissions) between 1 and 11));
      ALTER TABLE agent_access_keys ENABLE ROW LEVEL SECURITY; ALTER TABLE dashboard_viewers ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION get_affiliate_leaderboard() RETURNS SETOF text LANGUAGE sql AS $$ SELECT 'fixture'::text $$;
      INSERT INTO agent_access_keys VALUES(1,ARRAY['orders']); INSERT INTO dashboard_viewers VALUES(1,ARRAY['orders','order-downloads','batcher']);`);
    const sql=await readFile(new URL('../supabase/migrations/20261116152404_affiliate_leaderboard_access.sql',import.meta.url),'utf8');
    await db.exec(sql); await db.exec(sql);
    assert.deepEqual((await db.query('SELECT permissions FROM agent_access_keys WHERE id=1')).rows[0].permissions,['orders']);
    assert.deepEqual((await db.query('SELECT permissions FROM dashboard_viewers WHERE id=1')).rows[0].permissions,['orders','order-downloads','batcher']);
    await db.query('INSERT INTO agent_access_keys VALUES(2,$1)',[[SECTION]]);
    await db.query('INSERT INTO agent_access_keys VALUES(3,$1)',[TEAM_PERMISSION_IDS]);
    await db.query('INSERT INTO dashboard_viewers VALUES(2,$1)',[TEAM_MEMBER_PERMISSION_IDS]);
    for(const permissions of [[],[null],['unknown'],['order-downloads'],['batcher']]) await assert.rejects(db.query('INSERT INTO agent_access_keys VALUES(4,$1)',[permissions]));
    for(const permissions of [[],[null],['unknown'],['order-downloads'],[SECTION,'order-downloads']]) await assert.rejects(db.query('INSERT INTO dashboard_viewers VALUES(4,$1)',[permissions]));
    const tables=await db.query("SELECT relrowsecurity FROM pg_class WHERE relname in ('agent_access_keys','dashboard_viewers')");
    assert.ok(tables.rows.every(r=>r.relrowsecurity));
  } finally {await db.close();}
});
