import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type Role = "admin" | "user";
export type AuthUser = {
  id: string;
  email?: string | null;
};

type ProfileRecord = {
  user_id: string;
  role?: Role | null;
};

const getBearerToken = (authorization: string | null) => {
  if (!authorization) {
    return null;
  }

  const [type, token] = authorization.split(" ");

  if (type?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
};

const getPublicSupabaseEnv = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
};

export const getAccessTokenFromRequest = (request: NextRequest) => {
  return request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? getBearerToken(request.headers.get("authorization"));
};

export const getAccessTokenFromServerCookies = async () => {
  return (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value ?? null;
};

const fetchUserWithAccessToken = async (accessToken: string): Promise<AuthUser | null> => {
  const publicEnv = getPublicSupabaseEnv();
  if (!publicEnv) {
    return null;
  }

  const response = await fetch(`${publicEnv.url}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: publicEnv.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const user = (await response.json()) as { id?: string; email?: string | null };
  return user.id ? { id: user.id, email: user.email ?? null } : null;
};

export const getUserFromAccessToken = async (accessToken: string): Promise<AuthUser | null> => {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);

  if (!error && data.user) {
    return {
      id: data.user.id,
      email: data.user.email ?? null,
    };
  }

  return fetchUserWithAccessToken(accessToken);
};

export const getProfileByUserId = async (userId: string, accessToken?: string | null) => {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, role")
    .eq("user_id", userId)
    .maybeSingle<ProfileRecord>();

  if (!error && data) {
    return data;
  }

  if (!accessToken) {
    return null;
  }

  const publicEnv = getPublicSupabaseEnv();
  if (!publicEnv) {
    return null;
  }

  const response = await fetch(
    `${publicEnv.url}/rest/v1/profiles?select=user_id,role&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: publicEnv.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as ProfileRecord[];
  return rows[0] ?? null;
};

export const isAdminRole = (role: string | null | undefined) => role === "admin";

export const assertAdminPageAccess = async () => {
  const accessToken = await getAccessTokenFromServerCookies();

  if (!accessToken) {
    notFound();
  }

  const user = await getUserFromAccessToken(accessToken);

  if (!user) {
    notFound();
  }

  const profile = await getProfileByUserId(user.id, accessToken);

  if (!profile || !isAdminRole(profile.role)) {
    notFound();
  }

  return { user, profile };
};
