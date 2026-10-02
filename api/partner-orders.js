import { createClient } from '@supabase/supabase-js';
import { createPartnerOrdersHandler } from '../server/partner-orders.mjs';

export default createPartnerOrdersHandler({createClient});
