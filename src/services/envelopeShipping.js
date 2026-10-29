import { getAdminAuthHeaders } from './supabaseClient';

export async function shipEnvelope(orderId) {
  const headers = await getAdminAuthHeaders();
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ship-envelope`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }), signal: AbortSignal.timeout(65000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Shipping could not be confirmed. Refresh the order before trying again.');
  return result;
}
