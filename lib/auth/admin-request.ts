import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";

export const notFoundResponse = () => NextResponse.json({ error: "Not Found" }, { status: 404 });

export const requireAdminRequest = async (request: NextRequest) => {
  const token = getAccessTokenFromRequest(request);
  if (!token) {
    return null;
  }

  const user = await getUserFromAccessToken(token);
  if (!user) {
    return null;
  }

  const profile = await getProfileByUserId(user.id, token);
  if (!profile || !isAdminRole(profile.role)) {
    return null;
  }

  return { user, profile };
};
