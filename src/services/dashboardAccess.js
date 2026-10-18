import { getAdminAuthHeaders } from './supabaseClient';

export async function dashboardAccessRequest(path = '/api/dashboard-access?mode=session', body, signal) {
  const headers = await getAdminAuthHeaders();
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', headers: { ...headers, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store', credentials: 'omit', signal: signal || AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(data?.error || 'Could not reach dashboard access. Check the deployment and try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}
