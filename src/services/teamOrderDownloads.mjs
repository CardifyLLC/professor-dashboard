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

export async function downloadTeamDayPdfs({ date, request, saveFile, fetchFile = fetch, signal, onProgress = () => {}, pause = () => new Promise(resolve => setTimeout(resolve, 300)) }) {
  const check = () => { if (signal?.aborted) throw new DOMException('Download cancelled.', 'AbortError'); };
  const orders = [], seen = new Set();
  let offset = 0;
  onProgress('Finding completed PDFs…');
  do {
    check();
    const page = await request('/api/team-order-downloads?' + new URLSearchParams({ type: 'day', date, offset: String(offset) }));
    check();
    if (!Array.isArray(page.orders)) throw new Error('Could not load the PDFs for this date. Please retry.');
    for (const order of page.orders) {
      if (!order.orderId || !Number.isInteger(order.parts) || order.parts < 1) throw new Error('Invalid PDF listing. Please retry.');
      if (!seen.has(order.orderId)) { seen.add(order.orderId); orders.push(order); }
    }
    if (page.nextOffset !== null && (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset)) throw new Error('Could not load the next page of PDFs. Please retry.');
    offset = page.nextOffset;
  } while (offset !== null);
  const total = orders.reduce((sum, order) => sum + order.parts, 0);
  let filesDownloaded = 0;
  for (const order of orders) {
    await downloadTeamOrderPdfs({ ...order, request, fetchFile, signal,
      onProgress: () => onProgress(`Downloading ${Math.min(filesDownloaded + 1, total)} of ${total} PDFs…`),
      saveFile: async (blob, name) => {
        check(); await saveFile(blob, name); filesDownloaded++;
        if (filesDownloaded < total) await pause();
      },
    });
  }
  onProgress(total ? `Downloaded ${filesDownloaded} PDF file${filesDownloaded === 1 ? '' : 's'} for ${date} (Pacific).` : 'No completed PDFs found for this date.');
  return { ordersDownloaded: orders.length, filesDownloaded };
}
