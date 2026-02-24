import { NextRequest, NextResponse } from "next/server";
import { bootstrapProfile } from "@/lib/auth/bootstrap";
import { setSessionCookies } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/admin";

const resolveSafeNextPath = (value: string | null) => {
  if (!value) {
    return "/";
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
};

const buildRedirectWithError = (requestUrl: string, nextPath: string, authError: string) => {
  const url = new URL(nextPath, requestUrl);
  url.searchParams.set("authError", authError);
  return url;
};

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = resolveSafeNextPath(requestUrl.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(buildRedirectWithError(request.url, nextPath, "missing_code"));
  }

  const { data, error } = await supabaseServer.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    return NextResponse.redirect(buildRedirectWithError(request.url, nextPath, "oauth_failed"));
  }

  await bootstrapProfile({
    user: data.user,
    fullName: (data.user.user_metadata?.full_name as string | undefined) ?? undefined,
    locale: "tr",
  });

  const response = NextResponse.redirect(new URL(nextPath, request.url));
  setSessionCookies(response, data.session.access_token, data.session.refresh_token);

  return response;
}
