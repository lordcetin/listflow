import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";
import { getPlanPricingSnapshot, upsertPlanPrice } from "@/lib/stripe/plans";
import { resolveStripeMode, type BillingInterval, type BillingPlan } from "@/lib/stripe/client";

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

const isPlan = (value: string | undefined): value is BillingPlan => {
  return value === "standard" || value === "pro" || value === "turbo";
};

const isInterval = (value: string | undefined): value is BillingInterval => {
  return value === "month" || value === "year";
};

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  try {
    const body = (await request.json()) as {
      plan?: string;
      interval?: string;
      amount?: number;
      currency?: string;
      productId?: string;
      deactivatePrevious?: boolean;
      mode?: string;
    };

    if (!isPlan(body.plan) || !isInterval(body.interval)) {
      return NextResponse.json({ error: "plan and interval are required" }, { status: 400 });
    }

    if (typeof body.amount !== "number" || Number.isNaN(body.amount) || body.amount <= 0) {
      return NextResponse.json({ error: "amount must be greater than zero" }, { status: 400 });
    }

    const mode = resolveStripeMode(body.mode);

    const result = await upsertPlanPrice({
      plan: body.plan,
      interval: body.interval,
      amount: body.amount,
      currency: (body.currency || "usd").toLowerCase(),
      productId: body.productId,
      deactivatePrevious: body.deactivatePrevious !== false,
      mode,
    });

    const plans = await getPlanPricingSnapshot({ mode });
    const updatedPlan = plans.find((plan) => plan.plan === body.plan) ?? null;

    return NextResponse.json({
      ...result,
      mode,
      plan: updatedPlan,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe plan price update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
