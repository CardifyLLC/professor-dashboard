const production='https://dunoesykjvdnpeavojsi.supabase.co';
export async function feedbackEdge({env,token,body,fetchImpl=fetch}){
  if(env.VITE_SUPABASE_URL!==production)throw new Error('Production feedback requires the production database.');
  const response=await fetchImpl(production+'/functions/v1/send-feedback-invitation',{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(55000),
  });
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Feedback Edge Function unavailable. Check its deployment and refresh invitation status before retrying.');
  return result;
}
