import { NextRequest, NextResponse } from "next/server";
import { bootstrapProfile } from "@/lib/auth/bootstrap";
import { setSessionCookies } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const getAccessToken = (request: NextRequest, bodyToken?: string) => {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.replace("Bearer ", "");
  }

  return bodyToken ?? null;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      accessToken?: string;
      refreshToken?: string;
      fullName?: string;
      locale?: string;
    };

    const accessToken = getAccessToken(request, body.accessToken);

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);

    if (error || !data.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role } = await bootstrapProfile({
      user: data.user,
      fullName: body.fullName,
      locale: body.locale,
    });

    const response = NextResponse.json({ success: true, role });
    setSessionCookies(response, accessToken, body.refreshToken);

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "bootstrap failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
