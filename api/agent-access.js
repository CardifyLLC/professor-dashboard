import { createClient } from '@supabase/supabase-js';
import { createAgentAccessHandler } from '../server/agent-access.mjs';

export default createAgentAccessHandler({ createClient });
