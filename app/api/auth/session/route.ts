import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookies, setSessionCookies } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    accessToken?: string;
    refreshToken?: string;
  };

  if (!body.accessToken) {
    return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
  }

  const response = NextResponse.json({ success: true });
  setSessionCookies(response, body.accessToken, body.refreshToken);

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  clearSessionCookies(response);
  return response;
}
