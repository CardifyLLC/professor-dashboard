const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function createAdAttributionHandler({ createClient, env = process.env }) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    if (request.method !== 'GET') return send(405, { error: 'Method not allowed.' });
    try {
      const token = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token || token === env.SUPABASE_SERVICE_ROLE_KEY) return send(401, { error: 'Sign in to the dashboard.' });
      const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY;
      if (!url || !anon || !env.SUPABASE_SERVICE_ROLE_KEY) return send(503, { error: 'Dashboard server configuration is missing.' });
      const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } };
      const client = createClient(url, anon, options);
      const { data: auth, error: authError } = await client.auth.getUser(token);
      if (authError || !auth?.user?.id) return send(401, { error: 'Your session has expired.' });
      const { data: admin, error: adminError } = await client.from('dashboard_admins').select('user_id').eq('user_id', auth.user.id).eq('enabled', true).maybeSingle();
      if (adminError || !admin) return send(403, { error: 'Administrator access required.' });
      const params = new URL(request.url, 'https://dashboard.invalid').searchParams;
      const allowed = ['source','campaign','content','before','before_id'];
      if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1 || params.get(key).length > 100)) return send(400, { error: 'Invalid report filters.' });
      const before = params.get('before'), beforeId = params.get('before_id');
      if (Boolean(before) !== Boolean(beforeId) || (before && (!Number.isFinite(Date.parse(before)) || !UUID.test(beforeId)))) return send(400, { error: 'Invalid report cursor.' });
      const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await db.rpc('acquisition_accounts_report', {
        p_source: params.get('source') || null, p_campaign: params.get('campaign') || null, p_content: params.get('content') || null,
        p_before: before || null, p_before_id: beforeId || null, p_limit: 500,
      }).abortSignal(AbortSignal.timeout(20000));
      if (error || !Array.isArray(data)) return send(503, { error: 'Attribution report unavailable. Check that the attribution migration is installed.' });
      const last = data.at(-1);
      return send(200, { rows: data, next: data.length === 500 ? { before: last.profile_created_at, before_id: last.account_id } : null });
    } catch {
      return send(503, { error: 'Could not load the attribution report. Please retry.' });
    }
  };
}
