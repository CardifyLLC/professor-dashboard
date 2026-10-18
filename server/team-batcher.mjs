import { createDashboardAuthorization, DashboardAccessError as HttpError } from './dashboard-access.mjs';
import { orderMetadata, partnerCards } from '../src/services/partnerArtwork.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FIELDS = 'id,customer_name,created_at,quantity,status,payment_status,card_data,card_images,metadata';
const CARD_FIELDS = ['frontUrl','backUrl','originalFrontUrl','originalBackUrl','originalFront','originalBack','silverMask'];
const PAGE = 25;
const fail = result => { if (result.error) throw new HttpError(503,'Batcher orders are unavailable. Please retry.'); return result.data; };
const array = value => { if (typeof value === 'string') { try { value=JSON.parse(value); } catch { return []; } } return Array.isArray(value) ? value : []; };
const ready = order => (String(order.status).toLowerCase()==='paid' || (String(order.status).toLowerCase()==='processing' && Boolean(orderMetadata(order).partnerCartId))) && !['refunded','failed','cancelled','canceled'].includes(String(order.payment_status).toLowerCase()) && orderMetadata(order).productType !== 'cardstock';
const ref = (order,kind,index,field) => `team-artwork:${order.id}/${kind}/${index}/${field}`;
function project(order) {
  const metadata=orderMetadata(order), partner=Boolean(metadata.partnerCartId);
  return {
    id:order.id, customer_name:order.customer_name, created_at:order.created_at, quantity:order.quantity, status:order.status,
    metadata:{proMode:metadata.proMode === true,pro_mode:metadata.pro_mode === true,...(partner ? {partnerCartId:true} : {})},
    card_data:partner ? [] : array(order.card_data).map((card,index)=>Object.fromEntries(CARD_FIELDS.filter(field=>typeof card?.[field]==='string' && card[field]).map(field=>[field,ref(order,'card',index,field)]))),
    // Keep a synthetic filename so the existing positional back/mask parser works.
    card_images:partner ? [] : array(order.card_images).map((source,index)=>typeof source === 'string' && source ? ref(order,'image',index,/mask/i.test(source) ? 'mask.png' : /(?:\/back\.(?:jpeg|jpg|png)$|[_-]back\.)/i.test(source) ? 'back.png' : 'front.png') : ''),
  };
}
async function imageUrl(db, source, projectUrl) {
  if (typeof source !== 'string' || !source) throw new HttpError(404,'Artwork not found.');
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(source)) return source;
  if (/^https?:/i.test(source)) {
    const url=new URL(source), project=new URL(projectUrl);
    if (url.protocol!=='https:' || url.origin!==project.origin || url.username || url.password) throw new HttpError(409,'Ask an administrator to move this artwork into order storage.');
    const prefix=['public','sign','authenticated'].map(kind=>'/storage/v1/object/'+kind+'/order-images/').find(value=>url.pathname.startsWith(value));
    if (!prefix) throw new HttpError(409,'Unsupported artwork storage location.');
    try { source=decodeURIComponent(url.pathname.slice(prefix.length)); } catch { throw new HttpError(409,'Invalid artwork path.'); }
  }
  if (source.length>2000 || /[:\\\x00-\x1f\x7f]/.test(source) || source.split('/').some(part=>['.','..',''].includes(part))) throw new HttpError(409,'Invalid stored artwork reference.');
  const signed=fail(await db.storage.from('order-images').createSignedUrl(source,60));
  if (!signed?.signedUrl || !/^https:\/\//i.test(signed.signedUrl)) throw new HttpError(503,'Could not load print artwork.');
  return signed.signedUrl;
}

