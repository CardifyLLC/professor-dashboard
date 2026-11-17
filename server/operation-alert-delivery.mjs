// The database claim and trigger enforce a global per-recipient rolling limit.
// Never fall back to unrestricted delivery if the migration or claim is unavailable.
export async function deliverOperationAlert({db,recipient,items,messageForReport,sendEmail,now=new Date()}) {
  const claimed=await db.rpc('claim_operation_alert',{p_recipient:recipient,p_items:items});
  if(claimed.error||!claimed.data?.status)throw new Error('Critical alert claim unavailable');
  const row=claimed.data;
  if(row.status!=='claimed')return row;
  let status='sent',reference=null;
  try{reference=await sendEmail({to:recipient,...messageForReport(row.report)},'report-'+row.id);}
  catch(error){status=error.definitelyRejected===true?'failed':'uncertain';}
  const saved=await db.from('report_deliveries').update({status,provider_reference:reference,
    next_attempt_at:status==='failed'?new Date(+now+15*60000).toISOString():null,updated_at:now.toISOString()
  }).eq('id',row.id).eq('status','sending').select('id').maybeSingle();
  if(saved.error||!saved.data)throw new Error('Critical alert outcome uncertain; inspect provider before retry');
  return{status,id:row.id};
}

export const criticalOperation = key => /^(pdf|health|source|refund):/.test(key||'');
export const operationDeliveryFailed = outcome => ['failed','uncertain','retry_limit'].includes(outcome.status);

export async function finishOperationWebhook(db,body,now=new Date()) {
  if(!body||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id||'')||!['sent','failed','uncertain'].includes(body.status))throw new Error('Invalid webhook result');
  const result=await db.from('operation_alert_webhooks').update({status:body.status,updated_at:now.toISOString(),
    next_attempt_at:body.status==='failed'?new Date(+now+15*60000).toISOString():null
  }).eq('id',body.id).eq('status','sending').select('id').maybeSingle();
  if(result.error||!result.data)throw new Error('Webhook outcome was not recorded');
  return{status:body.status,id:body.id};
}
