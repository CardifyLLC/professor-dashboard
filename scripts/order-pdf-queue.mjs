// PostgREST repeats the filter URL in its Content-Location response header.
// A single IN filter with 400+ UUIDs can exceed Node's response-header limit.
// Keep each request small instead of increasing the HTTP parser's limit.
const ORDER_ID_BATCH_SIZE = 100;

export async function readPdfJobsForOrders(db, orderIds, { select = '*', maxAttempts } = {}) {
  const ids = [...new Set(orderIds)];
  const jobs = [];
  for (let offset = 0; offset < ids.length; offset += ORDER_ID_BATCH_SIZE) {
    let query = db.from('order_pdf_generations').select(select)
      .in('order_id', ids.slice(offset, offset + ORDER_ID_BATCH_SIZE));
    if (maxAttempts !== undefined) {
      query = query.neq('status', 'completed').lt('attempt_count', maxAttempts);
    }
    const { data, error } = await query;
    // Never treat a failed lookup as an empty result: backfill would otherwise
    // try to insert jobs that already exist, or silently skip queued work.
    if (error) throw new Error(`PDF queue lookup failed: ${error.message}`, { cause: error });
    jobs.push(...(data || []));
  }
  return jobs;
}
