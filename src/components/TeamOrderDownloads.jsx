import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { saveAs } from 'file-saver';
import { dashboardAccessRequest } from '../services/dashboardAccess';
import { downloadTeamOrderPdfs } from '../services/teamOrderDownloads.mjs';

export default function TeamOrderDownloads({ orderId, onAccessLost }) {
  const [files,setFiles]=useState(null), [loading,setLoading]=useState(true), [busy,setBusy]=useState(false);
  const [error,setError]=useState(''), [progress,setProgress]=useState('');
  const controller=useRef(null), pending=useRef(false);
  const load=useCallback(async () => {
    controller.current?.abort(); const abort=new AbortController(); controller.current=abort;
    setLoading(true); setError('');
    try {
      const result=await dashboardAccessRequest('/api/team-order-downloads?'+new URLSearchParams({order:orderId}),undefined,AbortSignal.any([abort.signal,AbortSignal.timeout(30000)]));
      if (!abort.signal.aborted) setFiles(result);
    } catch (err) { if (!abort.signal.aborted) { setError(err.message); if ([401,403].includes(err.status)) onAccessLost(); } }
    finally { if (!abort.signal.aborted) setLoading(false); }
  },[orderId,onAccessLost]);
  useEffect(() => { const ref=controller; load(); return () => ref.current?.abort(); },[load]);
  const download=async () => {
    if (pending.current || !files) return;
    pending.current=true;setBusy(true);setError('');setProgress('Preparing download…');
    const abort=new AbortController();controller.current?.abort();controller.current=abort;
    try {
      await downloadTeamOrderPdfs({orderId,parts:files.pdf.parts,signal:abort.signal,
        request:path=>dashboardAccessRequest(path,undefined,AbortSignal.any([abort.signal,AbortSignal.timeout(30000)])),
        saveFile:(blob,name)=>saveAs(blob,name),
        onProgress:value=>{if (!abort.signal.aborted) setProgress(value);},
      });
    } catch (err) { if (!abort.signal.aborted) {setProgress('');setError(err.message);if ([401,403].includes(err.status)) onAccessLost();} }
    finally {pending.current=false;if (!abort.signal.aborted) setBusy(false);}
  };
  return <section className="ta-downloads" aria-label="Order PDFs">
    <div className="ta-heading"><h3>Order PDFs</h3><button disabled={busy||loading} onClick={load} aria-label="Refresh order files"><RefreshCw size={16}/>Refresh files</button></div>
    {loading ? <p role="status">Checking available files…</p> : files && <>
      <div className="ta-toolbar">
        {files.pdf.parts>0 && <button disabled={busy} onClick={download}><Download size={16}/>Download PDF{files.pdf.parts>1?'s ('+files.pdf.parts+')':''}</button>}
      </div>
      {!files.pdf.parts && <p className="ta-small">{['processing','pending','queued'].includes(files.pdf.status) ? 'The order PDF is still being prepared. Refresh files when it is ready.' : 'No completed order PDF is available.'}</p>}
    </>}
    {progress && <p role="status">{progress}</p>}{error && <p role="alert" className="ta-error">{error}</p>}
  </section>;
}
