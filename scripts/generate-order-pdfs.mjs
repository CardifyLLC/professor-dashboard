import { createClient } from '@supabase/supabase-js';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GITHUB_WORKFLOW_TOKEN = process.env.GITHUB_WORKFLOW_TOKEN;
const GITHUB_REPOSITORY_NAME = process.env.GITHUB_REPOSITORY_NAME;
const CUSTOMER_APP_URL = (process.env.CUSTOMER_APP_URL || 'https://tcgplaytest.com').replace(/\/$/, '');
const ORDER_PDF_WEBHOOK_SECRET = process.env.ORDER_PDF_WEBHOOK_SECRET;
const MAX_ORDERS = Math.max(1, Number.parseInt(process.env.MAX_ORDERS || '3', 10) || 3);
const MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.MAX_ATTEMPTS || '5', 10) || 5);
const STALE_MS = 30 * 60 * 1000;
const IMAGE_TIMEOUT_MS = 30_000;
// Match BatcherPRO's locked canvas export: 67 x 92 mm at 1,200 DPI, encoded
// with its quality-0.50 JPEG profile.
const TARGET_DPI = 1200;
const IMAGE_WIDTH = Math.ceil(67 / 25.4 * TARGET_DPI);
const IMAGE_HEIGHT = Math.ceil(92 / 25.4 * TARGET_DPI);
const IMAGE_QUALITY = 50;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const mmToPt = value => value * 72 / 25.4;
const PAGE_WIDTH = mmToPt(457.2);
const PAGE_HEIGHT = mmToPt(304.8);
const CARD_WIDTH = mmToPt(67);
const CARD_HEIGHT = mmToPt(92);
const MARGIN_TOP = mmToPt(15.5);
const MARGIN_LEFT = mmToPt(9.7);
const GAP_X = mmToPt(2.6);
const GAP_Y = mmToPt(6.4);
const REG_MARK_X = mmToPt(7);
const REG_MARK_Y = mmToPt(60.4);
const REG_MARK_WIDTH = mmToPt(3.3);
const REG_MARK_HEIGHT = mmToPt(60);
const COLS = 6;
const CARDS_PER_SHEET = 18;
// The printer requires large orders in parts of no more than 20 duplex sheets:
// 20 front pages + 20 back pages = 40 PDF pages (360 cards) per file.
// The order-pdfs bucket is configured with a 500 MB object limit for these
// full-quality 1,200 DPI parts.
const MAX_SHEETS_PER_FILE = 20;
const MAX_CARDS_PER_FILE = CARDS_PER_SHEET * MAX_SHEETS_PER_FILE;

