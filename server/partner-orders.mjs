import { isPartnerOrder, orderMetadata } from '../src/services/partnerArtwork.mjs';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function createPartnerOrdersHandler({ createClient, fetchImpl = fetch, env = process.env }) {
  return async (request, response) => {
    const send = (status, payload) => { response.statusCode=status; response.end(JSON.stringify(payload)); };
    response.setHeader('Content-Type','application/json');
    response.setHeader('Cache-Control','private, no-store');
    if (request.method !== 'POST') return send(405,{error:'Method not allowed.'});
    try {
      const authorization = request.headers.authorization || '';
      const token = authorization.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) throw new HttpError(401,'Sign in to the dashboard first.');
      const url = env.VITE_SUPABASE_URL, anonKey = env.VITE_SUPABASE_ANON_KEY;
      if (!url || !anonKey) throw new HttpError(503,'Dashboard Supabase configuration is missing.');
      const db = createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
      const {data:auth,error:authError} = await db.auth.getUser(token);
      if (authError || !auth?.user?.id) throw new HttpError(401,'Your admin session has expired.');
      const {data:admin,error:adminError} = await db.from('dashboard_admins').select('user_id').eq('user_id',auth.user.id).eq('enabled',true).maybeSingle();
      if (adminError || !admin) throw new HttpError(403,'Administrator access required.');
      let body = request.body;
      if (body === undefined) {
        const chunks=[]; let length=0;
        for await (const chunk of request) { length+=Buffer.byteLength(chunk); if(length>16000)throw new HttpError(413,'Request too large.'); chunks.push(Buffer.from(chunk)); }
        body=Buffer.concat(chunks).toString('utf8');
      }
      if (typeof body === 'string') { try { body=JSON.parse(body); } catch { throw new HttpError(400,'Invalid JSON.'); } }
      if (!body || !uuid.test(body.orderId || '')) throw new HttpError(400,'A valid order ID is required.');
      if (!['manifest','file','status'].includes(body.action)) throw new HttpError(400,'Unsupported action.');
      const {data:order,error:orderError} = await db.from('orders').select('*').eq('id',body.orderId).single();
      if (orderError || !order) throw new HttpError(404,'Order not found.');
      if (!isPartnerOrder(order)) throw new HttpError(400,'This is not a partner API order.');
      const locallyPrintable=['paid','processing'].includes(String(order.status).toLowerCase()) && !['refunded','failed','cancelled'].includes(String(order.payment_status).toLowerCase());
      if (body.action === 'file' && !locallyPrintable) throw new HttpError(409,'This order is not available for production.');
      const origin = env.PARTNER_PLATFORM_ORIGIN, secret=env.PARTNER_INTERNAL_SECRET;
      if (!origin || !secret || secret.length<32) throw new HttpError(503,'Configure PARTNER_PLATFORM_ORIGIN and PARTNER_INTERNAL_SECRET on the dashboard server.');
      const partner = async (path, payload) => {
        const result = await fetchImpl(`${origin.replace(/\/$/,'')}/api/internal/${path}`,{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},
          body:JSON.stringify({...payload,actor:`dashboard:${auth.user.id}`}),redirect:'error',signal:AbortSignal.timeout(55000),
        });
        const data = await result.json();
        if (!result.ok) throw new HttpError(result.status,data.error?.message || 'Partner production service is unavailable.');
        return data;
      };
      if (body.action === 'file') {
        if (!uuid.test(body.fileId || '')) throw new HttpError(400,'A valid file ID is required.');
        const data = await partner('production',{order_id:order.id,file_id:body.fileId});
        const file = data.files?.find(file => file.id === body.fileId);
        if (!file?.url) throw new HttpError(404,'Artwork file not available.');
        return send(200,{url:file.url});
      }
      if (body.action === 'manifest') {
        const data = await partner('production',{order_id:order.id,include_urls:false,prepare:locallyPrintable && body.prepare !== false});
        return send(200,{...data,ready:locallyPrintable && data.ready});
      }
      const metadata=orderMetadata(order), current=await partner('production',{order_id:order.id,include_urls:false});
      const mapping={processing:'in_production',shipped:'shipped',cancelled:'cancelled'};
      if (body.status === 'completed') {
        if (current.status !== 'shipped') throw new HttpError(409,'Record the partner shipment before marking this order completed.');
      } else if (mapping[body.status]) {
        await partner('orders',{cart_id:metadata.partnerCartId,order_id:order.id,status:mapping[body.status],shipment:body.shipment});
      } else throw new HttpError(400,'Partner orders can be processed, shipped, completed after shipment, or cancelled. Payment is recorded by checkout.');
      const changes={status:body.status,metadata:{...metadata,manufacturingStatus:mapping[body.status] || 'shipped'},...(body.status==='completed'?{completed_at:new Date().toISOString()}:{})};
      const {data:updated,error:updateError}=await db.from('orders').update(changes).eq('id',order.id).select().single();
      if(updateError)throw new HttpError(502,'Production status was saved. Retry to synchronize the dashboard order.');
      return send(200,{order:updated});
    } catch(error) {
      return send(error instanceof HttpError ? error.status : 502,{error:error instanceof HttpError ? error.message : 'Partner artwork service could not be reached. Please retry.'});
    }
  };
}
