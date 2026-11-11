import { createClient } from '@supabase/supabase-js';
import { createGrowthOperationsHandler } from '../server/growth-operations.mjs';
export default createGrowthOperationsHandler({ createClient });
