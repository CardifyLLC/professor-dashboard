import { getAdminAuthHeaders } from './supabaseClient';

export async function agentAccessRequest({ action, name, id, offset = 0, agent } = {}) {
  const headers = await getAdminAuthHeaders();
  const query = agent ? '?agent=' + encodeURIComponent(agent) : '?offset=' + offset;
  const response = await fetch('/api/agent-access' + (action ? '' : query), {
    method: action ? 'POST' : 'GET',
    headers: { ...headers, 'Content-Type': 'application/json' },
    ...(action ? { body: JSON.stringify(action === 'create' ? { action, name } : { action, id }) } : {}),
    cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(45000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Agent Access could not be reached. Check the dashboard deployment.');
  return result;
}
