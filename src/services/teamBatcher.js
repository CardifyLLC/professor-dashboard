import { dashboardAccessRequest } from './dashboardAccess';
import { isPartnerOrder } from './partnerArtwork.mjs';

export const isTeamArtwork = value => typeof value === 'string' && value.startsWith('team-artwork:');
export const teamBatcherOrder = async id => (await dashboardAccessRequest('/api/team-batcher?'+new URLSearchParams({order:id}))).order;
export async function fetchTeamBatcherOrders() {
  const orders=[];
  let offset=0;
  do {
    const page=await dashboardAccessRequest('/api/team-batcher?offset='+offset);
    for (let start=0;start<page.orders.length;start+=3) {
      orders.push(...await Promise.all(page.orders.slice(start,start+3).map(async order=>{
        if (!isPartnerOrder(order)) return order;
        try { return await teamBatcherOrder(order.id); }
        catch (error) { if ([401,403].includes(error.status)) throw error; return {...order,partnerArtwork:{ready:false,error:error.message}}; }
      })));
    }
    offset=page.nextOffset;
  } while (offset!==null);
  return orders;
}
// Deduplicate concurrent image loads, but never cache a signed URL across uses.
const pending=new Map();
export async function resolveTeamArtwork(value) {
  if (!isTeamArtwork(value)) return value;
  if (pending.has(value)) return pending.get(value);
  const [order,kind,index,field,...extra]=value.slice('team-artwork:'.length).split('/');
  if (extra.length || !order || !kind || !index || !field) throw new Error('Invalid team artwork reference.');
  const params=kind==='partner' ? {order,kind,file:index} : {order,kind,index,field};
  const promise=dashboardAccessRequest('/api/team-batcher?'+new URLSearchParams(params)).then(result=>result.url);
  pending.set(value,promise);
  try {return await promise;} finally {pending.delete(value);}
}
