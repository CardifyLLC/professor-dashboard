export function validateCampaign(input) {
  const result={};
  if(!['created_at','paid_at','shipped_at','completed_at'].includes(input.timing_trigger))throw new Error('Choose the timing trigger.');
  result.timing_trigger=input.timing_trigger;
  for(const name of ['delay_days','invitation_frequency_days','reward_limit_per_customer','expires_after_days','max_invitations','budget_prints','budget_email_minor','email_unit_cost_minor']){
    const value=input[name];
    if(!Number.isSafeInteger(value)||value<(name.endsWith('_minor')?0:1))throw new Error(`Provide a valid ${name}.`);
    result[name]=value;
  }
  if(result.delay_days>365||result.budget_prints<5)throw new Error('Timing or reward budget is invalid.');
  for(const name of ['audience','email_subject','email_text','currency']){
    if(typeof input[name]!=='string'||!input[name].trim()||input[name].length>10000)throw new Error(`Provide ${name}.`);
    result[name]=input[name].trim();
  }
  if(!/^[A-Z]{3}$/.test(result.currency))throw new Error('Use a three-letter currency.');
  if(!['all_consented_customers','first_order_customers','repeat_customers'].includes(result.audience))throw new Error('Choose a supported customer audience.');
  if(!Array.isArray(input.qualifying_statuses)||!input.qualifying_statuses.length||input.qualifying_statuses.some(s=>!['paid','processing','shipped','completed'].includes(s)))throw new Error('Choose qualifying paid order statuses.');
  if(!Array.isArray(input.questionnaire)||!input.questionnaire.length||input.questionnaire.length>20||input.questionnaire.some(q=>!q||!/^[a-zA-Z0-9_-]{1,50}$/.test(q.id)||typeof q.label!=='string'||!q.label.trim()||q.label.length>500)||new Set(input.questionnaire.map(q=>q.id)).size!==input.questionnaire.length)throw new Error('Provide unique, labelled questionnaire questions.');
  result.qualifying_statuses=[...new Set(input.qualifying_statuses)];result.questionnaire=input.questionnaire.map(q=>({id:q.id,label:q.label.trim()}));
  return {...result,enabled:false,paused:true,approved_by:null,approved_at:null,reward_prints:5};
}
