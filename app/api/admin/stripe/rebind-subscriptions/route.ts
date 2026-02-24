import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";
import { resolveCheckoutPriceId } from "@/lib/stripe/plans";
import { getStripeClientForMode, resolveStripeMode } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

type BillingPlan = "standard" | "pro" | "turbo";

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

const toPlan = (value: string | null | undefined): BillingPlan | null => {
  if (value === "standard" || value === "pro" || value === "turbo") {
    return value;
  }

  return null;
};

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  try {
    const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean; mode?: string };
    const dryRun = body?.dryRun === true;
    const mode = resolveStripeMode(body?.mode);
    const stripe = getStripeClientForMode(mode);

    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .select("id, plan, stripe_subscription_id, status")
      .in("status", ["active", "trialing"])
      .not("stripe_subscription_id", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as Array<{
      id: string;
      plan?: string | null;
      stripe_subscription_id?: string | null;
      status?: string | null;
    }>;

    let scanned = 0;
    let updated = 0;
    const skipped: Array<{ subscriptionId: string; reason: string }> = [];
    const failures: Array<{ subscriptionId: string; reason: string }> = [];

    for (const row of rows) {
      const stripeSubscriptionId = row.stripe_subscription_id;
      if (!stripeSubscriptionId) {
        continue;
      }

      scanned += 1;

      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
          expand: ["items.data.price"],
        });

        const item = stripeSubscription.items.data[0];
        const currentPrice = item?.price;
        const currentInterval = currentPrice?.recurring?.interval;

        if (!item || !currentPrice || (currentInterval !== "month" && currentInterval !== "year")) {
          skipped.push({ subscriptionId: stripeSubscriptionId, reason: "missing_item_or_interval" });
          continue;
        }

        const plan = toPlan(row.plan ?? stripeSubscription.metadata?.plan);
        if (!plan) {
          skipped.push({ subscriptionId: stripeSubscriptionId, reason: "missing_plan" });
          continue;
        }

        const targetPriceId = await resolveCheckoutPriceId(plan, currentInterval, { mode });

        if (targetPriceId === currentPrice.id) {
          skipped.push({ subscriptionId: stripeSubscriptionId, reason: "already_synced" });
          continue;
        }

        if (dryRun) {
          updated += 1;
          continue;
        }

        await stripe.subscriptions.update(stripeSubscriptionId, {
          proration_behavior: "none",
          items: [
            {
              id: item.id,
              price: targetPriceId,
            },
          ],
          metadata: {
            ...stripeSubscription.metadata,
            plan,
            billingInterval: currentInterval,
          },
        });

        updated += 1;
      } catch (error) {
        failures.push({
          subscriptionId: stripeSubscriptionId,
          reason: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    return NextResponse.json({
      mode,
      scanned,
      updated,
      skipped,
      failures,
      dryRun,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rebind process failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
