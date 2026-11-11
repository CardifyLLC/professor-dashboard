const target=process.env.ALERT_URL;
if(!target||new URL(target).protocol!=='https:')throw new Error('Configure OPERATIONS_ALERT_WEBHOOK_URL so monitor failures have an independent destination');
const run=`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:`TCGPlaytest reporting/PDF workflow failed. Owner: superiorvideo@gmail.com. Inspect ${run}`}),redirect:'error',signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error('Fallback alert was not acknowledged');
