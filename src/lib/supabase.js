import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (url && anonKey) ? createClient(url, anonKey) : null;
export const supabaseEnabled = !!supabase;

if (!supabaseEnabled) {
  // eslint-disable-next-line no-console
  console.info('[Supabase] env vars not set — using mock data from src/data.js');
}
