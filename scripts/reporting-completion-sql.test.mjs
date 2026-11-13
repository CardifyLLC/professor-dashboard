import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('migration preserves immutable provider evidence and one decision audit per version',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;GRANT USAGE ON SCHEMA public TO service_role;
   CREATE TABLE reporting_order_facts(id uuid PRIMARY KEY);
   CREATE TABLE report_deliveries(id uuid PRIMARY KEY,status text);
   CREATE TABLE feedback_campaigns(id uuid PRIMARY KEY,enabled boolean,paused boolean,qualifying_statuses text[],email_unit_cost_minor bigint,budget_email_minor bigint,email_subject text,email_text text);
   CREATE TABLE feedback_invitations(id uuid PRIMARY KEY,campaign_id uuid,order_id uuid,user_id uuid,status text,expires_at timestamptz,send_attempts int,token_hash text);
   CREATE TABLE orders(id uuid PRIMARY KEY,user_id uuid,payment_status text,status text,refunded_at timestamptz);
   CREATE TABLE profiles(id uuid PRIMARY KEY,email text);
   CREATE TABLE marketing_subscribers(email text,status text,consented_at timestamptz,consent_text text);
   CREATE TABLE growth_ideas(id uuid PRIMARY KEY,status text,version int,decided_by uuid,decided_at timestamptz,outcome text);
   GRANT SELECT,INSERT,UPDATE ON growth_ideas TO service_role;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261113193531_reporting_completion.sql',import.meta.url),'utf8'));
  await db.exec(`INSERT INTO reporting_order_facts VALUES('00000000-0000-0000-0000-000000000001');
   SET ROLE service_role;
   INSERT INTO reporting_reconciliation_evidence(order_id,provider,provider_reference,event_kind,occurred_at,amount_minor,currency,evidence)
   VALUES('00000000-0000-0000-0000-000000000001','stripe','stripe:txn','sale',now(),100,'USD','{}');`);
  await assert.rejects(db.exec('UPDATE reporting_reconciliation_evidence SET amount_minor=200'),/permission denied/);
  await assert.rejects(db.exec('DELETE FROM reporting_reconciliation_evidence'),/permission denied/);
  await db.exec(`INSERT INTO growth_ideas(id,status,version) VALUES('00000000-0000-0000-0000-000000000001','pending',1);
   UPDATE growth_ideas SET status='approved',version=2,decided_by='00000000-0000-0000-0000-000000000002',decided_at=now() WHERE version=1;
   UPDATE growth_ideas SET status='approved',version=2,decided_by='00000000-0000-0000-0000-000000000002',decided_at=now() WHERE version=1;
   UPDATE growth_ideas SET status='completed',version=3,outcome='Synthetic completed' WHERE version=2;`);
  const audit=(await db.query('SELECT status,previous_status FROM growth_decision_events ORDER BY version')).rows;
  assert.deepEqual(audit,[{status:'approved',previous_status:'pending'},{status:'completed',previous_status:'approved'}]);
  await assert.rejects(db.exec("UPDATE growth_ideas SET status='pending',version=4"),/Invalid decision/);
  await db.exec('RESET ROLE;SET ROLE authenticated;');
  await assert.rejects(db.exec('SELECT * FROM reporting_reconciliation_evidence'),/permission denied/);
 }finally{await db.close();}
});
