import { createClient } from '@supabase/supabase-js';
import { createAdAttributionHandler } from '../server/ad-attribution.mjs';
export default createAdAttributionHandler({ createClient });
