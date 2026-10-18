import { createClient } from '@supabase/supabase-js';
import { createAgentReadHandler } from '../server/agent-access.mjs';

export default createAgentReadHandler({ createClient });
