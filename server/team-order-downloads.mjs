import { createDashboardAuthorization, DashboardAccessError as HttpError } from './dashboard-access.mjs';
import { pacificDayRange } from '../shared/pacific-date.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = result => { if (result.error) throw new HttpError(503, 'Order PDFs are unavailable. Please retry.'); return result.data; };
function pdfPaths(generation, orderId) {
  if (generation?.status !== 'completed') return [];
  let paths = generation.storage_paths;
  if (typeof paths === 'string') { try { paths = JSON.parse(paths); } catch { return []; } }
  paths = Array.isArray(paths) && paths.length ? paths : generation.storage_path ? [generation.storage_path] : [];
  if (!paths.length || (generation.total_parts > 0 && paths.length !== generation.total_parts) || paths.some(path =>
    typeof path !== 'string' || !path.startsWith(orderId + '/') || !path.endsWith('.pdf') || /[\\\x00-\x1f\x7f]/.test(path) || path.split('/').some(part => ['.','..',''].includes(part)))) return [];
  return paths;
}

export function createTeamOrderDownloadsHandler({ createClient, env = process.env, fetchImpl = fetch }) {
  return async (request, response) => {
    for (const [name,value] of Object.entries({ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'private, no-store', 'Vercel-CDN-Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' })) response.setHeader(name,value);
    const send = (status,body) => { response.statusCode=status; response.end(JSON.stringify(body)); };
    if (request.method !== 'GET') { response.setHeader('Allow','GET'); return send(405,{error:'Downloads are read-only. Use GET.'}); }
    try {
      const access = createDashboardAuthorization({ createClient, env, fetchImpl });
      const identity = await access.authenticate(request), grant = await access.permissions(identity, true);
      if (!['orders','order-downloads'].every(scope => grant.permissions.includes(scope))) throw new HttpError(403, 'Ask an administrator to enable Orders & customers and Download order PDFs.');
      const params = new URL(request.url, 'https://dashboard.invalid').searchParams;
      const id = params.get('order'), type = params.get('type') || 'manifest';
      const allowed = type === 'day' ? ['type','date','offset'] : ['order','type','index'];
      if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw new HttpError(400,'Unsupported download parameters.');
      const db = access.db();
      const recheck = async () => { await access.recheck(identity,'orders'); await access.recheck(identity,'order-downloads'); };
      if (type === 'day') {
        let range;
        try { range = pacificDayRange(params.get('date')); } catch { throw new HttpError(400,'Choose a valid order date.'); }
        const offsetText = params.get('offset') ?? '0';
        if (!/^(0|[1-9]\d{0,6})$/.test(offsetText) || Number(offsetText) > 1000000) throw new HttpError(400,'Invalid download offset.');
        const offset = Number(offsetText), pageSize = 100;
        const rows = fail(await db.from('orders').select('id')
          .gte('created_at',range.from).lt('created_at',range.before)
          .order('created_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+pageSize));
        const ids = rows.slice(0,pageSize).map(row => row.id);
        const generations = ids.length ? fail(await db.from('order_pdf_generations')
          .select('order_id,status,storage_path,storage_paths,total_parts').in('order_id',ids).eq('status','completed')) : [];
        const byId = new Map(generations.map(row => [row.order_id,row]));
        const orders = ids.map(orderId => ({orderId,parts:pdfPaths(byId.get(orderId),orderId).length})).filter(order => order.parts > 0);
        await recheck();
        // No storage paths or signed links in the listing. Every part requires a fresh permission check.
        return send(200,{date:params.get('date'),orders,nextOffset:rows.length>pageSize ? offset+pageSize : null});
      }
      if (!UUID.test(id || '') || !['manifest','pdf'].includes(type)) throw new HttpError(400,'Invalid order or download type.');
      if (type === 'pdf' ? !/^\d{1,5}$/.test(params.get('index') || '') : params.has('index')) throw new HttpError(400,'Invalid PDF selection.');
      if (!fail(await db.from('orders').select('id').eq('id',id).maybeSingle())) throw new HttpError(404,'Order not found.');
      const generation = fail(await db.from('order_pdf_generations').select('order_id,status,storage_path,storage_paths,total_parts').eq('order_id',id).maybeSingle());
      const paths = pdfPaths(generation,id);
      await recheck();
      let data = { pdf:{status:paths.length ? 'completed' : generation?.status || 'unavailable', parts:paths.length} };
      if (type === 'pdf') {
        const index = Number(params.get('index'));
        if (!paths[index]) throw new HttpError(409,'This PDF part is not ready. Refresh the available files.');
        // Only generated PDFs stored for this exact order; never a caller-supplied path.
        const signed = fail(await db.storage.from('order-pdfs').createSignedUrl(paths[index],60,{download:true}));
        if (!signed?.signedUrl || !/^https:\/\//i.test(signed.signedUrl)) throw new HttpError(503,'Could not create a PDF download link.');
        data = { url:signed.signedUrl, filename:'order-'+id+(paths.length>1 ? '-part-'+(index+1)+'-of-'+paths.length : '')+'.pdf' };
      }
      await recheck();
      return send(200,data);
    } catch (error) { return send(error instanceof HttpError ? error.status : 503,{error:error instanceof HttpError ? error.message : 'Order downloads are temporarily unavailable. Please retry.'}); }
  };
}
