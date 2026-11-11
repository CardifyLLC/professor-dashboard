// Reuse from the existing report scheduler; no second daily schedule is installed.
const kind=process.argv[2]||'daily';
if(!['daily','weekly','health'].includes(kind))throw new Error('Use daily, weekly or health');
const origin=process.env.DASHBOARD_APP_URL,secret=process.env.REPORTING_JOB_SECRET;
if(!origin||new URL(origin).protocol!=='https:'||!secret||secret.length<32)throw new Error('Reporting origin/job secret missing');
const url=new URL('/api/reporting-job',origin);url.searchParams.set('kind',kind);
if(process.argv[3])url.searchParams.set('date',process.argv[3]);
const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret},redirect:'error',signal:AbortSignal.timeout(290000)});
if(!response.ok)throw new Error(`Reporting job failed (${response.status}); inspect durable delivery state before retry`);
console.log('Reporting job completed:',kind);
