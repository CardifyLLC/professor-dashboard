import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { saveAs } from 'file-saver';
import { getCurrentPacificDate } from '../../shared/pacific-date.mjs';
import { dashboardAccessRequest } from '../services/dashboardAccess';
import { downloadTeamDayPdfs } from '../services/teamOrderDownloads.mjs';

export default function TeamDayPdfDownloads({ onAccessLost }) {
  const [date, setDate] = useState(() => getCurrentPacificDate());
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState('');
  const controller = useRef(null), pending = useRef(false);
  useEffect(() => { const ref = controller; return () => { ref.current?.abort(); ref.current = null; }; }, []);
  const download = async event => {
    event.preventDefault();
    if (pending.current || !date) return;
    const abort = new AbortController(); controller.current = abort; pending.current = true;
    setBusy(true); setError('');
    try {
      await downloadTeamDayPdfs({ date, signal: abort.signal,
        request: path => dashboardAccessRequest(path, undefined, AbortSignal.any([abort.signal, AbortSignal.timeout(30000)])),
        saveFile: (blob, name) => saveAs(blob, name),
        onProgress: value => { if (!abort.signal.aborted) setProgress(value); },
      });
    } catch (err) {
      if (controller.current === abort) {
        setProgress(abort.signal.aborted ? 'Download cancelled. Files already downloaded are kept.' : '');
        if (!abort.signal.aborted) { setError(err.message); if ([401, 403].includes(err.status)) onAccessLost(); }
      }
    } finally {
      pending.current = false;
      if (controller.current === abort) { controller.current = null; setBusy(false); }
    }
  };
  return <section className="ta-day-pdfs" aria-label="Download PDFs by order date">
    <form className="ta-toolbar" onSubmit={download}>
      <label className="ta-date-filter">Order date (Pacific)<input type="date" required value={date} disabled={busy} onChange={event => { setDate(event.target.value); setProgress(''); setError(''); }} aria-describedby="day-pdf-help"/></label>
      <button className="ta-primary" type="submit" disabled={busy || !date}><Download size={16}/>{busy ? 'Downloading…' : 'Download day PDFs'}</button>
      {busy && <button type="button" onClick={() => controller.current?.abort()}>Cancel download</button>}
    </form>
    <p id="day-pdf-help" className="ta-small">Downloads all completed PDFs for orders placed on this Pacific date, across all pages. Allow multiple downloads if your browser asks.</p>
    {progress && <p role="status">{progress}</p>}
    {error && <p role="alert" className="ta-error">{error}</p>}
  </section>;
}
