import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import type Stripe from "stripe";
import { getPlanCentsByInterval, getStripeClientForMode } from "@/lib/stripe/client";
import { syncOneTimeCheckoutPayment } from "@/lib/stripe/checkout-payment-sync";
import { findFirstProfileUserIdByEmail, syncProfileSubscriptionState } from "@/lib/subscription/profile-sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

export const runtime = "nodejs";

const getStripe = () => getStripeClientForMode();

const toIsoDate = (value: number | null | undefined) => {
  if (!value) {
    return null;
  }

  return new Date(value * 1000).toISOString();
};

const resolveSubscriptionPeriodEnd = (subscription: Stripe.Subscription) => {
  return subscription.items.data[0]?.current_period_end ?? null;
};

const resolveCustomerEmail = async (
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
) => {
  if (!customer) {
    return null;
  }

  if (typeof customer === "object") {
    if ("deleted" in customer && customer.deleted) {
      return null;
    }

    return customer.email ?? null;
  }

  try {
    const fetched = await getStripe().customers.retrieve(customer);
    if ("deleted" in fetched && fetched.deleted) {
      return null;
    }

    return fetched.email ?? null;
  } catch {
    return null;
  }
};

const isMissingOnConflictConstraintError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  return (error.message ?? "").toLowerCase().includes("no unique or exclusion constraint matching");
};

const throwSupabaseError = (context: string, error: { message?: string } | null | undefined) => {
  if (!error) {
    return;
  }

  throw new Error(`${context}: ${error.message ?? "Unknown database error"}`);
};

const recoverSubscriptionRow = async (
  session: Stripe.Checkout.Session,
  subscription: Stripe.Subscription,
  subscriberEmail: string | null
) => {
  const mergedMetadata = {
    ...(subscription.metadata ?? {}),
    ...(session.metadata ?? {}),
  };
  const plan = (mergedMetadata.plan as string | undefined) ?? "standard";
  const billingInterval = (mergedMetadata.billingInterval as string | undefined) === "year" ? "year" : "month";
  const metadataUserId = (mergedMetadata.userId as string | undefined) ?? null;
  const emailUserId = !metadataUserId && subscriberEmail ? await findFirstProfileUserIdByEmail(subscriberEmail) : null;
  const userId = metadataUserId ?? emailUserId ?? null;
  const shopId = (mergedMetadata.shopId as string | undefined) ?? null;
  const storeId = isUuid(shopId) ? shopId : null;
  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : typeof subscription.customer === "string"
        ? subscription.customer
        : null;
  const stripeUnitAmount = subscription.items.data[0]?.price?.unit_amount ?? null;

  const payload = {
    user_id: userId,
    shop_id: shopId,
    store_id: storeId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    plan,
    status: subscription.status,
    current_period_end: toIsoDate(resolveSubscriptionPeriodEnd(subscription)),
    updated_at: new Date().toISOString(),
  };

  const upsertResult = await supabaseAdmin
    .from("subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (upsertResult.error) {
    if (!isMissingOnConflictConstraintError(upsertResult.error)) {
      throwSupabaseError("Failed to recover subscription row", upsertResult.error);
    }

    const existing = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle<{ id?: string }>();

    throwSupabaseError("Failed to read subscription fallback", existing.error);

    if (existing.data?.id) {
      const updated = await supabaseAdmin
        .from("subscriptions")
        .update(payload)
        .eq("id", existing.data.id);

      throwSupabaseError("Failed to update subscription fallback", updated.error);
    } else {
      const inserted = await supabaseAdmin
        .from("subscriptions")
        .insert(payload);

      throwSupabaseError("Failed to insert subscription fallback", inserted.error);
    }
  }

  if (storeId) {
    const fallbackPlan = (plan === "pro" || plan === "turbo" ? plan : "standard") as "standard" | "pro" | "turbo";
    const cents = stripeUnitAmount ?? getPlanCentsByInterval(fallbackPlan, billingInterval);

    const storeUpdate = await supabaseAdmin
      .from("stores")
      .update({
        status: subscription.status === "active" || subscription.status === "trialing" ? "active" : subscription.status,
        price_cents: cents,
      })
      .eq("id", storeId);

    throwSupabaseError("Failed to update store from verify-session recovery", storeUpdate.error);
  }

  await syncProfileSubscriptionState({
    userId,
    email: subscriberEmail,
    status: subscription.status,
    plan,
    stripeCustomerId,
  });
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { sessionId?: string };

    if (!body.sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    const user = accessToken ? await getUserFromAccessToken(accessToken) : null;

    const session = await getStripe().checkout.sessions.retrieve(body.sessionId, {
      expand: ["subscription"],
    });

    const metadataUserId = session.metadata?.userId;

    if (user && metadataUserId && metadataUserId !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const subscriptionFromStripe =
      typeof session.subscription === "object" && session.subscription
        ? session.subscription
        : null;

    let oneTimePaymentStatus: "paid" | "pending" | "failed" | null = null;

    if (session.mode === "payment") {
      const oneTimeSync = await syncOneTimeCheckoutPayment(session);
      oneTimePaymentStatus = oneTimeSync.paymentStatus;
    }

    const stripeStatus = subscriptionFromStripe?.status ?? null;

    if (subscriptionFromStripe) {
      const subscriberEmail =
        session.customer_details?.email ??
        session.customer_email ??
        (await resolveCustomerEmail(subscriptionFromStripe.customer));

      await recoverSubscriptionRow(session, subscriptionFromStripe, subscriberEmail);
    }

    let dbStatus: string | null = null;

    if (subscriptionFromStripe?.id) {
      const { data, error } = await supabaseAdmin
        .from("subscriptions")
        .select("status")
        .eq("stripe_subscription_id", subscriptionFromStripe.id)
        .maybeSingle<{ status?: string | null }>();

      if (error) {
        throw new Error(`Failed to read recovered subscription row: ${error.message}`);
      }

      dbStatus = data?.status ?? null;
    }

    const isActive =
      session.mode === "payment"
        ? oneTimePaymentStatus === "paid" || session.payment_status === "paid"
        : stripeStatus === "active" ||
          stripeStatus === "trialing" ||
          dbStatus === "active" ||
          dbStatus === "trialing" ||
          session.payment_status === "paid";

    return NextResponse.json({
      success: true,
      isActive,
      stripeStatus: stripeStatus ?? null,
      dbStatus,
      oneTimePaymentStatus,
      plan: session.metadata?.plan ?? null,
      billingInterval: session.metadata?.billingInterval ?? "month",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed";
    return NextResponse.json({ error: message, isActive: false }, { status: 500 });
  }
}
