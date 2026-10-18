import { createClient } from '@supabase/supabase-js';
import { createAgentOrderHandler } from '../server/agent-order.mjs';

export default createAgentOrderHandler({ createClient });
