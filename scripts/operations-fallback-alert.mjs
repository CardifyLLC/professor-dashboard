import {pathToFileURL} from 'node:url';
export async function sendFallbackAlert({env=process.env,fetchImpl=fetch}={}){
 const target=env.ALERT_URL;
 if(!target||new URL(target).protocol!=='https:')throw new Error('Configure OPERATIONS_ALERT_WEBHOOK_URL so monitor failures have an independent destination');
 const run=`https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
 const message=`TCGPlaytest reporting/PDF workflow failed. Owner: superiorvideo@gmail.com. Inspect ${run}`;
 const discord=['discord.com','discordapp.com'].includes(new URL(target).hostname);
 const response=await fetchImpl(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(discord?{content:message,allowed_mentions:{parse:[]}}:{text:message}),redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Fallback alert was not acknowledged');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await sendFallbackAlert();
