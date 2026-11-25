import { createClient } from '@supabase/supabase-js';
import { createPrintCreditPurchasesHandler } from '../server/print-credit-purchases.mjs';

export default createPrintCreditPurchasesHandler({ createClient });
