import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {criticalOperation,operationDeliveryFailed,deliverOperationAlert} from '../server/operation-alert-delivery.mjs';
import {sendOperationOverflow} from './operation-overflow-webhook.mjs';

const migration=await readFile(new URL('../supabase/migrations/20261117100331_operation_alert_limits.sql',import.meta.url),'utf8');
const permissions=await readFile(new URL('../supabase/migrations/20261117101402_operation_alert_permissions.sql',import.meta.url),'utf8');
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
async function fixture(before=''){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
 CREATE TABLE operation_health(id text PRIMARY KEY,max_age_minutes int);
 CREATE TABLE operation_exceptions(id uuid PRIMARY KEY,version int NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'open',source_key text,issue text,owner text,next_action text);
 CREATE TABLE report_deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),delivery_key text UNIQUE NOT NULL,recipient text NOT NULL,status text NOT NULL DEFAULT 'pending',report jsonb NOT NULL,provider_reference text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),send_attempts int NOT NULL DEFAULT 0,next_attempt_at timestamptz);
 GRANT SELECT,INSERT,UPDATE ON operation_exceptions,report_deliveries,operation_health TO service_role;
 ${before}`);
 await db.exec(migration+permissions);
 return db;
}
async function item(db,n,category='pdf'){
 await db.query('INSERT INTO operation_exceptions(id,source_key,issue,owner,next_action) VALUES($1,$2,$3,$4,$5)',[uuid(n),category+':'+n,'Fixture issue','Operations','Review']);
 return{id:uuid(n),version:1};
}
async function claim(db,items,recipient='owner@example.invalid'){
 return(await db.query('SELECT public.claim_operation_alert($1,$2::jsonb) AS value',[recipient,JSON.stringify(items)])).rows[0].value;
}

test('atomic claims cap overlapping jobs at two; old sender code cannot bypass the trigger',async()=>{
 const db=await fixture();try{
  const items=await Promise.all([1,2,3].map(n=>item(db,n)));
  await db.exec('SET ROLE service_role');
  const outcomes=await Promise.all(items.map(i=>claim(db,[i])));
  assert.equal(outcomes.filter(o=>o.status==='claimed').length,2);assert.equal(outcomes.filter(o=>o.status==='daily_limit').length,1);
  const {rows}=await db.query('SELECT count(*)::int count FROM operation_alert_attempts');assert.equal(rows[0].count,2);
  await db.exec("INSERT INTO report_deliveries(delivery_key,recipient,report) VALUES('alert:legacy-bypass','owner@example.invalid','{}')");
  await assert.rejects(db.exec("UPDATE report_deliveries SET status='sending',send_attempts=1 WHERE delivery_key='alert:legacy-bypass'"),/two attempts/);
  assert.equal((await db.query("SELECT status FROM report_deliveries WHERE delivery_key='alert:legacy-bypass'")).rows[0].status,'pending');
  assert.equal((await claim(db,[items[2]],'second@example.invalid')).status,'claimed','different recipient has an independent allowance');
 }finally{await db.close();}
});

test('unchanged, shrinking and uncertain incident sets never resend; normal reports do not consume quota',async()=>{
 const db=await fixture();try{
  const a=await item(db,1),b=await item(db,2),routine=await item(db,3,'aged');
  const first=await claim(db,[a,b,routine]);assert.equal(first.report.exceptions.length,2);
  assert.equal((await claim(db,[a,b])).status,'unchanged');
  await db.query("UPDATE report_deliveries SET status='uncertain' WHERE id=$1",[first.id]);
  assert.equal((await claim(db,[b])).status,'unchanged');
  await db.exec("INSERT INTO report_deliveries(delivery_key,recipient,report,status,send_attempts) VALUES('daily:fixture','owner@example.invalid','{}','sending',1)");
  assert.equal((await db.query('SELECT count(*)::int count FROM operation_alert_attempts')).rows[0].count,1);
  assert.equal((await claim(db,[routine])).status,'unchanged');
  await db.query('UPDATE operation_exceptions SET version=2 WHERE id=$1',[a.id]);
  assert.equal((await claim(db,[{...a,version:2}])).status,'claimed','reopened incident is a new event');
 }finally{await db.close();}
});

test('failed attempts consume allowance; recovery after 24h does not replay already notified issues',async()=>{
 const db=await fixture();try{
  const a=await item(db,1),b=await item(db,2);
  const first=await claim(db,[a]);await db.query("UPDATE report_deliveries SET status='failed' WHERE id=$1",[first.id]);
  const retry=await claim(db,[a]);assert.equal(retry.id,first.id);
  await db.query("UPDATE report_deliveries SET status='uncertain' WHERE id=$1",[first.id]);
  assert.equal((await claim(db,[b])).status,'daily_limit');
  await db.exec("UPDATE operation_alert_attempts SET attempted_at=now()-interval '25 hours'");
  assert.equal((await claim(db,[a,b])).status,'claimed');
  const last=(await db.query("SELECT report FROM report_deliveries WHERE id<>$1 ORDER BY created_at DESC LIMIT 1",[first.id])).rows[0];
  assert.equal(last.report.exceptions.length,1);assert.equal(last.report.exceptions[0].id,b.id);
 }finally{await db.close();}
});

test('migration includes prior alerts and restricts both quota and webhook records to service access',async()=>{
 const db=await fixture("INSERT INTO report_deliveries(delivery_key,recipient,status,report,send_attempts) VALUES('alert:before-1','owner@example.invalid','sent','{}',1),('alert:before-2','owner@example.invalid','uncertain','{}',1)");try{
  const a=await item(db,1);assert.equal((await claim(db,[a])).status,'daily_limit');
  await db.exec('SET ROLE authenticated');
  await assert.rejects(claim(db,[a]),/permission denied/);
  await assert.rejects(db.query('SELECT * FROM operation_alert_attempts'),/permission denied/);
  await assert.rejects(db.query('SELECT * FROM operation_alert_webhooks'),/permission denied/);
  await db.exec('RESET ROLE;SET ROLE service_role');
  await assert.rejects(db.exec('DELETE FROM operation_alert_attempts'),/permission denied/);
  const first=(await db.query('SELECT public.claim_operation_alert_webhook($1::jsonb) value',[JSON.stringify([a])])).rows[0].value;
  assert.equal(first.status,'claimed');assert.equal(first.count,1);
  assert.equal((await db.query('SELECT public.claim_operation_alert_webhook($1::jsonb) value',[JSON.stringify([a])])).rows[0].value.status,'unchanged');
 }finally{await db.close();}
});

test('claim errors fail closed, limits and routine classifications are not job failures',async()=>{
 assert.ok(criticalOperation('pdf:123'));assert.ok(criticalOperation('refund:123'));
 for(const key of ['aged:123','shipping:123','feedback:123','generation:123','delivery:123'])assert.equal(criticalOperation(key),false);
 for(const status of ['sent','unchanged','daily_limit','retry_deferred','queued_delivery_disabled'])assert.equal(operationDeliveryFailed({status}),false);
 for(const status of ['failed','uncertain','retry_limit'])assert.equal(operationDeliveryFailed({status}),true);
 await assert.rejects(deliverOperationAlert({db:{rpc:async()=>({error:{}})},recipient:'a@example.invalid',items:[],sendEmail:()=>assert.fail('must fail closed')}),/claim unavailable/);
});

test('overflow uses aggregate-only webhook messages and records uncertain sends without retrying',async()=>{
 const notice={id:uuid(1),count:3},env={ALERT_URL:'https://discord.com/api/webhooks/fixture',DASHBOARD_APP_URL:'https://dashboard.invalid'},recorded=[];
 let calls=0;
 await sendOperationOverflow({notice,env,record:async row=>recorded.push(row),fetchImpl:async(url,init)=>{calls++;const body=JSON.parse(init.body);assert.match(body.content,/3 additional critical/);assert.deepEqual(body.allowed_mentions,{parse:[]});return new Response(null,{status:204});}});
 assert.equal(recorded[0].status,'sent');assert.equal(calls,1);
 await assert.rejects(sendOperationOverflow({notice,env,record:async row=>recorded.push(row),fetchImpl:async()=>{calls++;throw new Error('timeout');}}),/delivery review/);
 assert.equal(recorded[1].status,'uncertain');assert.equal(calls,2);
});

test('workflow checks reports hourly and health every half hour',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/reporting-operations.yml',import.meta.url),'utf8');
 assert.deepEqual([...workflow.matchAll(/cron: '([^']+)'/g)].map(m=>m[1]),['11 * * * *','41 * * * *']);
 assert.match(workflow,/name: Run reporting job\s+if: github.event_name != 'schedule' \|\| github.event.schedule == '41 \* \* \* \*'/);
 assert.match(workflow,/name: Monitor operations\s+if: always\(\) && github.event_name == 'schedule'/);
});
