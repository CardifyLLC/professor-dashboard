import { createClient } from '@supabase/supabase-js';
import { createAgentOrdersHandler } from '../server/agent-access.mjs';

export default createAgentOrdersHandler({ createClient });
