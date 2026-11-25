import { createClient } from '@supabase/supabase-js';
import { createAnalyticsSummaryHandler } from '../server/analytics-summary.mjs';
export default createAnalyticsSummaryHandler({ createClient });
