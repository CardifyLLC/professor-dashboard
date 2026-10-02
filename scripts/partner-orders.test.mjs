import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerOrdersHandler } from '../server/partner-orders.mjs';
import { attachPartnerArtwork, isPartnerOrder, parsePartnerImage, partnerCards } from '../src/services/partnerArtwork.mjs';

const orderId='00000000-0000-4000-a000-000000000001';
const frontId='00000000-0000-4000-a000-000000000002';
const backId='00000000-0000-4000-a000-000000000003';
const order={id:orderId,status:'paid',payment_status:'paid',quantity:3,metadata:{partnerCartId:'cart_real'}};
const manifest={order_id:orderId,status:'paid',ready:true,files:[
  {id:backId,item_index:0,side:'back',quantity:3,state:'stored'},
  {id:frontId,item_index:0,side:'front',quantity:3,state:'stored'},
]};
function fixture(options={}) {
  const calls=[],updates=[];
  let storedOrder=structuredClone(options.order || order);
  const createClient=()=>({
    auth:{getUser:async()=>options.invalidToken?{error:new Error('invalid')}:{data:{user:{id:'admin-1'}}}},
    from(table) {
      const filters={}; let changes;
      const result=()=>{
        if(table==='dashboard_admins')return {data:options.nonAdmin?null:{user_id:'admin-1'}};
        if(table==='orders') {
          if(options.missingOrder || filters.id!==orderId)return {error:new Error('not found')};
          if(changes) {updates.push(changes);storedOrder={...storedOrder,...changes};}
          return {data:storedOrder};
        }
        throw new Error('Unexpected table');
      };
      const query={select(){return query;},eq(k,v){filters[k]=v;return query;},update(v){changes=v;return query;},single:async()=>result(),maybeSingle:async()=>result()};
      return query;
    },
  });
  const env={VITE_SUPABASE_URL:'https://main.example',VITE_SUPABASE_ANON_KEY:'public',PARTNER_PLATFORM_ORIGIN:'https://partner.example',PARTNER_INTERNAL_SECRET:'s'.repeat(64),...options.env};
  const handler=createPartnerOrdersHandler({createClient,env,fetchImpl:async(url,request)=>{
    const body=JSON.parse(request.body); calls.push({url,request,body});
    if(options.remoteError)return {ok:false,status:409,json:async()=>({error:{message:'Artwork blocked'}})};
    if(url.endsWith('/orders'))return {ok:true,json:async()=>({received:true})};
    return {ok:true,json:async()=>body.file_id?{files:[{id:body.file_id,url:'https://private.example/signed'}]}:{...manifest,...options.manifest}};
  }});
  return {calls,updates,env,async request(body={action:'manifest',orderId},extra={}) {
    const headers={}; let result;
    await handler({method:'POST',headers:{authorization:'Bearer user-token'},body,...extra},{setHeader:(k,v)=>{headers[k]=v;},set statusCode(v){headers.status=v;},end:s=>{result=JSON.parse(s);}});
    return {status:headers.status,headers,body:result};
  }};
}

test('manifest preserves ordered front/back pairs, quantities and identifier-only references',()=>{
  const hydrated=attachPartnerArtwork(order,manifest);
  assert.equal(hydrated.card_data.length,1);
  assert.equal(hydrated.card_data[0].quantity,3);
  assert.deepEqual(parsePartnerImage(hydrated.card_data[0].frontUrl),{orderId,fileId:frontId});
  assert.deepEqual(parsePartnerImage(hydrated.card_data[0].backUrl),{orderId,fileId:backId});
  assert.deepEqual(hydrated.card_images,[]);
  assert.ok(!JSON.stringify(hydrated).includes('https://'));
  assert.equal(isPartnerOrder({...order,metadata:JSON.stringify(order.metadata)}),true);
  assert.throws(()=>attachPartnerArtwork({...order,quantity:4},manifest),/quantities/);
  assert.throws(()=>partnerCards(orderId,{...manifest,files:manifest.files.slice(1)}),/front\/back/);
  assert.deepEqual(partnerCards(orderId,{...manifest,ready:false}),[]);
  assert.throws(()=>parsePartnerImage('https://attacker.example'),/Invalid/);
});

