import { getAdminAuthHeaders } from './supabaseClient';
import { attachPartnerArtwork, isPartnerImage, isPartnerOrder, parsePartnerImage } from './partnerArtwork.mjs';

export async function partnerOrderRequest(body) {
  const response=await fetch('/api/partner-orders',{
    method:'POST',headers:{...await getAdminAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',
  });
  const data=await response.json();
  if(!response.ok)throw new Error(data.error || 'Partner artwork is unavailable.');
  return data;
}
export async function loadPartnerArtwork(order, prepare=true) {
  if(!isPartnerOrder(order))return order;
  try {
    return attachPartnerArtwork(order,await partnerOrderRequest({action:'manifest',orderId:order.id,prepare}));
  } catch(error) {
    return {...order,card_data:[],card_images:[],partnerArtwork:{ready:false,error:error.message}};
  }
}
const pendingImages = new Map();
export async function resolveOrderImage(value) {
  if(!isPartnerImage(value))return value;
  // Multiple copies of a card can mount together; share only the in-flight
  // request, never retain a signed URL for future downloads or print jobs.
  if(!pendingImages.has(value))pendingImages.set(value,
    partnerOrderRequest({action:'file',...parsePartnerImage(value)}).then(data=>data.url).finally(()=>pendingImages.delete(value)));
  return pendingImages.get(value);
}
