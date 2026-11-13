import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('review is audited once, preserves attempt cap, and only requeues confirmed non-acceptance',async()=>{
 const db=new PGlite(),actor='00000000-0000-0000-0000-000000000001',delivery='00000000-0000-0000-0000-000000000002';
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;GRANT USAGE ON SCHEMA public TO service_role;
   CREATE TABLE dashboard_admins(user_id uuid PRIMARY KEY,enabled boolean);
   CREATE TABLE report_deliveries(id uuid PRIMARY KEY,status text,updated_at timestamptz,provider_reference text,next_attempt_at timestamptz,send_attempts int);
   GRANT SELECT ON dashboard_admins TO service_role;GRANT SELECT,UPDATE ON report_deliveries TO service_role;
   INSERT INTO dashboard_admins VALUES('${actor}',true);
   INSERT INTO report_deliveries(id,status,updated_at,send_attempts) VALUES('${delivery}','uncertain',now(),2);`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261113202351_report_delivery_review.sql',import.meta.url),'utf8'));
  await db.exec('SET ROLE authenticated;');
  await assert.rejects(db.query('SELECT review_report_delivery($1,$2,$3,$4,$5)',[delivery,actor,'accepted','fixture','Synthetic provider investigation']),/permission denied/);
  await db.exec('RESET ROLE;SET ROLE service_role;');
  const params=[delivery,actor,'not_accepted','fixture-provider-reference','Synthetic confirmed rejection'];
  await db.query('SELECT review_report_delivery($1,$2,$3,$4,$5)',params);
  const row=(await db.query('SELECT * FROM report_deliveries')).rows[0];
  assert.equal(row.status,'failed');assert.equal(row.send_attempts,2);assert.ok(Date.parse(row.next_attempt_at)>Date.now());
  await assert.rejects(db.query('SELECT review_report_delivery($1,$2,$3,$4,$5)',params),/not awaiting/);
  assert.equal((await db.query('SELECT count(*)::int n FROM report_delivery_reviews')).rows[0].n,1);
  await assert.rejects(db.exec('DELETE FROM report_delivery_reviews'),/permission denied/);
  await db.exec("UPDATE report_deliveries SET status='sending',updated_at=now();");
  await assert.rejects(db.query('SELECT review_report_delivery($1,$2,$3,$4,$5)',params),/not awaiting/);
  await db.exec("UPDATE report_deliveries SET updated_at=now()-interval '31 minutes';");
  await db.query('SELECT review_report_delivery($1,$2,$3,$4,$5)',[delivery,actor,'accepted','receipt','Synthetic accepted message']);
  assert.equal((await db.query('SELECT status FROM report_deliveries')).rows[0].status,'sent');
 }finally{await db.close();}
});
