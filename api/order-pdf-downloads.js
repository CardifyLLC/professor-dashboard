import { createClient } from '@supabase/supabase-js';
import { createOrderPdfDownloadsHandler } from '../server/order-pdf-downloads.mjs';

export default createOrderPdfDownloadsHandler({ createClient });
