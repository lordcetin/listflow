import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";

const notFound = () =>
  new NextResponse("Not Found", {
    status: 404,
    headers: {
      "x-robots-tag": "noindex, nofollow, noarchive",
      "cache-control": "no-store",
    },
  });

const getUserIdFromAccessToken = async (token: string) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return null;
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!userResponse.ok) {
    return null;
  }

  const user = (await userResponse.json()) as { id?: string };
  return user.id ?? null;
};

const fetchAdminRoleWithUserToken = async (
  supabaseUrl: string,
  accessToken: string,
  userId: string
) => {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    return null;
  }

  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=role&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    }
  );

  if (!profileResponse.ok) {
    return null;
  }

  const rows = (await profileResponse.json()) as Array<{ role?: string | null }>;
  if (!rows.length || !rows[0]?.role) {
    return null;
  }

  const role = rows[0]?.role?.toLowerCase();
  return role === "admin";
};

const fetchAdminRoleWithServiceKey = async (supabaseUrl: string, userId: string) => {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return null;
  }

  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=role&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
    }
  );

  if (!profileResponse.ok) {
    return null;
  }

  const rows = (await profileResponse.json()) as Array<{ role?: string | null }>;
  const role = rows[0]?.role?.toLowerCase();
  return role === "admin";
};

const isAdmin = async (accessToken: string) => {
  const userId = await getUserIdFromAccessToken(accessToken);
  if (!userId) {
    return false;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return false;
  }

  const userTokenResult = await fetchAdminRoleWithUserToken(supabaseUrl, accessToken, userId);
  if (userTokenResult !== null) {
    return userTokenResult;
  }

  const serviceResult = await fetchAdminRoleWithServiceKey(supabaseUrl, userId);
  if (serviceResult !== null) {
    return serviceResult;
  }

  return false;
};

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!token) {
    return notFound();
  }

  const allowed = await isAdmin(token);

  if (!allowed) {
    return notFound();
  }

  const response = NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/admin")) {
    response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
    response.headers.set("cache-control", "no-store");
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
