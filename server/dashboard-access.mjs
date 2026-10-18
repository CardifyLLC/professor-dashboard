import { readSection, SectionReadError } from './section-reader.mjs';
import { randomUUID } from 'node:crypto';
import { TEAM_PERMISSION_IDS, TEAM_MEMBER_PERMISSION_IDS } from '../shared/team-permissions.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MEMBER_FIELDS = 'id,email,user_id,permissions,created_at,updated_at,revoked_at,version';
const PAGE = 50;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = result => { if (result.error) throw new HttpError(503, 'Dashboard access is unavailable. Check the SQL migration and server settings.'); return result.data; };
const project = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field] ?? null]));
const fieldsOf = selection => selection.split(',').map(field => field.split(':')[0]);
const options = fetchImpl => ({ auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(12000) }) } });
function reply(response) {
  for (const [name, value] of Object.entries({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })) response.setHeader(name, value);
  return (status, value) => { response.statusCode = status; response.end(JSON.stringify(value)); };
}
const report = (send, error) => send((error instanceof HttpError || error instanceof SectionReadError) ? error.status : 503, { error: (error instanceof HttpError || error instanceof SectionReadError) ? error.message : 'Dashboard access is temporarily unavailable. Try again.' });
function paramsFor(request, allowed) {
  const params = new URL(request.url, 'https://dashboard.invalid').searchParams;
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw new HttpError(400, 'Unsupported request parameters.');
  return params;
}
function offsetFor(params) {
  const offset = params.get('offset') || '0';
  if (!/^\d{1,6}$/.test(offset)) throw new HttpError(400, 'Invalid page.');
  return Number(offset);
}
async function bodyFor(request) {
  let body = request.body;
  if (body === undefined) {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += Buffer.byteLength(chunk); if (size > 4096) throw new HttpError(413, 'Request too large.'); chunks.push(Buffer.from(chunk)); }
    body = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body) || '') > 4096) throw new HttpError(413, 'Request too large.');
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new HttpError(400, 'Invalid JSON.'); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid request.');
  return body;
}
function createAccess({ createClient, env, fetchImpl }) {
  let service;
  const db = () => {
    if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, 'Configure the dashboard’s server-only SUPABASE_SERVICE_ROLE_KEY.');
    return service ||= createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options(fetchImpl));
  };
  async function authenticate(request) {
    const token = request.headers?.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token || token.startsWith('tcgp_agent_') || token === env.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(401, 'Sign in with your approved account.');
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new HttpError(503, 'Dashboard authentication is not configured.');
    const config = options(fetchImpl); config.global.headers = { Authorization: 'Bearer ' + token };
    const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, config);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user?.id) throw new HttpError(401, 'Your session has expired. Sign in again.');
    const user = data.user;
    // Fresh server-verified identity; never trust a browser email or user_metadata.
    const email = user.email?.trim().toLowerCase();
    const admin = fail(await client.from('dashboard_admins').select('user_id').eq('user_id', user.id).eq('enabled', true).maybeSingle());
    return { user, email, admin: Boolean(admin), client };
  }
  async function permissions(identity, bind = false) {
    if (identity.admin) return { role: 'admin', email: identity.email, user_id: identity.user.id, permissions: TEAM_MEMBER_PERMISSION_IDS, version: 'admin' };
    if (!identity.email || !identity.user.email_confirmed_at || identity.user.is_anonymous) throw new HttpError(403, 'A verified approved email is required.');
    let member = fail(await db().from('dashboard_viewers').select(MEMBER_FIELDS).eq('email', identity.email).is('revoked_at', null).maybeSingle());
    if (!member || !member.permissions?.length || member.permissions.some(id => !TEAM_MEMBER_PERMISSION_IDS.includes(id)) || (member.permissions.includes('order-downloads') && !member.permissions.includes('orders'))) throw new HttpError(403, 'This account has no dashboard access. Ask an administrator.');
    if (!member.user_id && bind) {
      // Compare-and-set prevents a concurrent revoke/edit/account claim being overwritten.
      member = fail(await db().from('dashboard_viewers').update({ user_id: identity.user.id }).eq('id', member.id).eq('version', member.version).is('user_id', null).is('revoked_at', null).select(MEMBER_FIELDS).maybeSingle())
        || fail(await db().from('dashboard_viewers').select(MEMBER_FIELDS).eq('id', member.id).is('revoked_at', null).maybeSingle());
    }
    if (!member || member.user_id !== identity.user.id) throw new HttpError(403, 'This access belongs to a different account. Ask an administrator.');
    return { role: 'viewer', email: identity.email, user_id: identity.user.id, permissions: member.permissions, version: member.version };
  }
  async function recheck(identity, scope) {
    if (identity.admin) {
      if (!fail(await identity.client.from('dashboard_admins').select('user_id').eq('user_id', identity.user.id).eq('enabled', true).maybeSingle())) throw new HttpError(403, 'Access has been removed.');
    } else {
      const access = await permissions(identity);
      if (!access.permissions.includes(scope)) throw new HttpError(403, 'You do not have access to this section.');
    }
  }
  return { db, authenticate, permissions, recheck };
}

