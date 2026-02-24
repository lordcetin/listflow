import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";
import { getPlanPricingSnapshot, getSubscriptionCatalog } from "@/lib/stripe/plans";
import { resolveStripeMode } from "@/lib/stripe/client";

const notFoundResponse = () => NextResponse.json({ error: "Not Found" }, { status: 404 });

const requireAdmin = async (request: NextRequest) => {
  const token = getAccessTokenFromRequest(request);
  if (!token) return null;

  const user = await getUserFromAccessToken(token);
  if (!user) return null;

  const profile = await getProfileByUserId(user.id, token);
  if (!profile || !isAdminRole(profile.role)) return null;

  return { user, profile };
};

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  try {
    const mode = resolveStripeMode(request.nextUrl.searchParams.get("mode"));
    const [plans, catalog] = await Promise.all([
      getPlanPricingSnapshot({ mode }),
      getSubscriptionCatalog({ mode }),
    ]);

    return NextResponse.json({
      mode,
      plans,
      catalog,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe catalog could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
