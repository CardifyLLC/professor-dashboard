import { useState } from 'react';
const numbers={delay_days:'Days after order',invitation_frequency_days:'Minimum days between invitations',reward_limit_per_customer:'Reward claims per customer',expires_after_days:'Invitation expiry in days',max_invitations:'Maximum invitations',budget_prints:'PRINTS budget',budget_email_minor:'Email budget in minor currency units',email_unit_cost_minor:'Cost per email in minor currency units'};
export default function FeedbackCampaignEditor({campaign,busy,onSave}){
  const [draft,setDraft]=useState(campaign);
  const [questions,setQuestions]=useState((campaign.questionnaire||[]).map(q=>q.label).join('\n'));
  const [statuses,setStatuses]=useState((campaign.qualifying_statuses||[]).join(', '));
  return <details><summary>Configure campaign</summary><form onSubmit={event=>{
    event.preventDefault();const config={...draft,qualifying_statuses:statuses.split(',').map(s=>s.trim()).filter(Boolean),questionnaire:questions.split('\n').filter(s=>s.trim()).map((label,index)=>({id:`q${index+1}`,label:label.trim()}))};
    for(const key of Object.keys(numbers))config[key]=draft[key]===''||draft[key]==null?null:Number(draft[key]);
    onSave({action:'save_campaign',id:campaign.id,version:campaign.version,config});
  }}>
    <p>Saving keeps delivery disabled and clears any previous approval. Reward: 5 PRINTS per verified response.</p>
    <label>Timing trigger<select required value={draft.timing_trigger||''} onChange={event=>setDraft({...draft,timing_trigger:event.target.value})}><option value="">Choose a trigger</option>{['created_at','paid_at','shipped_at','completed_at'].map(trigger=><option key={trigger} value={trigger}>{trigger.replaceAll('_',' ')}</option>)}</select></label>
    {Object.entries(numbers).map(([key,label])=><label key={key} style={{display:'block',margin:'8px 0'}}>{label}<input required type="number" min={key.endsWith('_minor')?0:1} step="1" value={draft[key]??''} onChange={event=>setDraft({...draft,[key]:event.target.value})}/></label>)}
    {['email_subject','email_text','currency'].map(key=><label key={key} style={{display:'block',margin:'8px 0'}}>{key.replaceAll('_',' ')}<textarea required value={draft[key]||''} onChange={event=>setDraft({...draft,[key]:event.target.value})}/></label>)}
    <label>Audience<select required value={draft.audience||''} onChange={event=>setDraft({...draft,audience:event.target.value})}><option value="">Choose an audience</option>{['all_consented_customers','first_order_customers','repeat_customers'].map(audience=><option key={audience} value={audience}>{audience.replaceAll('_',' ')}</option>)}</select></label><label style={{display:'block'}}>Qualifying statuses, separated by commas<input required placeholder="Choose: paid, processing, shipped, completed" value={statuses} onChange={event=>setStatuses(event.target.value)}/></label>
    <label style={{display:'block'}}>Questionnaire — one required question per line<textarea required value={questions} onChange={event=>setQuestions(event.target.value)}/></label>
    <button disabled={busy}>Save disabled configuration</button>
  </form></details>;
}
