import { createClient } from '@supabase/supabase-js';
import { createDashboardAccessHandler } from '../server/dashboard-access.mjs';
export default createDashboardAccessHandler({ createClient });
