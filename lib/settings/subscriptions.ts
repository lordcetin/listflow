import { getActiveStripeMode, getStripeClientForMode, type StripeMode } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

export type SettingsSubscriptionRow = {
  id: string;
  user_id: string | null;
  store_id?: string | null;
  shop_id?: string | null;
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type StripeCancelFailure = {
  id: string;
  stripeSubscriptionId: string;
  message: string;
};

const getModeCandidates = () => {
  const primary = getActiveStripeMode();
  const secondary: StripeMode = primary === "live" ? "test" : "live";
  return [primary, secondary] as const;
};

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const toDate = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const isSubscriptionActive = (row: SettingsSubscriptionRow) => {
  const status = (row.status ?? "").toLowerCase();
  if (!["active", "trialing"].includes(status)) {
    return false;
  }

  const periodEnd = toDate(row.current_period_end);
  if (!periodEnd) {
    return true;
  }

  return periodEnd.getTime() > Date.now();
};

export const resolveStoreIdFromSubscription = (row: SettingsSubscriptionRow) => {
  if (row.store_id) {
    return row.store_id;
  }

  return row.shop_id && isUuid(row.shop_id) ? row.shop_id : null;
};

export const loadUserSubscriptions = async (userId: string) => {
  const withStoreId = await supabaseAdmin
    .from("subscriptions")
    .select(
      "id, user_id, store_id, shop_id, plan, status, current_period_end, stripe_subscription_id, stripe_customer_id, updated_at, created_at"
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (!withStoreId.error) {
    return (withStoreId.data ?? []) as SettingsSubscriptionRow[];
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw new Error(withStoreId.error.message);
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .select(
      "id, user_id, shop_id, plan, status, current_period_end, stripe_subscription_id, stripe_customer_id, updated_at, created_at"
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return ((fallback.data ?? []) as SettingsSubscriptionRow[]).map((row) => ({
    ...row,
    store_id: row.shop_id && isUuid(row.shop_id) ? row.shop_id : null,
  }));
};

export const cancelStripeSubscriptionsNow = async (rows: SettingsSubscriptionRow[]) => {
  const failed: StripeCancelFailure[] = [];
  const canceledIds: string[] = [];
  const missingStripeIds: string[] = [];

  for (const row of rows) {
    const stripeSubscriptionId = row.stripe_subscription_id;
    if (!stripeSubscriptionId) {
      missingStripeIds.push(row.id);
      continue;
    }

    let canceled = false;
    let lastError: string | null = null;

    for (const mode of getModeCandidates()) {
      try {
        await getStripeClientForMode(mode).subscriptions.cancel(stripeSubscriptionId);
        canceled = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Stripe cancellation failed";
      }
    }

    if (canceled) {
      canceledIds.push(row.id);
    } else {
      failed.push({
        id: row.id,
        stripeSubscriptionId,
        message: lastError ?? "Stripe cancellation failed",
      });
    }
  }

  return {
    canceledIds,
    failed,
    missingStripeIds,
  };
};
