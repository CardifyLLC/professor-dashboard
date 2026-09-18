import { supabase, supabaseAdmin, getAdminAuthHeaders } from './supabaseClient';

const ordersClient = supabaseAdmin;
const ORDER_TIME_ZONE = 'America/Los_Angeles';

const pacificDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ORDER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

const getDateTimeParts = (value) => Object.fromEntries(
    pacificDateTimeFormatter.formatToParts(value)
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)])
);

const pacificMidnightToUtc = (date) => {
    const [year, month, day] = date.split('-').map(Number);
    const targetAsUtc = Date.UTC(year, month - 1, day);
    const rendered = getDateTimeParts(new Date(targetAsUtc));
    const renderedAsUtc = Date.UTC(
        rendered.year,
        rendered.month - 1,
        rendered.day,
        rendered.hour,
        rendered.minute,
        rendered.second
    );
    return new Date(targetAsUtc - (renderedAsUtc - targetAsUtc));
};

export const getCurrentPacificDate = () => {
    const { year, month, day } = getDateTimeParts(new Date());
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const awardCashPurchaseReward = async (orderId) => {
    const headers = await getAdminAuthHeaders();
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/award-cash-reward`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Cash reward failed with HTTP ${response.status}.`);
    return result;
};

export const ORDER_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'completed', 'cancelled'];

/**
 * Fetches all orders from the 'orders' table.
 * Used for Analytics and Customers views where full dataset is needed.
 * @returns {Promise<Array>} List of orders
 */
export const fetchAllOrders = async () => {
    const pageSize = 1000;
    let from = 0;
    let allOrders = [];

    while (true) {
        const { data, error } = await ordersClient
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false })
            .range(from, from + pageSize - 1);

        if (error) {
            console.error('Error fetching all orders:', error);
            throw error;
        }

        const page = data || [];
        allOrders = allOrders.concat(page);

        if (page.length < pageSize) {
            break;
        }

        from += pageSize;
    }

    return allOrders;
};

const getOrderAffiliateCode = (order) => {
    const metadata = order?.metadata && typeof order.metadata === 'object' ? order.metadata : {};
    return [
        order?.affiliate_code, order?.referral_code, order?.coupon_code,
        metadata.affiliate_code, metadata.affiliateCode,
        metadata.affiliate_referral_code, metadata.affiliateReferralCode,
        metadata.referral_code, metadata.referralCode,
        metadata.coupon_code, metadata.couponCode,
    ].find((value) => typeof value === 'string' && value.trim())?.trim().toUpperCase() || '';
};

/**
 * Returns orders attributed to an approved affiliate. Affiliate links apply
 * their code at checkout, so link and code orders share the same attribution.
 */
export const fetchAffiliateOrders = async () => {
    const { data: affiliates, error: affiliatesError } = await ordersClient
        .from('affiliate_applications')
        .select('id,name,email,affiliate_code,affiliate_link,status')
        .eq('status', 'approved')
        .not('affiliate_code', 'is', null);
    if (affiliatesError) throw affiliatesError;

    const affiliatesByCode = new Map((affiliates || [])
        .filter((affiliate) => affiliate.affiliate_code)
        .map((affiliate) => [affiliate.affiliate_code.trim().toUpperCase(), affiliate]));
    if (affiliatesByCode.size === 0) return [];

    const pageSize = 1000;
    let from = 0;
    const attributedOrders = [];
    while (true) {
        const { data, error } = await ordersClient
            .from('orders')
            .select('id,customer_name,customer_email,created_at,status,total_amount_cents,quantity,coupon_code,metadata')
            .order('created_at', { ascending: false })
            .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = data || [];
        page.forEach((order) => {
            const affiliateCode = getOrderAffiliateCode(order);
            const affiliate = affiliatesByCode.get(affiliateCode);
            if (affiliate) attributedOrders.push({ ...order, affiliateCode, affiliate });
        });
        if (page.length < pageSize) break;
        from += pageSize;
    }
    return attributedOrders;
};

/**
 * Fetches paid orders with only the fields BatchPro needs.
 * This is much faster than fetching all orders then filtering client-side.
 * @returns {Promise<Array>} Paid orders with card_images
 */
export const fetchPaidOrdersForBatcher = async () => {
    const { data, error } = await ordersClient
        .from('orders')
        .select('id, customer_name, status, created_at, card_images, card_data, metadata')
        .in('status', ['paid', 'PAID'])
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching paid orders:', error);
        throw error;
    }
    return (data || []).filter(order => order.metadata?.productType !== 'cardstock');
};

