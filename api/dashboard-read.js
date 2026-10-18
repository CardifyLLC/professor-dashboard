import { createClient } from '@supabase/supabase-js';
import { createDashboardReadHandler } from '../server/dashboard-access.mjs';
export default createDashboardReadHandler({ createClient });
