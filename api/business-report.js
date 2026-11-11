import { createClient } from '@supabase/supabase-js';
import { createBusinessReportHandler } from '../server/business-report.mjs';
export default createBusinessReportHandler({createClient});