export function createTeamBatcherHandler({createClient,env=process.env,fetchImpl=fetch}) {
  return async (request,response) => {
    for (const [name,value] of Object.entries({'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'})) response.setHeader(name,value);
    const send=(status,body)=>{response.statusCode=status;response.end(JSON.stringify(body));};
    if (request.method!=='GET') {response.setHeader('Allow','GET');return send(405,{error:'Batcher access is read-only. Use GET.'});}
    try {
      const access=createDashboardAuthorization({createClient,env,fetchImpl}), identity=await access.authenticate(request);
      const grant=await access.permissions(identity,true);
      if (!grant.permissions.includes('batcher')) throw new HttpError(403,'Ask an administrator to enable Batcher PRO.');
      const params=new URL(request.url,'https://dashboard.invalid').searchParams;
      if ([...params.keys()].some(key=>!['order','offset','kind','index','field','file'].includes(key) || params.getAll(key).length!==1)) throw new HttpError(400,'Invalid Batcher parameters.');
      const db=access.db(), id=params.get('order');
      const recheck=()=>access.recheck(identity,'batcher');
      if (!id) {
        if ([...params.keys()].some(key=>key!=='offset') || !/^\d{1,6}$/.test(params.get('offset') || '0')) throw new HttpError(400,'Invalid Batcher page.');
        const offset=Number(params.get('offset') || 0);
        const orders=fail(await db.from('orders').select(FIELDS).in('status',['paid','PAID','processing','PROCESSING']).order('created_at',{ascending:false}).order('id').range(offset,offset+PAGE));
        await recheck();
        return send(200,{orders:orders.slice(0,PAGE).filter(ready).map(project),nextOffset:orders.length>PAGE ? offset+PAGE : null});
      }
      if (!UUID.test(id) || params.has('offset')) throw new HttpError(400,'Invalid Batcher order.');
      const order=fail(await db.from('orders').select(FIELDS).eq('id',id).maybeSingle());
      if (!order || !ready(order)) throw new HttpError(404,'This order is not available in Batcher PRO.');
      const partner=Boolean(orderMetadata(order).partnerCartId), kind=params.get('kind');
      const production=async fileId=>{
        if (!env.PARTNER_PLATFORM_ORIGIN || !env.PARTNER_INTERNAL_SECRET || env.PARTNER_INTERNAL_SECRET.length<32) throw new HttpError(503,'Partner artwork is not configured. Ask an administrator.');
        const origin=new URL(env.PARTNER_PLATFORM_ORIGIN);
        if (origin.protocol!=='https:' || origin.username || origin.password) throw new HttpError(503,'Invalid partner service configuration.');
        await recheck();
        const result=await fetchImpl(origin.origin+'/api/internal/production',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.PARTNER_INTERNAL_SECRET},body:JSON.stringify({order_id:id,prepare:false,actor:'dashboard:'+identity.user.id,...(fileId ? {file_id:fileId} : {include_urls:false})}),redirect:'error',signal:AbortSignal.timeout(12000)});
        if (!result.ok) throw new HttpError(409,'Partner artwork is not ready for printing.');
        const data=await result.json();
        if (data.order_id!==id || !data.ready) throw new HttpError(409,'Partner artwork is not ready for this order.');
        return data;
      };
      let data;
      if (!kind) {
        if ([...params.keys()].some(key=>key!=='order')) throw new HttpError(400,'Invalid order request.');
        const output=project(order);
        if (partner) {
          const manifest=await production(), cards=partnerCards(id,manifest);
          if (cards.reduce((sum,card)=>sum+card.quantity,0)!==Number(order.quantity)) throw new HttpError(409,'Partner artwork quantities do not match the order.');
          output.card_data=cards.map(card=>({...card,frontUrl:card.frontUrl.replace('partner-artwork:','team-artwork:').replace(/\/([^/]+)$/,'/partner/$1/file'),backUrl:card.backUrl.replace('partner-artwork:','team-artwork:').replace(/\/([^/]+)$/,'/partner/$1/file')}));
          output.partnerArtwork={ready:true};
        }
        data={order:output};
      } else if (kind==='partner') {
        if (!partner || [...params.keys()].some(key=>!['order','kind','file'].includes(key)) || !UUID.test(params.get('file') || '')) throw new HttpError(400,'Invalid partner file.');
        const fileId=params.get('file'), manifest=await production(fileId);
        const url=manifest.files?.find(file=>file.id===fileId)?.url;
        if (!url || !/^https:\/\//i.test(url)) throw new HttpError(409,'Partner file not available.');
        data={url};
      } else {
        if (partner || !['card','image'].includes(kind) || [...params.keys()].some(key=>!['order','kind','index','field'].includes(key)) || !/^\d{1,6}$/.test(params.get('index') || '')) throw new HttpError(400,'Invalid artwork selection.');
        const index=Number(params.get('index')), field=params.get('field');
        if (kind==='card' ? !CARD_FIELDS.includes(field) : !['front.png','back.png','mask.png'].includes(field)) throw new HttpError(400,'Invalid artwork field.');
        const source=kind==='card' ? array(order.card_data)[index]?.[field] : array(order.card_images)[index];
        await recheck();
        data={url:await imageUrl(db,source,env.VITE_SUPABASE_URL)};
      }
      await recheck();
      return send(200,data);
    } catch (error) {return send(error instanceof HttpError ? error.status : 503,{error:error instanceof HttpError ? error.message : 'Batcher artwork is temporarily unavailable. Please retry.'});}
  };
}
