import { createClient } from '@supabase/supabase-js';
import { createTeamBatcherHandler } from '../server/team-batcher.mjs';
export default createTeamBatcherHandler({createClient});
