import { getAdminAuthHeaders } from './supabaseClient';

export async function partnershipRequest(body, signal) {
  const response = await fetch('/api/partnerships', {
    method: 'POST', headers: { ...await getAdminAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store', signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'Partnership requests are unavailable. Check that both updated apps are deployed.');
  return data;
}