/** Returns the current automatic PDF state for one order. */
export const fetchOrderPdfGeneration = async (orderId) => {
    const { data, error } = await ordersClient
        .from('order_pdf_generations')
        .select('order_id, status, storage_path, storage_paths, error_message, completed_at, total_cards, processed_cards, total_parts, completed_parts')
        .eq('order_id', orderId)
        .maybeSingle();
    if (error) throw error;
    return data;
};

/** Creates a short-lived private download URL for one completed order PDF. */
export const createOrderPdfDownloadUrl = async (storagePath) => {
    const { data, error } = await supabase.storage
        .from('order-pdfs')
        .createSignedUrl(storagePath, 10 * 60, { download: true });
    if (error) throw error;
    if (!data?.signedUrl) throw new Error('Could not create the PDF download link.');
    return data.signedUrl;
};

/** Returns automatic PDF states for the visible order rows in one request. */
export const fetchOrderPdfGenerations = async (orderIds) => {
    if (!orderIds.length) return [];
    const { data, error } = await ordersClient
        .from('order_pdf_generations')
        .select('order_id, status, error_message, total_cards, processed_cards, total_parts, completed_parts')
        .in('order_id', orderIds);
    if (error) throw error;
    return data || [];
};

/** Creates short-lived private URLs for all parts of a generated order PDF. */
export const createOrderPdfDownloadUrls = async (storagePaths) => {
    const { data, error } = await supabase.storage
        .from('order-pdfs')
        .createSignedUrls(storagePaths, 10 * 60, { download: true });
    if (error) throw error;
    const urls = (data || []).map(item => item.signedUrl).filter(Boolean);
    if (urls.length !== storagePaths.length) throw new Error('Could not create all PDF download links.');
    return urls;
};

