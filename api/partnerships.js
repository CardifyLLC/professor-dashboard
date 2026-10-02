import { createClient } from '@supabase/supabase-js';
import { createPartnershipsHandler } from '../server/partnerships.mjs';

export default createPartnershipsHandler({ createClient });
