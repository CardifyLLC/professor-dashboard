import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('real PostgreSQL migrations preserve facts, enforce server success and deduplicate transitions',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
   CREATE TABLE orders(id uuid PRIMARY KEY,user_id uuid,status text,payment_status text,total_amount_cents bigint,currency text,stripe_session_id text,paypal_order_id text,paypal_capture_id text,wallet_prints_spent bigint,required_prints bigint,refunded_at timestamptz,created_at timestamptz DEFAULT now(),metadata jsonb DEFAULT '{}');
   CREATE TABLE wallet_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,account_code text,balance bigint DEFAULT 0,lifetime_credited bigint DEFAULT 0,status text DEFAULT 'active',updated_at timestamptz,UNIQUE(user_id,account_code));
   CREATE TABLE wallet_ledger_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wallet_account_id uuid,user_id uuid,entry_type text,prints_delta bigint,resulting_print_balance bigint,related_order_id uuid,external_reference text,note text,metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
   GRANT SELECT,INSERT,UPDATE,DELETE ON orders,wallet_accounts,wallet_ledger_entries TO service_role;`);
  await db.exec(await readFile(new URL('../database/reporting-workflows.draft.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../database/reporting-v2.sql',import.meta.url),'utf8'));
  await db.exec(`SET ROLE service_role;
   INSERT INTO orders(id,status,payment_status,total_amount_cents,currency,required_prints,wallet_prints_spent,metadata) VALUES('00000000-0000-0000-0000-000000000001','pending','pending',500,'usd',10,0,'{"checkout_attempt_id":"00000000-0000-0000-0000-000000000001","analytics_session_id":"00000000-0000-0000-0000-000000000002"}');
   SELECT record_client_journey('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','visit');
   SELECT record_client_journey('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','visit');
   SELECT record_client_journey('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','visit');
   UPDATE orders SET payment_status='paid',status='paid';`);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM journey_events WHERE stage='payment_confirmed'")).rows[0].count,0);
  await db.exec(`INSERT INTO wallet_ledger_entries(entry_type,prints_delta,related_order_id) VALUES('order_debit',-10,'00000000-0000-0000-0000-000000000001'); UPDATE orders SET wallet_prints_spent=10; UPDATE orders SET wallet_prints_spent=10;`);
  const events=(await db.query('SELECT stage,count(*)::int AS count FROM journey_events GROUP BY stage ORDER BY stage')).rows;
  assert.deepEqual(events,[{stage:'checkout_start',count:1},{stage:'payment_confirmed',count:1},{stage:'visit',count:1}]);
  await assert.rejects(db.query("SELECT record_client_journey(gen_random_uuid(),gen_random_uuid(),'payment_confirmed')"),/Invalid client stage/);
  await db.exec('RESET ROLE; SET ROLE anon;');
  await assert.rejects(db.query('SELECT * FROM journey_events'),/permission denied/);
  await assert.rejects(db.query("SELECT record_client_journey(gen_random_uuid(),gen_random_uuid(),'visit')"),/permission denied/);
  await db.exec('RESET ROLE; SET ROLE service_role; DELETE FROM wallet_ledger_entries; DELETE FROM orders;');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM reporting_order_facts WHERE archived_at IS NOT NULL')).rows[0].count,1);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM reporting_ledger_facts')).rows[0].count,1);
  assert.ok((await db.query('SELECT metadata FROM reporting_order_facts')).rows[0].metadata.paid_at);
  // Full synthetic cash journey: all browser stages, one server checkout, and
  // success only after trusted payment confirmation. Abandonment is not a sale.
  await db.exec(`SELECT record_client_journey(gen_random_uuid(),'00000000-0000-0000-0000-000000000010',stage)
   FROM unnest(ARRAY['visit','design_start','import_complete','preview','checkout_abandoned']) stage;
   INSERT INTO orders(id,status,payment_status,total_amount_cents,currency,required_prints,wallet_prints_spent,metadata)
   VALUES('00000000-0000-0000-0000-000000000011','pending','pending',100,'USD',0,0,'{"checkout_attempt_id":"00000000-0000-0000-0000-000000000011","analytics_session_id":"00000000-0000-0000-0000-000000000010"}');
   UPDATE orders SET payment_status='failed' WHERE id='00000000-0000-0000-0000-000000000011';`);
  assert.equal((await db.query("SELECT count(*)::int n FROM journey_events WHERE session_id='00000000-0000-0000-0000-000000000010' AND stage='payment_confirmed'")).rows[0].n,0);
  await db.exec(`UPDATE orders SET payment_status='paid',status='paid' WHERE id='00000000-0000-0000-0000-000000000011';
   UPDATE orders SET payment_status='paid' WHERE id='00000000-0000-0000-0000-000000000011';`);
  const journey=(await db.query("SELECT stage,count(*)::int n FROM journey_events WHERE session_id='00000000-0000-0000-0000-000000000010' GROUP BY stage")).rows;
  for(const stage of ['visit','design_start','import_complete','preview','checkout_start','payment_confirmed'])assert.equal(journey.find(row=>row.stage===stage)?.n,1,stage);
  const first=(await db.query("SELECT open_operation_exception('health:test',null,'failure','Owner','Inspect') AS item")).rows[0].item;
  const repeat=(await db.query("SELECT open_operation_exception('health:test',null,'failure','Owner','Inspect') AS item")).rows[0].item;
  assert.equal(first.id,repeat.id);assert.equal(first.version,repeat.version);
  await db.query("UPDATE operation_exceptions SET status='resolved' WHERE id=$1",[first.id]);
  const reopened=(await db.query("SELECT open_operation_exception('health:test',null,'failure','Owner','Inspect') AS item")).rows[0].item;
  assert.equal(reopened.version,first.version+1);
 }finally{await db.close();}
});
