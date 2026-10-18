// The storage fetch never receives the user's authorization header.
export async function downloadTeamOrderPdfs({ orderId, parts, request, saveFile, fetchFile = fetch, signal, onProgress = () => {} }) {
  const query = params => '/api/team-order-downloads?' + new URLSearchParams({order:orderId,...params});
  const check = () => { if (signal?.aborted) throw new DOMException('Download cancelled.','AbortError'); };
  if (!Number.isInteger(parts) || parts < 1) throw new Error('No completed PDFs are available.');
  for (let index=0;index<parts;index++) {
    check(); onProgress('Downloading PDF part '+(index+1)+' of '+parts+'…');
    const file = await request(query({type:'pdf',index:String(index)})); check();
    const response = await fetchFile(file.url, {credentials:'omit',referrerPolicy:'no-referrer',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)});
    if (!response.ok) throw new Error('Could not download this PDF. Refresh the files and try again.');
    const blob = await response.blob(); check();
    if ((await blob.slice(0,5).text()) !== '%PDF-') throw new Error('The downloaded file is not a valid PDF. Please retry.');
    await request(query({type:'manifest'})); check();
    await saveFile(blob,file.filename);
  }
  onProgress(parts+' PDF file'+(parts===1?'':'s')+' downloaded.');
}
