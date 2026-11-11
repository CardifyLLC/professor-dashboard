import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const run=promisify(execFile);
const psql='C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
// Deliberately fixed to the isolated local test server. Never accepts a production URL.
const base=['-h','127.0.0.1','-p','55439','-U','reporting_test','-v','ON_ERROR_STOP=1'];
const database='feedback_concurrency_'+Date.now();
execFileSync(psql,[...base,'-d','postgres','-c',`CREATE DATABASE ${database}`]);
execFileSync(psql,[...base,'-d',database,'-f','scripts/reporting-sandbox.sql']);
let seed=readFileSync('scripts/feedback-credit-failures-sandbox.sql','utf8').split('CREATE FUNCTION pg_temp.expect_feedback_denied')[0];
seed=seed.replace("now()-interval '1 day'","now()+interval '1 day'")+'\nCOMMIT;';
execFileSync(psql,[...base,'-d',database],{input:seed});
const claim="SELECT public.complete_feedback(repeat('a',64),'00000000-0000-0000-0000-000000000002','{\"quality\":\"good\"}');";
await Promise.all([
  run(psql,[...base,'-d',database,'-c',`BEGIN; SET LOCAL ROLE service_role; ${claim} SELECT pg_sleep(0.5); COMMIT;`]),
  run(psql,[...base,'-d',database,'-c',`BEGIN; SET LOCAL ROLE service_role; ${claim} COMMIT;`]),
]);
const check=execFileSync(psql,[...base,'-d',database,'-At','-c',"SELECT (SELECT count(*) FROM feedback_claims),(SELECT count(*) FROM wallet_ledger_entries),(SELECT sum(balance) FROM wallet_accounts);"],{encoding:'utf8'}).trim();
assert.equal(check,'1|1|5');
console.log('PASS: simultaneous responses produced one claim, one ledger entry and 5 PRINTS. Sandbox: '+database);
