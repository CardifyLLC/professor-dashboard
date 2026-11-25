import { createDashboardAuthorization, DashboardAccessError } from './dashboard-access.mjs';

const PAGE_SIZE = 25;
const FIELDS = 'id,partner_id,amount_cents,net_credit_cents,dispute_open,created_at,reconciled_at,payment_mode';
const unavailable = () => new DashboardAccessError(503, 'API print credit purchases are temporarily unavailable. Please refresh.');
const text = value => typeof value === 'string' ? value : null;

export function createPrintCreditPurchasesHandler({ createClient, env = process.env, fetchImpl = fetch }) {
  return async (request, response) => {
    for (const [name, value] of Object.entries({
      'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
      'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    })) response.setHeader(name, value);
    const send = (status, body) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return send(405, { error: 'Method not allowed.' });
    }
    try {
      const access = createDashboardAuthorization({ createClient, env, fetchImpl });
      const identity = await access.authenticate(request);
      if (!identity.admin) throw new DashboardAccessError(403, 'Administrator access required.');
      const params = new URL(request.url, 'https://dashboard.invalid').searchParams;
      const mode = params.get('mode') || 'live', pageText = params.get('page') || '1';
      if ([...params.keys()].some(key => !['mode', 'page'].includes(key) || params.getAll(key).length !== 1)
        || !['live', 'test'].includes(mode) || !/^[1-9]\d{0,4}$/.test(pageText)) {
        throw new DashboardAccessError(400, 'Choose a valid purchase page and payment mode.');
      }
      const page = Number(pageText), from = (page - 1) * PAGE_SIZE;
      const db = access.db();
      // Reconciliation is recorded only after Stripe confirms a successful payment.
      // Keep fully reversed purchases visible; never count unpaid checkout attempts.
      const result = await db.from('partner_credit_topups').select(FIELDS, { count: 'exact' })
        .eq('payment_mode', mode).not('reconciled_at', 'is', null)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (result.error || !Array.isArray(result.data) || !Number.isSafeInteger(result.count)) throw unavailable();
      const ids = [...new Set(result.data.map(row => row.partner_id))];
      const partners = ids.length ? await db.from('partnership_requests')
        .select('id,full_name,business_name,email').in('id', ids) : { data: [] };
      if (partners.error || !Array.isArray(partners.data)) throw unavailable();
      const byId = new Map(partners.data.map(row => [row.id, row]));
      const purchases = result.data.map(row => {
        if (!Number.isSafeInteger(row.amount_cents) || row.amount_cents <= 0
          || !Number.isSafeInteger(row.net_credit_cents) || row.net_credit_cents < 0
          || row.net_credit_cents > row.amount_cents || row.payment_mode !== mode || !row.reconciled_at) throw unavailable();
        const partner = byId.get(row.partner_id) || {};
        // Explicit projection: no Stripe IDs, idempotency keys, or credentials.
        return {
          id: row.id, partner_id: row.partner_id, created_at: row.created_at, reconciled_at: row.reconciled_at,
          customer_name: text(partner.full_name), business_name: text(partner.business_name), customer_email: text(partner.email),
          amount_cents: row.amount_cents, net_credit_cents: row.net_credit_cents,
          reversed_cents: row.amount_cents - row.net_credit_cents,
          status: row.dispute_open ? 'Disputed' : row.net_credit_cents === 0 ? 'Fully reversed'
            : row.net_credit_cents < row.amount_cents ? 'Partly reversed' : 'Paid',
        };
      });
      await access.recheck(identity);
      return send(200, { purchases, total: result.count, page, pageSize: PAGE_SIZE, mode, currency: 'USD' });
    } catch (error) {
      return send(error instanceof DashboardAccessError ? error.status : 503, {
        error: error instanceof DashboardAccessError ? error.message : unavailable().message,
      });
    }
  };
}
