export const ORDER_PDFS_DOWNLOADED_EVENT = 'order-pdfs-downloaded';

export function getOrderPdfPaths(generation) {
    const paths = Array.isArray(generation.storage_paths) && generation.storage_paths.length
        ? generation.storage_paths
        : generation.storage_path ? [generation.storage_path] : [];
    if (generation.status !== 'completed' || !paths.length || paths.some(path => typeof path !== 'string' || !path.trim())
        || (generation.total_parts > 0 && paths.length !== generation.total_parts)) {
        throw new Error(`The PDF for order #${generation.order_id.slice(0, 8)} is not fully ready.`);
    }
    return paths;
}

// Record each order only after every part has arrived and been handed to the
// browser's save operation. Browsers cannot confirm the final OS-level save.
export async function downloadOrderPdfs(generations, {
    createUrls, saveFile, recordDownloaded, fetchFile = fetch,
    onProgress = () => {}, pause = () => Promise.resolve(),
    orderLabel = generation => generation.order_id,
}) {
    const plans = generations.map(generation => ({ generation, paths: getOrderPdfPaths(generation) }));
    const total = plans.reduce((sum, plan) => sum + plan.paths.length, 0);
    let completed = 0;
    const records = [];
    for (const { generation, paths } of plans) {
        const urls = await createUrls(paths);
        if (urls.length !== paths.length || urls.some(url => !url)) throw new Error('Could not create all PDF download links.');
        for (let index = 0; index < urls.length; index += 1) {
            const response = await fetchFile(urls[index]);
            if (!response.ok) throw new Error(`Could not download PDF for order #${generation.order_id.slice(0, 8)} (HTTP ${response.status}).`);
            const blob = await response.blob();
            if ((await blob.slice(0, 5).text()) !== '%PDF-') throw new Error('The downloaded file is not a valid PDF. Please retry.');
            const suffix = urls.length > 1 ? `-part-${index + 1}-of-${urls.length}` : '';
            await saveFile(blob, `order-${orderLabel(generation)}${suffix}.pdf`);
            completed += 1;
            onProgress({ completed, total });
            await pause();
        }
        try {
            records.push(...await recordDownloaded([generation.order_id]));
        } catch (error) {
            throw new Error(`PDF downloaded, but its confirmation could not be saved: ${error.message || error}`);
        }
    }
    return { filesDownloaded: completed, records };
}