test('an existing paid API order loads its private cards even when legacy image fields are empty',()=>{
  const saved={...order,quantity:1,metadata:JSON.stringify(order.metadata),card_images:[],card_data:[{id:'cart_real_0',finish:'standard',quantity:1}]};
  const files=manifest.files.map(file=>({...file,quantity:1}));
  const hydrated=attachPartnerArtwork(saved,{...manifest,files});
  assert.equal(isPartnerOrder(saved),true);
  assert.equal(hydrated.card_data.length,1);
  assert.deepEqual(parsePartnerImage(hydrated.card_data[0].frontUrl),{orderId,fileId:frontId});
  assert.deepEqual(parsePartnerImage(hydrated.card_data[0].backUrl),{orderId,fileId:backId});
  assert.equal(hydrated.card_data[0].quantity,1);
  assert.deepEqual(saved.card_images,[]);
  const pending=attachPartnerArtwork(saved,{...manifest,ready:false,files});
  assert.deepEqual(pending.card_data,[]);
});
test('rejects unauthenticated and non-admin callers before contacting manufacturing',async()=>{
  for(const [options,extra,status] of [[{},{headers:{}},401],[{invalidToken:true},{},401],[{nonAdmin:true},{},403]]) {
    const f=fixture(options),result=await f.request(undefined,extra);
    assert.equal(result.status,status);assert.equal(f.calls.length,0);
  }
});
test('only existing partner orders can access manufacturing; main payment state gates files',async()=>{
  for(const [options,status] of [[{missingOrder:true},404],[{order:{...order,metadata:{}}},400],[{order:{...order,status:'pending',payment_status:'unpaid'}},409],[{order:{...order,payment_status:'refunded'}},409]]) {
    const f=fixture(options),result=await f.request({action:'file',orderId,fileId:frontId});
    assert.equal(result.status,status);assert.equal(f.calls.length,0);
  }
});
test('manifest uses only the server secret and order identity, with no persistent image writes',async()=>{
  const f=fixture();const result=await f.request({action:'manifest',orderId,cart_id:'cart_forged'});
  assert.equal(result.status,200);assert.equal(result.body.ready,true);
  assert.equal(f.calls[0].url,'https://partner.example/api/internal/production');
  assert.equal(f.calls[0].body.order_id,orderId);assert.equal(f.calls[0].body.include_urls,false);
  assert.equal(f.calls[0].body.prepare,true);assert.equal(f.calls[0].body.actor,'dashboard:admin-1');
  assert.equal(f.calls[0].request.headers.Authorization,`Bearer ${f.env.PARTNER_INTERNAL_SECRET}`);
  assert.equal(result.headers['Cache-Control'],'private, no-store');
  assert.ok(!JSON.stringify(result.body).includes(f.env.PARTNER_INTERNAL_SECRET));assert.equal(f.updates.length,0);
});
test('files are resolved afresh for each use and blocked production fails closed',async()=>{
  const f=fixture();
  for(let i=0;i<2;i++)assert.equal((await f.request({action:'file',orderId,fileId:frontId})).body.url,'https://private.example/signed');
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].body.file_id,frontId);
  const blocked=fixture({remoteError:true});
  assert.equal((await blocked.request({action:'file',orderId,fileId:frontId})).status,409);
  assert.equal(blocked.updates.length,0);
});
test('processing and shipment synchronize the actual cart before updating the main order',async()=>{
  const f=fixture();const shipment={carrier:'USPS',tracking_number:'123',tracking_url:'https://carrier.example/123'};
  assert.equal((await f.request({action:'status',orderId,status:'shipped',shipment,cart_id:'forged'})).status,200);
  assert.equal(f.calls[1].body.cart_id,'cart_real');assert.deepEqual(f.calls[1].body.shipment,shipment);
  assert.equal(f.updates[0].metadata.partnerCartId,'cart_real');assert.equal(f.updates[0].metadata.manufacturingStatus,'shipped');
  const blocked=fixture({remoteError:true});
  assert.equal((await blocked.request({action:'status',orderId,status:'processing'})).status,409);assert.equal(blocked.updates.length,0);
  const premature=fixture();
  assert.equal((await premature.request({action:'status',orderId,status:'completed'})).status,409);assert.equal(premature.updates.length,0);
  assert.equal((await fixture().request({action:'status',orderId,status:'paid'})).status,400);
});
