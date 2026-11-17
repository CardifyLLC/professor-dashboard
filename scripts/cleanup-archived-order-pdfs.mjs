// Server/GitHub Actions only. Never expose the service key in the browser.
const scope = process.env.CLEANUP_ENVIRONMENT;
const projects = { production: 'dunoesykjvdnpeavojsi', testing: 'jsxkyzdijoawzaiwfkfc' };
const project = projects[scope];
if (!project) throw new Error('CLEANUP_ENVIRONMENT must be production or testing');
const base = `https://${project}.supabase.co`;
if (process.env.SUPABASE_URL?.replace(/\/$/, '') !== base) throw new Error('Cleanup project mismatch');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error('Missing server service key');
const execute = process.argv.includes('--execute');
if (!execute) {
  console.log('Dry run: checks the first 25 queued PDF folders; no files will be deleted.');
}
let deleted = 0;
for (let batch = 0; batch < (execute ? 100 : 1); batch++) {
  const response = await fetch(`${base}/functions/v1/storage_cleanup_queue?bucket=order-pdfs&limit=25&dry_run=${!execute}`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key },
    signal: AbortSignal.timeout(140000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`PDF cleanup failed (HTTP ${response.status}); inspect storage_cleanup_queue.error before retrying`);
  const result = await response.json();
  if (!Array.isArray(result.results) || result.results.some(r => r.error)) throw new Error('Cleanup returned unconfirmed results');
  deleted += result.results.reduce((n, r) => n + r.deleted, 0);
  console.log(JSON.stringify({ environment: scope, batch: batch + 1, folders: result.processed, deleted, dry_run: !execute,
    ...(execute ? {} : { candidates: result.results.reduce((n, r) => n + r.candidates, 0) }) }));
  if (!execute || result.processed < 25) break;
  if (batch === 99) throw new Error('Cleanup batch limit reached; run again to finish the backlog');
}
