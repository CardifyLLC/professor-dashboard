class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createPartnershipsHandler({ createClient, fetchImpl = fetch, env = process.env }) {
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'private, no-store');
    const send = (status, body) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    if (request.method !== 'POST') return send(405, { error: 'Method not allowed.' });
    try {
      const token = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) throw new HttpError(401, 'Sign in to the dashboard first.');
      if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new HttpError(503, 'Dashboard Supabase configuration is missing.');
      const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: auth, error: authError } = await db.auth.getUser(token);
      if (authError || !auth?.user?.id || !auth.user.email) throw new HttpError(401, 'Your admin session has expired. Sign in again.');
      const { data: admin, error: adminError } = await db.from('dashboard_admins').select('user_id').eq('user_id', auth.user.id).eq('enabled', true).maybeSingle();
      if (adminError || !admin) throw new HttpError(403, 'Administrator access required.');

      let body = request.body;
      if (body === undefined) {
        const chunks = []; let size = 0;
        for await (const chunk of request) {
          size += Buffer.byteLength(chunk);
          if (size > 16000) throw new HttpError(413, 'Request too large.');
          chunks.push(Buffer.from(chunk));
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
      if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)) > 16000) throw new HttpError(413, 'Request too large.');
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { throw new HttpError(400, 'Invalid JSON.'); }
      }
      if (!body || !['list', 'review', 'revoke'].includes(body.action)) throw new HttpError(400, 'Unsupported partnership action.');
      const payload = body.action === 'list'
        ? { action: 'list', status: body.status ?? 'all', page: body.page ?? 1 }
        : body.action === 'revoke'
          ? { action: 'revoke', id: body.id, reason: body.reason, expectedUpdatedAt: body.expectedUpdatedAt }
          : { action: 'review', id: body.id, status: body.status, approvedPercentage: body.approvedPercentage, adminNotes: body.adminNotes, expectedUpdatedAt: body.expectedUpdatedAt };
      // Never accept a reviewer identity, destination, or server credential from the browser.
      payload.reviewer = { userId: auth.user.id, email: auth.user.email };
      const origin = env.PARTNER_PLATFORM_ORIGIN, secret = env.PARTNER_INTERNAL_SECRET;
      if (!origin || !secret || secret.length < 32) throw new HttpError(503, 'Configure PARTNER_PLATFORM_ORIGIN and PARTNER_INTERNAL_SECRET on the dashboard Vercel project.');
      const result = await fetchImpl(`${origin.replace(/\/$/, '')}/api/internal/partnerships`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(55000),
      });
      if (result.status === 404) throw new HttpError(503, 'Deploy the updated partner app to enable partnership requests in this dashboard.');
      const data = await result.json();
      if (!result.ok) throw new HttpError(result.status, data.error?.message || 'Could not load or review partnership requests.');
      return send(200, data);
    } catch (error) {
      return send(error instanceof HttpError ? error.status : 502, {
        error: error instanceof HttpError ? error.message : 'Could not confirm the response from the partner app. Refresh before retrying a decision.',
      });
    }
  };
}
