import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledWindows,runScheduledReports} from '../server/report-schedule.mjs';
test('UTC daily and Monday weekly windows, explicit start date and delayed-run recovery',()=>{
 assert.throws(()=>scheduledWindows(new Date(),''));
 assert.deepEqual(scheduledWindows(new Date('2026-11-16T03:19:59Z'),'2026-11-16'),[]);
 assert.deepEqual(scheduledWindows(new Date('2026-11-16T03:20:00Z'),'2026-11-16').map(w=>w.kind),['daily']);
 const due=scheduledWindows(new Date('2026-11-16T03:35:00Z'),'2026-11-16');
 assert.deepEqual(due.map(w=>w.kind),['daily','weekly']);assert.equal(due[1].start,'2026-11-09T00:00:00.000Z');
 assert.equal(scheduledWindows(new Date('2026-11-18T12:00:00Z'),'2026-11-16').length,4);
});
test('completed and uncertain reports are not regenerated; failed delivery reuses the stored report',async()=>{
 const stored={kind:'daily',financials:{period:{start:'2026-11-15T00:00:00.000Z',end:'2026-11-16T00:00:00.000Z'}}};
 const row={delivery_key:`daily:${stored.financials.period.start}:${stored.financials.period.end}:test@example.invalid`,status:'failed',report:stored,send_attempts:1};
 let deliveries=0;
 const input={db:{from:()=>({select(){return this;},async in(){return{data:[row]};},async upsert(){return{};}})},env:{REPORTING_START_DATE:'2026-11-16',REPORT_TEST_RECIPIENTS:'test@example.invalid'},now:new Date('2026-11-16T03:25:00Z'),collect:()=>assert.fail('must reuse recorded figures'),deliver:async({report})=>{assert.deepEqual(report,stored);deliveries++;return[{status:'sent'}];}};
 await runScheduledReports(input);assert.equal(deliveries,1);
 for(const status of ['sent','uncertain','sending']){row.status=status;await runScheduledReports(input);}
 assert.equal(deliveries,1);
});
