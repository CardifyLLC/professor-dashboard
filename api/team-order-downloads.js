import { createClient } from '@supabase/supabase-js';
import { createTeamOrderDownloadsHandler } from '../server/team-order-downloads.mjs';

export default createTeamOrderDownloadsHandler({ createClient });
