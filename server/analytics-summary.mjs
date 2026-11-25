import { createDashboardAuthorization, DashboardAccessError } from './dashboard-access.mjs';

const SOURCES = {
  design: ['v_design_funnel_summary', 'day'],
  order: ['v_order_funnel_summary', 'day'],
  features: ['v_feature_adoption', 'week'],
  nps: ['v_nps_summary', 'week'],
  errors: ['v_error_summary', 'day'],
};

export function createAnalyticsSummaryHandler({ createClient, env = process.env, fetchImpl = fetch }) {
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    if (request.method !== 'GET') return send(405, { error: 'Use GET.' });
    try {
      const deadline = AbortSignal.timeout(25000);
      const boundedFetch = (url, init = {}) => fetchImpl(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
      const access = createDashboardAuthorization({ createClient, env, fetchImpl: boundedFetch });
      const identity = await access.authenticate(request);
      if (!identity.admin) return send(403, { error: 'Administrator access required.' });
      const params = new URL(request.url, 'https://dashboard.invalid').searchParams;
      const days = params.get('days') || '30';
      if ([...params.keys()].some(key => key !== 'days' || params.getAll(key).length !== 1)
          || !['7', '14', '30', 'all'].includes(days)) return send(400, { error: 'Invalid analytics range.' });
      const cutoff = new Date(); cutoff.setUTCHours(0, 0, 0, 0);
      if (days !== 'all') cutoff.setUTCDate(cutoff.getUTCDate() - (Number(days) - 1));
      const results = {};
      // Sequential, bounded queries avoid a five-query burst. Never present capped
      // results as complete totals. The original views remain the data source.
      for (const [key, [table, column]] of Object.entries(SOURCES)) {
        if (deadline.aborted) throw new Error('Analytics timeout');
        let query = access.db().from(table).select('*').limit(1000);
        if (column) {
          query = query.order(column, { ascending: false });
          if (days !== 'all') query = query.gte(column, cutoff.toISOString());
        }
        const { data, error } = await query;
        results[key] = error || !Array.isArray(data) || data.length >= 1000
          ? { error: 'Summary unavailable or too large; choose a shorter range.' } : { data };
      }
      await access.recheck(identity);
      return send(200, results);
    } catch (error) {
      return send(error instanceof DashboardAccessError ? error.status : 503,
        { error: 'Analytics unavailable. Verify your administrator session and server configuration.' });
    }
  };
}
