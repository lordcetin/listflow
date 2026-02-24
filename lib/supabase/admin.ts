import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";

export const supabaseAdmin = createClient(
  serverEnv.NEXT_PUBLIC_SUPABASE_URL,
  serverEnv.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

export const supabaseServer = createClient(
  serverEnv.NEXT_PUBLIC_SUPABASE_URL,
  serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
