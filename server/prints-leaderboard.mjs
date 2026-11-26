import { createDashboardAuthorization, DashboardAccessError } from './dashboard-access.mjs';
export function createPrintsLeaderboardHandler({ createClient, env = process.env, fetchImpl = fetch }) {
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'private, no-store');
    const send = (status, body) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    if (request.method !== 'GET') return send(405, { error: 'Use GET.' });
    try {
      const deadline = AbortSignal.timeout(15000);
      const access = createDashboardAuthorization({ createClient, env, fetchImpl: (url, init = {}) => fetchImpl(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline }) });
      const identity = await access.authenticate(request);
      if (!identity.admin) return send(403, { error: 'Administrator access required.' });
      const sort = new URL(request.url, 'https://dashboard.invalid').searchParams.get('sort') || 'prints';
      if (!['prints', 'referrals'].includes(sort)) return send(400, { error: 'Invalid ranking.' });
      const { data, error } = await access.db().rpc('get_prints_leaderboard', { p_sort: sort });
      if (error) throw error;
      await access.recheck(identity);
      return send(200, { rows: (data || []).map((row, index) => ({ rank: index + 1, display_name: row.display_name, referral_count: row.referral_count, earned_prints: row.earned_prints, unidentified_rewards: row.unidentified_rewards })) });
    } catch (error) {
      return send(error instanceof DashboardAccessError ? error.status : 503, { error: 'Leaderboard unavailable. Verify your administrator session and try again.' });
    }
  };
}