/** Returns completed PDFs for orders placed on the selected Pacific calendar date. */
export const fetchCompletedOrderPdfsByDate = async (date) => {
    if (!date) return [];
    const start = pacificMidnightToUtc(date);
    const [year, month, day] = date.split('-').map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    const end = pacificMidnightToUtc(nextDate);

    const pageSize = 1000;
    let from = 0;
    const orderIds = [];
    while (true) {
        const { data, error } = await ordersClient
            .from('orders')
            .select('id')
            .gte('created_at', start.toISOString())
            .lt('created_at', end.toISOString())
            .order('created_at', { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = data || [];
        orderIds.push(...page.map(order => order.id));
        if (page.length < pageSize) break;
        from += pageSize;
    }

    if (!orderIds.length) return [];

    const results = [];
    // Keep each PostgREST URL reasonably small when a day contains many orders.
    for (let index = 0; index < orderIds.length; index += 200) {
        const { data, error } = await ordersClient
            .from('order_pdf_generations')
            .select('order_id, storage_path, storage_paths, completed_at')
            .in('order_id', orderIds.slice(index, index + 200))
            .eq('status', 'completed')
            .order('completed_at', { ascending: true });
        if (error) throw error;
        results.push(...(data || []));
    }
    return results;
};

// Backward-compatible exports for deployments that still contain the previous
// Dashboard bundle. The current Dashboard no longer renders the bulk button.
export const fetchNewOrderPdfs = async () => {
    const { data, error } = await ordersClient
        .from('order_pdf_generations')
        .select('order_id, storage_path, completed_at')
        .eq('status', 'completed')
        .is('downloaded_at', null)
        .not('storage_path', 'is', null)
        .order('completed_at', { ascending: true });
    if (error) throw error;
    return data || [];
};

export const markOrderPdfsDownloaded = async (orderIds) => {
    if (!orderIds.length) return;
    const { error } = await ordersClient
        .from('order_pdf_generations')
        .update({ downloaded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('order_id', orderIds);
    if (error) throw error;
};

/**
 * Fetches all orders matching current filters (no pagination) — used for Excel export.
 * @param {string} searchTerm
 * @param {string} statusFilter
 * @param {string} dateFrom
 * @param {string} dateTo
 * @returns {Promise<Array>}
 */
export const fetchOrdersForExport = async (searchTerm = '', statusFilter = 'all', dateFrom = '', dateTo = '') => {
    let query = ordersClient
        .from('orders')
        .select('id, customer_name, customer_email, created_at, status, total_amount_cents, quantity')
        .order('created_at', { ascending: false });

    if (searchTerm) {
        query = query.or(`customer_name.ilike.%${searchTerm}%,customer_email.ilike.%${searchTerm}%`);
    }
    if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
    }
    if (dateFrom) {
        query = query.gte('created_at', new Date(dateFrom + 'T00:00:00').toISOString());
    }
    if (dateTo) {
        query = query.lte('created_at', new Date(dateTo + 'T23:59:59.999').toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
};

/**
 * Fetches paginated orders with optional search.
 * @param {number} page - Page number (1-indexed)
 * @param {number} pageSize - Number of items per page
 * @param {string} searchTerm - Optional search term
 * @param {string} statusFilter - Optional order status filter
 * @returns {Promise<{data: Array, count: number}>} List of orders and total count
 */
export const fetchOrders = async (page = 1, pageSize = 20, searchTerm = '', statusFilter = 'all', dateFrom = '', dateTo = '') => {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = ordersClient
        .from('orders')
        .select('id, customer_name, customer_email, created_at, status, total_amount_cents, quantity, shipping_address, metadata, uploaded_xml_filename, uploaded_xml_content', { count: 'exact' });

    if (searchTerm) {
        query = query.or(`customer_name.ilike.%${searchTerm}%,customer_email.ilike.%${searchTerm}%`);
    }

    if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
    }

    if (dateFrom) {
        // T00:00:00 without Z = local midnight, avoids UTC shift
        query = query.gte('created_at', new Date(dateFrom + 'T00:00:00').toISOString());
    }

    if (dateTo) {
        // T23:59:59.999 without Z = local end-of-day, includes the full selected date
        query = query.lte('created_at', new Date(dateTo + 'T23:59:59.999').toISOString());
    }

    const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

    if (error) {
        console.error('Error fetching paginated orders:', error);
        throw error;
    }
    return { data, count };
};

/**
 * Fetches a single order by ID with all details including card_images and card_data.
 * @param {string} orderId - The order ID
 * @returns {Promise<object>} Full order object with all fields
 */
export const fetchOrderById = async (orderId) => {
    const { data, error } = await ordersClient
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

    if (error) {
        console.error('Error fetching order by ID:', error);
        throw error;
    }
    return data;
};

/**
 * Best-effort detection for orders that were created from XML uploads/imports.
 * Uses explicit XML fields first, then falls back to metadata keys that mention XML.
 * @param {object} order
 * @returns {boolean}
 */
export const isXmlOrder = (order) => {
    if (!order) return false;

    if (hasUploadedXml(order)) {
        return true;
    }

    const directFields = [
        order.xml_url,
        order.xml_link,
        order.xml_file_url,
        order.xml_download_url,
        order.xml_path,
        order.xml_file_path,
        order.order_xml_url,
        order.order_xml_path,
        order.xml_content,
        order.xml_data,
        order.order_xml,
        order.xml,
    ];

    if (directFields.some(Boolean)) {
        return true;
    }

    let metadata = order.metadata;
    if (typeof metadata === 'string') {
        try {
            metadata = JSON.parse(metadata);
        } catch {
            metadata = null;
        }
    }

    if (!metadata || typeof metadata !== 'object') {
        return false;
    }

    return Object.keys(metadata).some((key) => key.toLowerCase().includes('xml'));
};

/**
 * Returns true when the order has stored uploaded XML content.
 * @param {object} order
 * @returns {boolean}
 */
export const hasUploadedXml = (order) => {
    if (!order) return false;
    return typeof order.uploaded_xml_content === 'string' && order.uploaded_xml_content.length > 0;
};

/**
 * Returns the filename to use for downloading uploaded XML content.
 * @param {object} order
 * @returns {string}
 */
export const getUploadedXmlFilename = (order) => {
    const filename = typeof order?.uploaded_xml_filename === 'string' ? order.uploaded_xml_filename.trim() : '';
    if (filename) return filename;
    return `order-${order?.id ?? 'unknown'}.xml`;
};

/**
 * Downloads the exact uploaded XML stored on the order row.
 * @param {object} order
 */
export const downloadUploadedXml = (order) => {
    if (!hasUploadedXml(order)) {
        return false;
    }

    const blob = new Blob([order.uploaded_xml_content], { type: 'application/xml' });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = objectUrl;
    link.download = getUploadedXmlFilename(order);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
    }, 0);

    return true;
};

/**
 * Generates a public URL for an image in the 'order-images' bucket.
 * @param {string} path - The path of the image in the bucket
 * @returns {string} Public URL
 */
export const getOrderImageUrl = (path) => {
    if (!path) return null;
    const trimmed = String(path).trim();

    // If it's already a URL/data/blob, return it as-is
    if (trimmed.startsWith('http')) return trimmed;
    if (trimmed.startsWith('data:')) return trimmed;
    if (trimmed.startsWith('blob:')) return trimmed;

    // Some rows store raw base64 without a data: prefix.
    // Detect and convert to a data URL so <img> can load it.
    // (Avoid treating normal storage paths like "folder/file.png" as base64.)
    const looksLikeRawBase64 =
        trimmed.length > 256 &&
        !trimmed.includes('/') &&
        !trimmed.includes('.') &&
        /^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed);

    if (looksLikeRawBase64) {
        // Normalize URL-safe base64 to standard base64 (+ / with padding)
        let b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
        const pad = b64.length % 4;
        if (pad) b64 += '='.repeat(4 - pad);

        // Best-effort mime sniffing by common signatures
        let mime = 'image/png';
        if (b64.startsWith('/9j/')) mime = 'image/jpeg';
        else if (b64.startsWith('iVBOR')) mime = 'image/png';
        else if (b64.startsWith('R0lGOD')) mime = 'image/gif';
        else if (b64.startsWith('UklGR')) mime = 'image/webp';

        return `data:${mime};base64,${b64}`;
    }

    const { data } = supabase.storage
        .from('order-images')
        .getPublicUrl(trimmed);

    return data.publicUrl;
};

/**
 * Updates the card_data field for an order.
 * @param {string} orderId - The order ID
 * @param {Array} cardData - The updated card_data array
 * @returns {Promise<object>} Updated order object
 */
export const updateOrderCardData = async (orderId, cardData) => {
    const { data, error } = await ordersClient
        .from('orders')
        .update({ card_data: JSON.stringify(cardData) })
        .eq('id', orderId)
        .select()
        .single();

    if (error) {
        console.error('Error updating order card data:', error);
        throw error;
    }
    return data;
};

/**
 * Updates the card_images field for an order.
 * @param {string} orderId - The order ID
 * @param {Array} cardImages - The updated card_images array
 * @returns {Promise<object>} Updated order object
 */
export const updateOrderCardImages = async (orderId, cardImages) => {
    const { data, error } = await ordersClient
        .from('orders')
        .update({ card_images: JSON.stringify(cardImages) })
        .eq('id', orderId)
        .select()
        .single();

    if (error) {
        console.error('Error updating order card images:', error);
        throw error;
    }
    return data;
};

/**
 * Updates the status field for an order.
 * @param {string} orderId - The order ID
 * @param {string} status - The new order status
 * @returns {Promise<object>} Updated order object
 */
export const updateOrderStatus = async (orderId, status) => {
    if (!ORDER_STATUSES.includes(status)) {
        throw new Error(`Unsupported order status: ${status}`);
    }

    const changes = {
        status,
        ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
    };

    const { data, error } = await ordersClient
        .from('orders')
        .update(changes)
        .eq('id', orderId)
        .select()
        .single();

    if (error) {
        console.error('Error updating order status:', error);
        throw error;
    }
    return data;
};

/**
 * Invokes the privileged reject/refund order function.
 * Stripe and email execution must stay server-side.
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.templateKey
 * @param {string} [params.adminNote]
 * @returns {Promise<object>}
 */
export const rejectAndRefundOrder = async ({ orderId, templateKey, adminNote = '' }) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing Supabase configuration for function invocation.');
    }

    const authHeaders = await getAdminAuthHeaders();
    const response = await fetch(`${supabaseUrl}/functions/v1/reject-order`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
        },
        body: JSON.stringify({
            orderId,
            templateKey,
            adminNote: adminNote.trim(),
        }),
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        throw new Error(payload?.error || payload?.message || `Reject/refund failed with HTTP ${response.status}.`);
    }

    return payload;
};

/**
 * Parses the shipping address JSON if it's a string, or returns it as is.
 * @param {string|object} address 
 * @returns {object}
 */
export const parseAddress = (address) => {
    if (!address) return {};
    if (typeof address === 'object') return address;
    try {
        // Handle double stringified JSON which sometimes happens
        let parsed = JSON.parse(address);
        if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
        }
        return parsed;
    } catch (e) {
        console.error('Error parsing address:', e);
        return {};
    }
};
