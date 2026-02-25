const nextPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const nextPublicSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const nextPublicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

if (!nextPublicSupabaseUrl || !nextPublicSupabaseUrl.trim()) {
  throw new Error(
    "Missing required client environment variable: NEXT_PUBLIC_SUPABASE_URL. " +
      "Set it in .env/.env.local and restart Next.js."
  );
}

if (!nextPublicSupabaseAnonKey || !nextPublicSupabaseAnonKey.trim()) {
  throw new Error(
    "Missing required client environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Set it in .env/.env.local and restart Next.js."
  );
}

export const clientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: nextPublicSupabaseUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nextPublicSupabaseAnonKey,
  NEXT_PUBLIC_SITE_URL: nextPublicSiteUrl?.trim() || null,
} as const;

export type Locale = "tr" | "en";
