import {createClient} from '@supabase/supabase-js';
const status=process.argv[2];
if(!['ok','failed'].includes(status))throw new Error('Use ok or failed');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const result=await db.from('operation_health').upsert({id:'pdf-worker',status,checked_at:new Date().toISOString(),max_age_minutes:150,owner:process.env.OPERATIONS_OWNER||'superiorvideo@gmail.com',detail:status==='ok'?'PDF worker run completed':'PDF workflow failed; inspect GitHub Actions run'});
if(result.error)throw new Error('Could not persist PDF heartbeat');
