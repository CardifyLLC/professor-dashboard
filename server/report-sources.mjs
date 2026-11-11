import { buildBusinessReport } from './business-metrics.mjs';

export function decimalMinor(value,currency) {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency');
  const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
  if(typeof value!=='string'||!new RegExp(`^-?\\d+(?:\\.\\d{1,${Math.max(1,digits)}})?$`).test(value))throw new Error('Invalid provider amount');
  const negative=value.startsWith('-'),[whole,decimal='']=value.replace('-','').split('.');
  if(decimal.length>digits)throw new Error('Unexpected fractional currency units');
  const result=Number(BigInt(whole)*10n**BigInt(digits)+BigInt(decimal.padEnd(digits,'0')||'0'))*(negative?-1:1);
  if(!Number.isSafeInteger(result))throw new Error('Amount overflow');return result;
}
async function jsonFetch(fetchImpl,url,init={}) {
  const response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Source HTTP ${response.status}`);
  return response.json();
}
export async function stripeMovements({env,start,end,fetchImpl=fetch}) {
  if(!env.STRIPE_SECRET_KEY)throw new Error('Stripe reporting key missing');
  const headers={Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`};
  const get=(path,params=new URLSearchParams())=>jsonFetch(fetchImpl,`https://api.stripe.com/v1/${path}?${params}`,{headers});
  let cursor=null;const rows=[],sessionCache=new Map(),chargeCache=new Map();
  for(let page=0;page<500;page++){
    const params=new URLSearchParams({limit:'100','created[gte]':String(Date.parse(start)/1000),'created[lt]':String(Date.parse(end)/1000),'expand[]':'data.source'});
    if(cursor)params.set('starting_after',cursor);
    const result=await get('balance_transactions',params);
    if(!Array.isArray(result.data)||(result.has_more&&!result.data.length))throw new Error('Incomplete Stripe page');
    for(const row of result.data){
      let source=row.source;
      if(typeof source==='string' && source.startsWith('ch_'))source=await get(`charges/${encodeURIComponent(source)}`);
      let kind=['charge','payment'].includes(row.type)&&row.amount>0?'sale':['refund','payment_refund'].includes(row.type)&&row.amount<0?'refund':row.type;
      if(kind==='sale'&&(source?.status!=='succeeded'||source?.paid!==true||source?.captured!==true))kind='charge_unconfirmed';
      if(kind==='refund'&&source?.status!=='succeeded')kind='refund_'+(source?.status||'unconfirmed');
      let charge=source;
      if(kind==='refund'&&source?.charge){const id=typeof source.charge==='string'?source.charge:source.charge.id;if(!chargeCache.has(id))chargeCache.set(id,await get(`charges/${encodeURIComponent(id)}`));charge=chargeCache.get(id);}
      const pi=charge?.payment_intent;
      let session=null;
      if(typeof pi==='string'){
        if(!sessionCache.has(pi))sessionCache.set(pi,(await get('checkout/sessions',new URLSearchParams({payment_intent:pi,limit:'2'}))).data||[]);
        const matches=sessionCache.get(pi);if(matches.length===1)session=matches[0];
      }
      const metadata={...session?.metadata,...charge?.metadata,...source?.metadata};
      rows.push({id:'stripe:'+row.id,provider:'stripe',kind,amount_minor:Math.abs(row.amount),currency:String(row.currency).toUpperCase(),created_at:new Date(row.created*1000).toISOString(),original_amount_minor:kind==='sale'?(source?.amount_captured??source?.amount??null):(source?.amount??null),original_currency:source?.currency?.toUpperCase()||null,
        package:session?.metadata?.productType==='print_package'?{amount_minor:session.amount_total,currency:session.currency?.toUpperCase(),prints:Number(session.metadata.immediatePrints)}:null,
        references:[source?.id,charge?.id,pi,session?.id,session?.id?'stripe:'+session.id:null,metadata.order_id,metadata.orderId,metadata.tempOrderId].filter(Boolean)});
    }
    if(!result.has_more)return rows;
    const next=result.data.at(-1).id;if(next===cursor)throw new Error('Repeated Stripe cursor');cursor=next;
  }
  throw new Error('Stripe extraction exceeded limit; use a shorter period');
}
export async function paypalMovements({env,start,end,fetchImpl=fetch}) {
  if(!env.PAYPAL_CLIENT_ID||!env.PAYPAL_CLIENT_SECRET||!['live','sandbox'].includes(env.PAYPAL_ENV))throw new Error('PayPal reporting credentials/environment missing');
  const base=env.PAYPAL_ENV==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
  const token=await jsonFetch(fetchImpl,base+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  if(!token.access_token)throw new Error('PayPal authentication unavailable');
  const rows=[];
  // Transaction Search accepts at most 31 days. Use disjoint UTC slices and paginate every page.
  for(let from=Date.parse(start);from<Date.parse(end);from+=30*86400000){
    const until=Math.min(from+30*86400000,Date.parse(end));
    for(let page=1;page<=500;page++){
      const params=new URLSearchParams({start_date:new Date(from).toISOString(),end_date:new Date(until-1).toISOString(),fields:'transaction_info',balance_affecting_records_only:'Y',page_size:'500',page:String(page)});
      const result=await jsonFetch(fetchImpl,base+'/v1/reporting/transactions?'+params,{headers:{Authorization:'Bearer '+token.access_token}});
      if(!Array.isArray(result.transaction_details)||!Number.isInteger(result.total_pages))throw new Error('Incomplete PayPal extraction');
      for(const detail of result.transaction_details){
        const t=detail.transaction_info,currency=t.transaction_amount?.currency_code,amount=decimalMinor(t.transaction_amount?.value,currency);
        if(typeof t.transaction_id!=='string'||!t.transaction_id||!Number.isFinite(Date.parse(t.transaction_initiation_date)))throw new Error('Invalid PayPal movement identity or time');
        const kind=!['S','V'].includes(t.transaction_status)?'pending':/^T00\d\d$/.test(t.transaction_event_code)&&amount>0?'sale':['T1107','T1120'].includes(t.transaction_event_code)&&amount<0?'refund':t.transaction_event_code;
        rows.push({id:'paypal:'+t.transaction_id+':'+t.transaction_event_code,provider:'paypal',kind,currency,amount_minor:Math.abs(amount),original_amount_minor:Math.abs(amount),original_currency:currency,created_at:t.transaction_initiation_date,references:[t.transaction_id,t.paypal_reference_id,t.invoice_id,t.custom_field].filter(Boolean)});
      }
      if(page>=result.total_pages)break;
      if(page===500)throw new Error('PayPal extraction exceeded limit');
    }
  }
  return rows;
}
export async function readAll(db,table,columns='*',configure=q=>q,key='id') {
  const rows=[];
  for(let offset=0;offset<100000;offset+=1000){
    const result=await configure(db.from(table).select(columns)).order(key).range(offset,offset+999);
    if(result.error)throw new Error('Database source unavailable');
    rows.push(...result.data);if(result.data.length<1000)return rows;
  }
  throw new Error('Source exceeds extraction limit');
}
export async function collectBusinessReport({db,env,start,end,fetchImpl=fetch,now=new Date()}) {
  const coverage={},data={};
  const previousStart=new Date(Date.parse(start)-(Date.parse(end)-Date.parse(start))).toISOString();
  const load=async(key,fn)=>{try{data[key]=await fn();coverage[key]={status:'available',fetched_at:now.toISOString()};}catch(error){data[key]=[];coverage[key]={status:'unavailable',reason:error.message,fetched_at:now.toISOString()};}};
  await Promise.all([
    load('stripe',()=>stripeMovements({env,start:previousStart,end,fetchImpl})),load('paypal',()=>paypalMovements({env,start:previousStart,end,fetchImpl})),
    load('storefront',()=>readAll(db,'reporting_order_facts','id,user_id,status,payment_status,total_amount_cents,currency,stripe_session_id,paypal_order_id,paypal_capture_id,wallet_prints_spent,required_prints,refunded_at,created_at,metadata,archived_at')),
    load('prints_ledger',()=>readAll(db,'reporting_ledger_facts','id,entry_type,prints_delta,related_order_id,external_reference,created_at,metadata')),
    ...[['exceptions','operation_exceptions'],['ideas','growth_ideas'],['journey','journey_events'],['attempts','checkout_attempts'],['health','operation_health'],['campaigns','feedback_campaigns'],['invitations','feedback_invitations']].map(([key,table])=>load(key,()=>readAll(db,table))),
    load('pdf_jobs',()=>readAll(db,'order_pdf_generations','order_id,status',q=>q,'order_id')),
    load('shipping',()=>readAll(db,'shipment_tracking_notifications','id,order_id,status,created_at')),
    load('delivery',()=>readAll(db,'report_deliveries','id,status,created_at')),
    load('claims',async()=>{const result=await db.from('feedback_claims').select('invitation_id,user_id,ledger_id,created_at').limit(10001);if(result.error||result.data.length>10000)throw new Error('Claims source unavailable or too large');return result.data;}),
  ]);
  // Provider reporting is delayed: an incomplete freshness horizon must never appear reconciled.
  if(coverage.paypal.status==='available'&&Date.parse(end)>now.getTime()-3*3600000)coverage.paypal={...coverage.paypal,status:'provisional',reason:'PayPal reporting can lag; re-run at least three hours after period end'};
  const report=buildBusinessReport({start,end,fetchedAt:now.toISOString(),movements:[...data.stripe,...data.paypal],orders:data.storefront,ledger:data.prints_ledger,coverage,exceptions:data.exceptions,ideas:data.ideas,events:data.journey,attempts:data.attempts,health:data.health,campaigns:data.campaigns,invitations:data.invitations,claims:data.claims,agedHours:Number(env.REPORT_AGED_ORDER_HOURS)||72,conversionValidated:env.CONVERSION_VALIDATED==='true'});
  report.operations.pdf_failures=coverage.pdf_jobs.status==='available'?data.pdf_jobs.filter(j=>j.status==='failed').map(j=>({order_id:j.order_id,issue:'pdf_failed',owner:env.OPERATIONS_OWNER||'Operations',next_action:'Inspect the PDF worker job; retry after correcting the source'})):null;
  report.operations.shipping_exceptions=coverage.shipping.status==='available'?data.shipping.filter(s=>['failed','unknown','sending'].includes(s.status)).map(s=>({id:s.id,order_id:s.order_id,issue:'Shipping notification '+s.status,created_at:s.created_at})):null;
  report.operations.delivery_exceptions=coverage.delivery.status==='available'?data.delivery.filter(d=>['failed','uncertain','sending'].includes(d.status)):null;
  if(coverage.storefront.status!=='available'){report.operations.aged_orders=null;for(const key of ['repeat_paid_orders','affiliate_orders','partner_orders'])report.growth[key]=null;}
  if(coverage.health.status!=='available')report.operations.health_failures=null;
  if(coverage.exceptions.status!=='available')report.operations.exceptions=null;
  if(coverage.ideas.status!=='available')report.growth.experiments=null;
  if(['campaigns','invitations','claims'].some(key=>coverage[key].status!=='available'))report.campaigns=null;
  const previous=buildBusinessReport({start:previousStart,end:start,fetchedAt:now.toISOString(),movements:[...data.stripe,...data.paypal],orders:data.storefront,ledger:data.prints_ledger,coverage});
  const comparable=report.financials.reconciliation.status==='matched'&&previous.financials.reconciliation.status==='matched';
  report.comparison={period:previous.financials.period,status:comparable?'matched':'unverified',currencies:previous.financials.currencies,net_cash_change:comparable?[...new Set([...report.financials.currencies,...previous.financials.currencies].map(c=>c.currency))].map(currency=>{
    const current=report.financials.currencies.find(c=>c.currency===currency)?.net_cash_minor||0,before=previous.financials.currencies.find(c=>c.currency===currency)?.net_cash_minor||0;
    return{currency,change_minor:current-before,change_percent:before>0?(current-before)/before*100:null};
  }):null};
  return report;
}
