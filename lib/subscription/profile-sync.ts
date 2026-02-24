import { supabaseAdmin } from "@/lib/supabase/admin";

type SyncProfileSubscriptionArgs = {
  userId?: string | null;
  email?: string | null;
  status?: string | null;
  plan?: string | null;
  stripeCustomerId?: string | null;
};

type SubscriptionRow = {
  status: string | null;
  plan: string | null;
  stripe_customer_id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type ProfileRow = {
  user_id: string;
  email: string | null;
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

const normalizeEmail = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

const isMissingRelationError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  if (error.code === "42P01") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
};

const isMissingColumnError = (error: { message?: string; code?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  if (error.code === "42703") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isRecoverableSelectError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") || message.includes("schema cache") || message.includes("failed to parse");
};

const selectProfilesByEmail = async (email: string) => {
  const exact = await supabaseAdmin.from("profiles").select("user_id,email").eq("email", email).limit(200);

  if (!exact.error && (exact.data ?? []).length > 0) {
    return (exact.data ?? []) as ProfileRow[];
  }

  const insensitive = await supabaseAdmin.from("profiles").select("user_id,email").ilike("email", email).limit(200);

  if (insensitive.error) {
    if (isMissingRelationError(insensitive.error)) {
      return [] as ProfileRow[];
    }

    throw new Error(insensitive.error.message);
  }

  return (insensitive.data ?? []) as ProfileRow[];
};

export const findProfileUserIdsByEmail = async (email: string | null | undefined) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return [] as string[];
  }

  const rows = await selectProfilesByEmail(normalizedEmail);
  const userIds = new Set<string>();

  for (const row of rows) {
    if (row.user_id) {
      userIds.add(row.user_id);
    }
  }

  return [...userIds];
};

export const findFirstProfileUserIdByEmail = async (email: string | null | undefined) => {
  const userIds = await findProfileUserIdsByEmail(email);
  return userIds[0] ?? null;
};

const selectSubscriptionsByUserId = async (userId: string) => {
  const selectCandidates = [
    "status,plan,stripe_customer_id,updated_at,created_at",
    "status,plan,updated_at,created_at",
    "status,plan,created_at",
    "status,plan",
  ] as const;
  const orderCandidates = ["updated_at", "created_at", null] as const;
  let lastError: { message?: string; code?: string } | null = null;

  for (const select of selectCandidates) {
    for (const orderColumn of orderCandidates) {
      let query = supabaseAdmin.from("subscriptions").select(select).eq("user_id", userId).limit(200);

      if (orderColumn) {
        query = query.order(orderColumn, { ascending: false });
      }

      const { data, error } = await query;

      if (!error) {
        return (data ?? []) as unknown as SubscriptionRow[];
      }

      if (isMissingRelationError(error)) {
        return [] as SubscriptionRow[];
      }

      lastError = error;

      if (!isRecoverableSelectError(error)) {
        break;
      }
    }
  }

  throw new Error(lastError?.message ?? "subscriptions could not be read");
};

const updateProfileWithFallback = async (
  userId: string,
  payload: {
    is_subscriber: boolean;
    subscription_status: string | null;
    subscription_plan: string | null;
    stripe_customer_id: string | null;
    subscription_updated_at: string;
    updated_at: string;
  }
) => {
  const payloads: Array<Record<string, unknown>> = [
    payload,
    {
      is_subscriber: payload.is_subscriber,
      subscription_status: payload.subscription_status,
      subscription_plan: payload.subscription_plan,
      stripe_customer_id: payload.stripe_customer_id,
      subscription_updated_at: payload.subscription_updated_at,
    },
    {
      is_subscriber: payload.is_subscriber,
      subscription_status: payload.subscription_status,
      subscription_plan: payload.subscription_plan,
      subscription_updated_at: payload.subscription_updated_at,
    },
    {
      is_subscriber: payload.is_subscriber,
      subscription_status: payload.subscription_status,
      subscription_plan: payload.subscription_plan,
    },
    {
      is_subscriber: payload.is_subscriber,
    },
  ];

  let lastError: { message?: string; code?: string } | null = null;

  for (const patch of payloads) {
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("user_id", userId);

    if (!error) {
      return;
    }

    lastError = error;

    const keys = Object.keys(patch);
    const canRetry = keys.some((key) => isMissingColumnError(error, key));

    if (!canRetry) {
      throw new Error(error.message);
    }
  }

  if (lastError) {
    throw new Error(lastError.message);
  }
};

const syncProfileSubscriptionByUserId = async (
  userId: string,
  fallback: {
    status?: string | null;
    plan?: string | null;
    stripeCustomerId?: string | null;
  }
) => {
  const rows = await selectSubscriptionsByUserId(userId);
  const nowIso = new Date().toISOString();
  const activeRow = rows.find((row) => ACTIVE_SUBSCRIPTION_STATUSES.has((row.status ?? "").toLowerCase())) ?? null;
  const latestRow = rows[0] ?? null;
  const fallbackStatus = (fallback.status ?? null)?.toLowerCase() ?? null;
  const fallbackIsSubscriber = fallbackStatus ? ACTIVE_SUBSCRIPTION_STATUSES.has(fallbackStatus) : false;
  const isSubscriber = Boolean(activeRow) || fallbackIsSubscriber;
  const patch = {
    is_subscriber: isSubscriber,
    subscription_status: activeRow?.status ?? fallback.status ?? latestRow?.status ?? null,
    subscription_plan: activeRow?.plan ?? fallback.plan ?? latestRow?.plan ?? null,
    stripe_customer_id: activeRow?.stripe_customer_id ?? fallback.stripeCustomerId ?? latestRow?.stripe_customer_id ?? null,
    subscription_updated_at: nowIso,
    updated_at: nowIso,
  };

  await updateProfileWithFallback(userId, patch);
};

export const syncProfileSubscriptionState = async (args: SyncProfileSubscriptionArgs) => {
  const targetUserIds = new Set<string>();

  if (args.userId) {
    targetUserIds.add(args.userId);
  }

  const emailUserIds = await findProfileUserIdsByEmail(args.email);
  for (const userId of emailUserIds) {
    targetUserIds.add(userId);
  }

  for (const userId of targetUserIds) {
    await syncProfileSubscriptionByUserId(userId, {
      status: args.status ?? null,
      plan: args.plan ?? null,
      stripeCustomerId: args.stripeCustomerId ?? null,
    });
  }
};
