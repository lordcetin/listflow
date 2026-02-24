import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

export const runtime = "nodejs";

type SubscriptionRow = {
  id: string;
  user_id: string | null;
  store_id?: string | null;
  shop_id?: string | null;
  status: string | null;
  current_period_end: string | null;
};

type SchedulerJobRow = {
  id: string;
  store_id: string | null;
  idempotency_key: string | null;
  status: string | null;
};

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const toValidDate = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isActiveSubscription = (row: SubscriptionRow) => {
  const status = (row.status ?? "").toLowerCase();

  if (!["active", "trialing"].includes(status)) {
    return false;
  }

  const periodEnd = toValidDate(row.current_period_end);
  if (!periodEnd) {
    return true;
  }

  return periodEnd.getTime() > Date.now();
};

const resolveStoreIdFromManualKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey) {
    return null;
  }

  if (idempotencyKey.startsWith("scheduled:")) {
    const parts = idempotencyKey.split(":");
    return parts.length >= 5 ? parts[2] : null;
  }

  if (idempotencyKey.startsWith("manual_switch:")) {
    const parts = idempotencyKey.split(":");
    return parts.length >= 4 ? parts[1] : null;
  }

  return null;
};

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const loadUserSubscriptions = async (userId: string) => {
  const withStoreId = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, store_id, shop_id, status, current_period_end")
    .eq("user_id", userId);

  if (!withStoreId.error) {
    return (withStoreId.data ?? []) as SubscriptionRow[];
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw new Error(withStoreId.error.message);
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, shop_id, status, current_period_end")
    .eq("user_id", userId);

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return ((fallback.data ?? []) as SubscriptionRow[]).map((row) => ({
    ...row,
    store_id: row.shop_id && isUuid(row.shop_id) ? row.shop_id : null,
  }));
};

const loadProcessingJobs = async (storeId: string) => {
  const withStoreId = await supabaseAdmin
    .from("scheduler_jobs")
    .select("id, store_id, idempotency_key, status")
    .eq("status", "processing")
    .eq("store_id", storeId)
    .limit(5);

  if (!withStoreId.error) {
    return (withStoreId.data ?? []) as SchedulerJobRow[];
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw new Error(withStoreId.error.message);
  }

  const fallback = await supabaseAdmin
    .from("scheduler_jobs")
    .select("id, idempotency_key, status")
    .eq("status", "processing")
    .order("created_at", { ascending: false })
    .limit(200);

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return ((fallback.data ?? []) as SchedulerJobRow[])
    .map((row) => ({
      ...row,
      store_id: resolveStoreIdFromManualKey(row.idempotency_key),
    }))
    .filter((row) => row.store_id === storeId);
};

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = getAccessToken(request);

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const { data: store, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string; user_id: string }>();

    if (storeError) {
      return NextResponse.json({ error: storeError.message }, { status: 500 });
    }

    if (!store) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const subscriptions = await loadUserSubscriptions(user.id);
    const hasActiveSubscription = subscriptions.some((row) => {
      const subscriptionStoreId = row.store_id ?? (row.shop_id && isUuid(row.shop_id) ? row.shop_id : null);
      return subscriptionStoreId === id && isActiveSubscription(row);
    });

    if (hasActiveSubscription) {
      return NextResponse.json(
        {
          error: "Store cannot be deleted while there is an active subscription.",
          reason: "active_subscription",
        },
        { status: 409 }
      );
    }

    const processingJobs = await loadProcessingJobs(id);

    if (processingJobs.length > 0) {
      return NextResponse.json(
        {
          error: "Store cannot be deleted while automation is running.",
          reason: "automation_running",
        },
        { status: 409 }
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("stores")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store could not be deleted";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
