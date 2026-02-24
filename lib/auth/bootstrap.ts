import { supabaseAdmin } from "@/lib/supabase/admin";
import type { User } from "@supabase/supabase-js";

type BootstrapArgs = {
  user: User;
  fullName?: string | null;
  locale?: string | null;
};

type Role = "admin" | "user";

export const bootstrapProfile = async ({ user, fullName, locale }: BootstrapArgs) => {
  const userId = user.id;
  const fallbackName = typeof user.user_metadata?.full_name === "string"
    ? user.user_metadata.full_name
    : typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : null;

  const { data: currentProfile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle<{ role?: Role | null }>();

  let role: Role = currentProfile?.role === "admin" ? "admin" : "user";

  if (!currentProfile?.role) {
    const { count } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    role = (count ?? 0) === 0 ? "admin" : "user";
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .upsert(
      {
        user_id: userId,
        email: user.email ?? null,
        full_name: fullName || fallbackName,
        locale: locale ?? "tr",
        role,
      },
      { onConflict: "user_id" }
    );

  if (error) {
    throw error;
  }

  return { role };
};
