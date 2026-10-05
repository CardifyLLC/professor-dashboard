class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function createOrderPdfDownloadsHandler({ createClient, env = process.env, now = () => new Date() }) {
    return async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'private, no-store');
        const send = (status, body) => { response.statusCode = status; response.end(JSON.stringify(body)); };
        if (request.method !== 'POST') {
            response.setHeader('Allow', 'POST');
            return send(405, { error: 'Method not allowed.' });
        }
        try {
            const token = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
            if (!token) throw new HttpError(401, 'Sign in to the dashboard first.');
            if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new HttpError(503, 'Dashboard Supabase configuration is missing.');
            // Forward the verified user's token: database RLS remains in force.
            // This endpoint performs one fixed operation, not arbitrary updates.
            const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
                global: { headers: { Authorization: `Bearer ${token}` } },
                auth: { persistSession: false, autoRefreshToken: false },
            });
            const { data: auth, error: authError } = await db.auth.getUser(token);
            if (authError || !auth?.user?.id) throw new HttpError(401, 'Your admin session has expired. Sign in again.');
            const { data: admin, error: adminError } = await db.from('dashboard_admins')
                .select('user_id').eq('user_id', auth.user.id).eq('enabled', true).maybeSingle();
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
            if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body) || '') > 16000) throw new HttpError(413, 'Request too large.');
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch { throw new HttpError(400, 'Invalid JSON.'); }
            }
            if (!Array.isArray(body?.orderIds) || !body.orderIds.length || body.orderIds.length > 200
                || body.orderIds.some(id => typeof id !== 'string' || !uuid.test(id))) {
                throw new HttpError(400, 'Provide between 1 and 200 valid order IDs.');
            }
            const ids = [...new Set(body.orderIds)];
            const downloadedAt = now().toISOString();
            const { data, error } = await db.from('order_pdf_generations')
                .update({ downloaded_at: downloadedAt, updated_at: downloadedAt })
                .in('order_id', ids).eq('status', 'completed').select('order_id, downloaded_at');
            if (error) throw new HttpError(error.code === '42501' ? 403 : 502, 'Could not save the PDF download confirmation. Check dashboard database access and retry.');
            if (ids.some(id => !data?.some(row => row.order_id === id && row.downloaded_at))) {
                throw new HttpError(409, 'Download confirmation was not saved for every order. Check that each PDF is completed and accessible.');
            }
            return send(200, { downloads: data });
        } catch (error) {
            return send(error instanceof HttpError ? error.status : 502, {
                error: error instanceof HttpError ? error.message : 'Could not reach the PDF download confirmation service. Please retry.',
            });
        }
    };
}
