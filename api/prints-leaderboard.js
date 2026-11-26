import { createClient } from '@supabase/supabase-js';
import { createPrintsLeaderboardHandler } from '../server/prints-leaderboard.mjs';
export default createPrintsLeaderboardHandler({ createClient });
