import { getAdminAuthHeaders } from './supabaseClient';

export async function trackingRequest(body) {
  const headers = await getAdminAuthHeaders();
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shipment-tracking`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(65000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Tracking request failed. Refresh the review and send history.');
  return result;
}
