export async function requireAdmin(request: Request) {
  if (request.method === 'OPTIONS') return { id: 'preflight', email: '' }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!supabaseUrl || !serviceRoleKey) throw new Error('ADMIN_CONFIG_MISSING')
  if (!token || token === serviceRoleKey) throw new Error('UNAUTHORIZED')
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${token}` } })
  if (!userResponse.ok) throw new Error('UNAUTHORIZED')
  const user = await userResponse.json()
  if (!user?.id || !user?.email) throw new Error('UNAUTHORIZED')
  const response = await fetch(`${supabaseUrl}/rest/v1/dashboard_admins?user_id=eq.${encodeURIComponent(user.id)}&enabled=eq.true&select=user_id&limit=1`, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } })
  const admins = response.ok ? await response.json() : []
  if (!admins?.length) throw new Error('FORBIDDEN')
  return { id: user.id as string, email: user.email as string }
}

export function adminAuthError(error: unknown): Response | null {
  const code = error instanceof Error ? error.message : ''
  if (code === 'UNAUTHORIZED') return Response.json({ error: 'Authentication required.' }, { status: 401 })
  if (code === 'FORBIDDEN') return Response.json({ error: 'Administrator access required.' }, { status: 403 })
  if (code === 'ADMIN_CONFIG_MISSING') return Response.json({ error: 'Admin authentication is not configured.' }, { status: 500 })
  return null
}
