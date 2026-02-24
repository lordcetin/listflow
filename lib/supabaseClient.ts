import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env/client";

export const SUPABASE_URL = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
