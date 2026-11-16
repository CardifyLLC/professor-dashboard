import { supabase } from './supabaseClient';
import { createDashboardAccessRequest } from './dashboardAccessClient.mjs';

export const dashboardAccessRequest = createDashboardAccessRequest({
  auth: supabase.auth,
  apiKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});
