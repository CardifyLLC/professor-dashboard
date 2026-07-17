import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase URL or Anon Key. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client bypasses RLS — only use in the professor dashboard (never expose to end users)
export const supabaseAdmin = supabase;

export async function getAdminAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new Error('Your admin session has expired. Please sign in again.');
  return { apikey: supabaseAnonKey, Authorization: `Bearer ${token}` };
}