export function createDashboardAccessHandler({ createClient, env = process.env, fetchImpl = fetch }) {
  return async (request, response) => {
    const send = reply(response);
    if (!['GET', 'POST'].includes(request.method)) { response.setHeader('Allow', 'GET, POST'); return send(405, { error: 'Method not allowed.' }); }
    try {
      const access = createAccess({ createClient, env, fetchImpl });
      const identity = await access.authenticate(request);
      const params = paramsFor(request, ['mode', 'offset']);
      if (request.method === 'GET' && params.get('mode') === 'session') {
        if (params.has('offset')) throw new HttpError(400, 'Invalid session request.');
        return send(200, await access.permissions(identity, true));
      }
      if (!identity.admin) throw new HttpError(403, 'Only full administrators can manage dashboard access.');
      if (params.get('mode') && params.get('mode') !== 'members') throw new HttpError(400, 'Invalid mode.');
      const db = access.db();
      if (request.method === 'GET') {
        const offset = offsetFor(params);
        const rows = fail(await db.from('dashboard_viewers').select(MEMBER_FIELDS).order('created_at', { ascending: false }).order('id').range(offset, offset + PAGE));
        await access.recheck(identity);
        return send(200, { members: rows.slice(0, PAGE).map(row => project(row, fieldsOf(MEMBER_FIELDS))), nextOffset: rows.length > PAGE ? offset + PAGE : null });
      }
      if ([...params.keys()].length) throw new HttpError(400, 'Use the access endpoint without query parameters to change access.');
      const body = await bodyFor(request);
      const allowed = body.action === 'grant' ? ['action', 'email', 'permissions'] : body.action === 'update' ? ['action', 'id', 'version', 'permissions'] : body.action === 'revoke' ? ['action', 'id', 'version'] : [];
      if (!allowed.length || Object.keys(body).some(key => !allowed.includes(key))) throw new HttpError(400, 'Unsupported access action or fields.');
      if (body.action !== 'revoke' && (!Array.isArray(body.permissions) || !body.permissions.length || body.permissions.length > TEAM_MEMBER_PERMISSION_IDS.length || body.permissions.some(id => !TEAM_MEMBER_PERMISSION_IDS.includes(id)) || new Set(body.permissions).size !== body.permissions.length)) throw new HttpError(400, 'Choose at least one supported read permission.');
      if (body.action !== 'revoke' && body.permissions.includes('order-downloads') && !body.permissions.includes('orders')) throw new HttpError(400, 'Download order PDFs also requires Orders & customers access.');
      const now = new Date().toISOString();
      const changes = { updated_at: now, updated_by: identity.user.id, version: randomUUID() };
      await access.recheck(identity);
      if (body.action === 'grant') {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (email.length > 254 || !/^[^\s@,()\x00-\x1f\x7f]+@[^\s@,()\x00-\x1f\x7f]+\.[^\s@,()\x00-\x1f\x7f]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
        if (email === identity.email || fail(await db.from('dashboard_admins').select('user_id').ilike('email', email.replace(/[\\%_]/g, '\\$&')).eq('enabled', true).limit(1)).length) throw new HttpError(409, 'This email already belongs to a full administrator.');
        const result = await db.from('dashboard_viewers').insert({ ...changes, email, permissions: body.permissions, created_by: identity.user.id }).select(MEMBER_FIELDS).single();
        if (result.error?.code === '23505') throw new HttpError(409, 'This email already has an access record. Edit it or restore its access.');
        return send(201, { member: project(fail(result), fieldsOf(MEMBER_FIELDS)) });
      }
      if (!UUID.test(body.id || '') || !UUID.test(body.version || '')) throw new HttpError(400, 'Invalid access record.');
      const result = fail(await db.from('dashboard_viewers').update({ ...changes, ...(body.action === 'revoke' ? { revoked_at: now } : { permissions: body.permissions, revoked_at: null }) }).eq('id', body.id).eq('version', body.version).select(MEMBER_FIELDS).maybeSingle());
      if (!result) throw new HttpError(409, 'This access record changed. Refresh the list before trying again.');
      return send(200, { member: project(result, fieldsOf(MEMBER_FIELDS)) });
    } catch (error) { return report(send, error); }
  };
}

export function createDashboardReadHandler({ createClient, env = process.env, fetchImpl = fetch }) {
  return async (request, response) => {
    const send = reply(response);
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return send(405, { error: 'This endpoint is read-only. Use GET.' }); }
    try {
      const access = createAccess({ createClient, env, fetchImpl });
      const identity = await access.authenticate(request);
      const permissions = await access.permissions(identity, true);
      const params = paramsFor(request, ['section', 'offset', 'q', 'id']);
      const section = params.get('section');
      if (!TEAM_PERMISSION_IDS.includes(section) || !permissions.permissions.includes(section)) throw new HttpError(403, 'You do not have access to this section.');
      const data = await readSection(access.db(), params);
      await access.recheck(identity, section);
      return send(200, data);
    } catch (error) { return report(send, error); }
  };
}

export { createAccess as createDashboardAuthorization, HttpError as DashboardAccessError };