const asArray = value => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const asObject = value => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const positiveInteger = (value, fallback = 1) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const imageCandidates = (value) => {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path) return [];
  if (path.startsWith('data:')) return [path];
  if (/^https?:\/\//i.test(path)) return [path];
  const normalized = path
    .replace(/^\/+/, '')
    .replace(/^order-images\//i, '')
    .replace(/^storage\/v1\/object\/(?:public\/)?order-images\//i, '');
  const encoded = normalized.split('/').map(encodeURIComponent).join('/');
  return [
    `${SUPABASE_URL}/storage/v1/object/authenticated/order-images/${encoded}`,
    `${SUPABASE_URL}/storage/v1/object/public/order-images/${encoded}`,
  ];
};

const imageCandidatesFromValues = values => [...new Set(
  values.flatMap(value => imageCandidates(value)),
)];

const isBackPath = value => {
  const path = String(value || '').toLowerCase().split('?')[0];
  return /(?:^|[\/_-])back\.(?:png|jpe?g|webp|gif|avif)$/.test(path);
};

const isMaskPath = value => /mask|silver/i.test(String(value || ''));

const cardsFromOrder = order => {
  const metadata = asObject(order.metadata);
  const proMode = metadata.proMode === true || metadata.pro_mode === true;
  const deckQuantity = positiveInteger(order.deck_quantity ?? metadata.deckQuantity, 1);
  const structured = asArray(order.card_data);
  const cards = [];

  for (const rawCard of structured) {
    const card = asObject(rawCard);
    const frontValues = proMode
      ? [card.originalFrontUrl, card.originalFront, card.frontUrl, card.front]
      : [card.frontUrl, card.front, card.originalFrontUrl, card.originalFront];
    const backValues = proMode
      ? [card.originalBackUrl, card.originalBack, card.backUrl, card.back]
      : [card.backUrl, card.back, card.originalBackUrl, card.originalBack];
    const front = imageCandidatesFromValues(frontValues);
    const back = imageCandidatesFromValues(backValues);
    if (!front.length) continue;
    const copies = positiveInteger(card.quantity, 1) * deckQuantity;
    for (let copy = 0; copy < copies; copy += 1) {
      cards.push({ front, back });
    }
  }
  if (cards.length) return cards;

  const images = asArray(order.card_images)
    .filter(value => typeof value === 'string' && value.trim() && !isMaskPath(value));
  for (let index = 0; index < images.length;) {
    const front = images[index];
    if (isBackPath(front)) {
      index += 1;
      continue;
    }
    const possibleBack = images[index + 1];
    const back = possibleBack && isBackPath(possibleBack) ? possibleBack : null;
    for (let copy = 0; copy < deckQuantity; copy += 1) {
      cards.push({ front: imageCandidates(front), back: imageCandidates(back) });
    }
    index += back ? 2 : 1;
  }
  return cards;
};

const fetchImage = async urls => {
  let lastError;
  for (const url of urls) {
    try {
      let bytes;
      if (url.startsWith('data:')) {
        const match = url.match(/^data:[^;,]+;base64,(.+)$/s);
        if (!match) throw new Error('Unsupported inline image.');
        bytes = Buffer.from(match[1], 'base64');
      } else {
        const response = await fetch(url, {
          headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
      }
      if (!bytes.length) throw new Error(`empty response from ${url}`);
      return sharp(bytes)
        .resize({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT, fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: IMAGE_QUALITY })
        .toBuffer();
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not download an order image after trying ${urls.length} source(s): ${lastError?.message || 'no usable URL'}`);
};

const drawRegistrationBar = (page, isBackPage) => {
  const top = isBackPage ? PAGE_HEIGHT - REG_MARK_Y - REG_MARK_HEIGHT : REG_MARK_Y;
  page.drawRectangle({
    x: REG_MARK_X,
    y: PAGE_HEIGHT - top - REG_MARK_HEIGHT,
    width: REG_MARK_WIDTH,
    height: REG_MARK_HEIGHT,
    color: rgb(0, 0, 0),
  });
};

const generatePdf = async (order, cards, onProgress) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const imageCache = new Map();
  let processed = 0;

  const embed = async urls => {
    const key = urls.join('|');
    if (!imageCache.has(key)) imageCache.set(key, await pdf.embedJpg(await fetchImage(urls)));
    return imageCache.get(key);
  };

  for (let offset = 0; offset < cards.length; offset += CARDS_PER_SHEET) {
    const sheet = cards.slice(offset, offset + CARDS_PER_SHEET);
    const frontPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawRegistrationBar(frontPage, false);
    frontPage.drawText(String(order.customer_name || 'Unknown Customer'), {
      x: MARGIN_LEFT, y: PAGE_HEIGHT - mmToPt(7), size: 7, font, color: rgb(0, 0, 0),
    });
    for (let index = 0; index < sheet.length; index += 1) {
      const col = index % COLS;
      const row = Math.floor(index / COLS);
      const x = MARGIN_LEFT + col * (CARD_WIDTH + GAP_X);
      const y = PAGE_HEIGHT - MARGIN_TOP - CARD_HEIGHT - row * (CARD_HEIGHT + GAP_Y);
      frontPage.drawImage(await embed(sheet[index].front), { x, y, width: CARD_WIDTH, height: CARD_HEIGHT });
      frontPage.drawRectangle({ x, y, width: CARD_WIDTH, height: CARD_HEIGHT, borderWidth: 0.1, borderColor: rgb(.78, .78, .78) });
      processed += 1;
      if (processed % 6 === 0) await onProgress(processed);
    }
    if (sheet.some(card => card.back.length)) {
      const backPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawRegistrationBar(backPage, true);
      for (let index = 0; index < sheet.length; index += 1) {
        const card = sheet[index];
        if (!card.back.length) continue;
        const col = index % COLS;
        const row = Math.floor(index / COLS);
        const x = MARGIN_LEFT + col * (CARD_WIDTH + GAP_X);
        const frontY = PAGE_HEIGHT - MARGIN_TOP - CARD_HEIGHT - row * (CARD_HEIGHT + GAP_Y);
        backPage.drawImage(await embed(card.back), {
          x: x + CARD_WIDTH, y: PAGE_HEIGHT - frontY, width: CARD_WIDTH, height: CARD_HEIGHT, rotate: degrees(180),
        });
        backPage.drawRectangle({ x, y: PAGE_HEIGHT - frontY - CARD_HEIGHT, width: CARD_WIDTH, height: CARD_HEIGHT, borderWidth: 0.1, borderColor: rgb(.78, .78, .78) });
      }
    }
  }
  await onProgress(cards.length);
  return pdf.save();
};

const updateJob = async (orderId, changes) => {
  const { error } = await supabase.from('order_pdf_generations').update({
    ...changes,
    updated_at: new Date().toISOString(),
  }).eq('order_id', orderId);
  if (error) throw error;
};

const notifyCustomerRepairRequired = async orderId => {
  if (!ORDER_PDF_WEBHOOK_SECRET) {
    console.warn('Customer repair email skipped: ORDER_PDF_WEBHOOK_SECRET is not configured.');
    return;
  }
  const response = await fetch(`${CUSTOMER_APP_URL}/api/internal/order-image-failure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': ORDER_PDF_WEBHOOK_SECRET },
    body: JSON.stringify({ orderId }),
  });
  if (!response.ok) throw new Error(`Customer repair notification returned HTTP ${response.status}.`);
};

const backfillMissingJobs = async () => {
  const { data: paidOrders, error: ordersError } = await supabase
    .from('orders').select('id').ilike('status', 'paid').order('created_at', { ascending: true }).limit(1000);
  if (ordersError) throw ordersError;
  if (!paidOrders?.length) return;
  const ids = paidOrders.map(order => order.id);
  const { data: existing, error: jobsError } = await supabase
    .from('order_pdf_generations').select('order_id').in('order_id', ids);
  if (jobsError) throw jobsError;
  const existingIds = new Set((existing || []).map(job => job.order_id));
  const missing = ids.filter(id => !existingIds.has(id)).map(order_id => ({ order_id, status: 'processing' }));
  if (missing.length) {
    const { error } = await supabase.from('order_pdf_generations').insert(missing);
    if (error) throw error;
    console.log(`Queued ${missing.length} previously unqueued paid order(s).`);
  }
};

const findJobs = async () => {
  // Follow order creation time, not job update time. Backfilled generation rows
  // can share nearly identical timestamps, so ordering the jobs themselves does
  // not reliably prioritize the newest customer orders.
  const { data: recentOrders, error: ordersError } = await supabase.from('orders')
    .select('id, created_at').ilike('status', 'paid')
    .order('created_at', { ascending: false }).limit(1000);
  if (ordersError) throw ordersError;
  if (!recentOrders?.length) return [];
  const recentIds = recentOrders.map(order => order.id);
  const { data, error } = await supabase.from('order_pdf_generations')
    .select('*').in('order_id', recentIds)
    .neq('status', 'completed').lt('attempt_count', MAX_ATTEMPTS + 1);
  if (error) throw error;
  const jobsByOrderId = new Map((data || []).map(job => [job.order_id, job]));
  const cutoff = Date.now() - STALE_MS;
  return recentIds
    .map(orderId => jobsByOrderId.get(orderId))
    .filter(job => job && (
      job.status === 'failed' || !job.started_at || new Date(job.started_at).getTime() < cutoff || Number(job.processed_cards || 0) === 0
    ))
    .slice(0, MAX_ORDERS);
};

const processJob = async job => {
  const startedAt = new Date().toISOString();
  await updateJob(job.order_id, {
    status: 'processing', error_message: null, started_at: startedAt,
    attempt_count: Number(job.attempt_count || 0) + 1,
  });
  try {
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', job.order_id).single();
    if (error) throw error;
    if (String(order.status || '').toLowerCase() !== 'paid') throw new Error('Order is no longer paid.');
    const cards = cardsFromOrder(order);
    if (!cards.length) throw new Error('Order has no printable cards.');
    const totalParts = Math.ceil(cards.length / MAX_CARDS_PER_FILE);
    const storagePaths = [];
    await updateJob(order.id, {
      total_cards: cards.length, processed_cards: 0, total_parts: totalParts,
      completed_parts: 0, storage_path: null, storage_paths: [],
    });
    console.log(`Generating ${order.id}: ${cards.length} card(s) in ${totalParts} file part(s).`);
    for (let partIndex = 0; partIndex < totalParts; partIndex += 1) {
      const partStart = partIndex * MAX_CARDS_PER_FILE;
      const partCards = cards.slice(partStart, partStart + MAX_CARDS_PER_FILE);
      const updateProgress = async partProcessed => updateJob(order.id, {
        processed_cards: Math.min(cards.length, partStart + partProcessed),
      });
      const bytes = await generatePdf(order, partCards, updateProgress);
      console.log(`Generated part ${partIndex + 1}/${totalParts}: ${(bytes.length / 1024 / 1024).toFixed(1)} MB at ${TARGET_DPI} DPI/q${IMAGE_QUALITY}.`);
      const storagePath = totalParts === 1
        ? `${order.id}/print-sheet.pdf`
        : `${order.id}/order-${order.id}-part-${partIndex + 1}-of-${totalParts}.pdf`;
      const { error: uploadError } = await supabase.storage.from('order-pdfs')
        .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true });
      if (uploadError) throw uploadError;
      storagePaths.push(storagePath);
      await updateJob(order.id, {
        storage_path: storagePaths[0], storage_paths: storagePaths,
        processed_cards: Math.min(cards.length, partStart + partCards.length),
        completed_parts: partIndex + 1,
      });
    }
    await updateJob(order.id, {
      status: 'completed', storage_path: storagePaths[0], storage_paths: storagePaths,
      processed_cards: cards.length, total_cards: cards.length, total_parts: totalParts, completed_parts: totalParts,
      completed_at: new Date().toISOString(), error_message: null,
    });
    console.log(`Completed ${order.id}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const repairRequired = message.includes('Could not download an order image');
    await updateJob(job.order_id, {
      status: 'failed', error_message: message.slice(0, 1000),
      ...(repairRequired ? { repair_required: true } : {}),
    });
    if (repairRequired) {
      try {
        await notifyCustomerRepairRequired(job.order_id);
      } catch (notificationError) {
        console.error(`Could not notify customer for ${job.order_id}: ${notificationError.message}`);
      }
    }
    console.error(`Failed ${job.order_id}: ${message}`);
  }
};

const dispatchContinuation = async () => {
  if (!GITHUB_WORKFLOW_TOKEN || !GITHUB_REPOSITORY_NAME) {
    console.log('Continuation dispatch is unavailable outside GitHub Actions.');
    return;
  }
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY_NAME}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_WORKFLOW_TOKEN}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ event_type: 'order_pdf_continue' }),
  });
  if (!response.ok) throw new Error(`Could not dispatch the next PDF batch (HTTP ${response.status}).`);
  console.log('Queued the next GitHub Actions batch.');
};

await backfillMissingJobs();
const jobs = await findJobs();
console.log(`Found ${jobs.length} PDF job(s) for this run.`);
for (const job of jobs) await processJob(job);
const remainingJobs = await findJobs();
if (remainingJobs.length) await dispatchContinuation();
