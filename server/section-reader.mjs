import { TEAM_SECTIONS } from '../shared/team-permissions.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PAGE = 50;
export class SectionReadError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = result => { if (result.error) throw new SectionReadError(503, 'Section data is temporarily unavailable.'); return result.data; };
const project = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field] ?? null]));
const fieldsOf = selection => selection.split(',').map(field => field.split(':')[0]);
function offsetFor(params) {
  const offset = params.get('offset') || '0';
  if (!/^\d{1,6}$/.test(offset)) throw new SectionReadError(400, 'Invalid page.');
  return Number(offset);
}
// Fixed tables and field lists, shared by Team Access and Agent Access.
const DATA = {
  orders: { table: 'orders', select: 'id,created_at,customer_name,customer_email,design_name:metadata->>designName,quantity,status,total_amount_cents,currency', search: 'customer_email' },
  shipments: { table: 'shipment_tracking_notifications', select: 'id,recipient_email,tracking_number,carrier,status,created_at,order_id', search: 'recipient_email' },
  profiles: { table: 'profiles', select: 'id,full_name,email,created_at', search: 'email' },
  prints: { table: 'wallet_accounts', select: 'id,user_id,balance,reserved_balance,status,created_at', filter: ['account_code', 'prints'] },
  'email-history': { table: 'bulk_email_campaigns', select: 'id,subject,total_recipients,status,created_at,completed_at', search: 'subject' },
  subscribers: { table: 'marketing_subscribers', select: 'id,full_name,email,source,status,consented_at,created_at', search: 'email' },
  affiliates: { table: 'affiliate_applications', select: 'id,name,email,status,affiliate_code,created_at', search: 'email' },
  'share-requests': { table: 'shared_purchase_requests', select: 'id,design_name,requester_name,requester_email,status,created_at', search: 'requester_email', filter: ['request_type', 'share_link'] },
  'order-stats': { table: 'order_daily_stats', select: 'stat_date,total_orders,total_cards,paid_orders,completed_orders,cancelled_orders,gross_revenue_cents,refunded_amount_cents,net_revenue_cents', sort: 'stat_date', key: 'stat_date' },
};
const ORDER_DETAIL = DATA.orders.select + ',stripe_session_id,updated_at,customer_phone,shipping_address,payment_status,deck_quantity,shipping_cost_cents,discount_amount_cents,payment_source,payment_provider,wallet_prints_spent,completed_at,refunded_at,refund_reason_key';

export async function readSection(db, params) {
  if ([...params.keys()].some(key => !['section','offset','q','id'].includes(key) || params.getAll(key).length !== 1)) throw new SectionReadError(400, 'Unsupported request parameters.');
  const section = params.get('section');
  const config = Object.hasOwn(DATA, section || '') ? DATA[section] : null;
  if (!config) throw new SectionReadError(403, 'Unsupported section.');
  const offset = offsetFor(params);
  if (params.has('id')) {
    if (!['orders', 'email-history'].includes(section) || !UUID.test(params.get('id')) || params.has('offset') || params.has('q')) throw new SectionReadError(400, 'Invalid detail request.');
    const id = params.get('id');
    if (section === 'orders') {
      const row = fail(await db.from('orders').select(ORDER_DETAIL).eq('id', id).maybeSingle());
      if (!row) throw new SectionReadError(404, 'Order not found.');
      const order = project(row, fieldsOf(ORDER_DETAIL));
      let address = order.shipping_address;
      if (typeof address === 'string') { try { address = JSON.parse(address); } catch { address = null; } }
      order.shipping_address = address && typeof address === 'object' ? project(address.address || address, ['line1','line2','city','state','postal_code','country']) : null;
      return { order };
    }
    const select = 'id,recipient_email,status,attempted_at,accepted_at';
    const rows = fail(await db.from('bulk_email_deliveries').select(select).eq('campaign_id', id).order('attempted_at', { ascending: false }).order('id').limit(101));
    return { deliveries: rows.slice(0, 100).map(row => project(row, fieldsOf(select))), truncated: rows.length > 100 };
  }
  const search = (params.get('q') || '').trim();
  if (search.length > 254 || /[\x00-\x1f\x7f]/.test(search) || (search && !config.search)) throw new SectionReadError(400, 'Invalid search.');
  let query = db.from(config.table).select(config.select).order(config.sort || 'created_at', { ascending: false });
  if (!config.sort) query = query.order('id');
  if (config.filter) query = query.eq(...config.filter);
  if (search) query = section === 'orders' && UUID.test(search) ? query.eq('id', search) : query.ilike(config.search, '%' + search.replace(/[\\%_]/g, '\\$&') + '%');
  const raw = fail(await query.range(offset, offset + PAGE));
  let rows = raw.slice(0, PAGE).map(row => project(row, fieldsOf(config.select)));
  if (section === 'prints' && rows.length) {
    const profiles = fail(await db.from('profiles').select('id,email,full_name').in('id', rows.map(row => row.user_id)));
    rows = rows.map(row => { const profile = profiles.find(item => item.id === row.user_id); return { ...row, email: profile?.email || null, full_name: profile?.full_name || null }; });
  }
  return { section, title: TEAM_SECTIONS.find(item => item.id === section).title, rows, nextOffset: raw.length > PAGE ? offset + PAGE : null };
}
