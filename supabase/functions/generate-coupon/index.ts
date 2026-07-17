import { adminAuthError, requireAdmin } from '../_shared/requireAdmin.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  try {
    await requireAdmin(req)
  } catch (error) {
    return adminAuthError(error) || json(500, { error: 'Admin authentication failed.' })
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })

  const couponAdminToken = Deno.env.get('COUPON_ADMIN_TOKEN')
  const couponAdminUrl = Deno.env.get('COUPON_ADMIN_URL') ||
    'https://professor-test.vercel.app/api/coupons/admin'

  if (!couponAdminToken) return json(500, { error: 'Missing COUPON_ADMIN_TOKEN secret.' })

  let body: { expiresAt?: string } = {}
  try {
    body = await req.json()
  } catch {
    // An empty body is valid.
  }

  const payload: Record<string, unknown> = {
    prefix: 'PLAY',
    count: 1,
    createdBy: 'professor-dashboard',
    note: 'Generated from Professor Dashboard',
  }
  if (body.expiresAt) payload.expiresAt = body.expiresAt

  try {
    const response = await fetch(couponAdminUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': couponAdminToken,
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return json(response.status, {
        error: data.error || data.message || `Coupon API error (${response.status}).`,
      })
    }

    const code = data?.coupons?.[0]?.code
    if (!code) return json(502, { error: 'Coupon API returned no coupon code.' })
    return json(200, { code })
  } catch (error) {
    return json(502, {
      error: error instanceof Error ? error.message : 'Unable to reach the coupon API.',
    })
  }
})

