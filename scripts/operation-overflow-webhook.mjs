// Executed in GitHub Actions, where the existing webhook secret already lives.
// Only aggregate counts and the dashboard link leave the reporting service.
export async function sendOperationOverflow({notice,env=process.env,fetchImpl=fetch,record}) {
  if(!notice)return;
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(notice.id||'')||!Number.isInteger(notice.count)||notice.count<1)throw new Error('Invalid overflow notification');
  let status='failed';
  try{
    const target=new URL(env.ALERT_URL),dashboard=new URL(env.DASHBOARD_APP_URL);
    if(target.protocol!=='https:'||dashboard.protocol!=='https:')throw new Error('HTTPS notification configuration required');
    const text=`TCGPlaytest: ${notice.count} additional critical issue(s) need attention. The email limit has been reached. Review ${dashboard.origin}/ in Growth and operations.`;
    const discord=['discord.com','discordapp.com'].includes(target.hostname);
    status='uncertain';
    const response=await fetchImpl(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify(discord?{content:text,allowed_mentions:{parse:[]}}:{text})});
    // A server error or transport interruption may occur after acceptance.
    status=response.ok?'sent':response.status<500?'failed':'uncertain';
  }catch{ /* Missing config is failed; ambiguous network outcomes remain uncertain. */ }
  await record({id:notice.id,status});
  if(status!=='sent')throw new Error('Overflow notification needs delivery review');
}
