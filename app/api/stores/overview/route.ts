import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { extractScheduledSlotDueIso, getPlanWindowHours } from "@/lib/scheduler/idempotency";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoreRow = {
  id: string;
  user_id: string;
  store_name: string;
  category: string | null;
  status: string | null;
  price_cents: number | null;
  active_webhook_config_id?: string | null;
  automation_updated_at?: string | null;
  created_at: string | null;
};

type SubscriptionRow = {
  id: string;
  user_id: string | null;
  store_id?: string | null;
  shop_id?: string | null;
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type SchedulerJobRow = {
  id: string;
  subscription_id: string | null;
  store_id: string | null;
  idempotency_key: string | null;
  status: string | null;
  trigger_type: string | null;
  run_at: string | null;
  updated_at: string | null;
  retry_count: number | null;
  error_message: string | null;
  created_at: string | null;
};

type OrderCountRow = {
  id: string;
  store_id?: string | null;
  payment_status?: string | null;
};

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const isRecoverableColumnError = (error: { message?: string } | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
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

const parseScheduledStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey) {
    return null;
  }

  if (idempotencyKey.startsWith("scheduled:")) {
    const parts = idempotencyKey.split(":");
    return parts.length >= 5 ? parts[2] : null;
  }

  return null;
};

const parseManualStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey) {
    return null;
  }

  if (idempotencyKey.startsWith("manual_switch:")) {
    const parts = idempotencyKey.split(":");
    return parts.length >= 4 ? parts[1] : null;
  }

  return null;
};

const parseActivationStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey) {
    return null;
  }

  if (idempotencyKey.startsWith("activation:")) {
    const parts = idempotencyKey.split(":");
    return parts.length >= 4 ? parts[2] : null;
  }

  return null;
};

const resolveStoreIdForJob = (job: SchedulerJobRow) => {
  return (
    job.store_id ??
    parseScheduledStoreIdFromKey(job.idempotency_key) ??
    parseManualStoreIdFromKey(job.idempotency_key) ??
    parseActivationStoreIdFromKey(job.idempotency_key)
  );
};

const isScheduledJob = (job: SchedulerJobRow) => {
  if ((job.trigger_type ?? "").toLowerCase() === "scheduled") {
    return true;
  }

  return (job.idempotency_key ?? "").startsWith("scheduled:");
};

const isManualSwitchJob = (job: SchedulerJobRow) => {
  if ((job.trigger_type ?? "").toLowerCase() === "manual_switch") {
    return true;
  }

  return (job.idempotency_key ?? "").startsWith("manual_switch:");
};

const isActivationJob = (job: SchedulerJobRow) => {
  if ((job.trigger_type ?? "").toLowerCase() === "activation") {
    return true;
  }

  return (job.idempotency_key ?? "").startsWith("activation:");
};

const getMostRecentIso = (rows: Array<{ run_at: string | null; created_at: string | null }>) => {
  let best: string | null = null;

  for (const row of rows) {
    const candidate = row.run_at ?? row.created_at;
    if (!candidate) {
      continue;
    }

    if (!best || new Date(candidate).getTime() > new Date(best).getTime()) {
      best = candidate;
    }
  }

  return best;
};

const getJobTimestamp = (job: Pick<SchedulerJobRow, "run_at" | "updated_at" | "created_at">) => {
  const candidates = [job.run_at, job.updated_at, job.created_at];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const parsed = new Date(candidate).getTime();
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const getLatestScheduledSlotDueMs = (jobs: SchedulerJobRow[]) => {
  let best = -1;

  for (const job of jobs) {
    if (!isScheduledJob(job)) {
      continue;
    }

    const slotDueIso = extractScheduledSlotDueIso(job.idempotency_key);
    if (!slotDueIso) {
      continue;
    }

    const slotDueMs = new Date(slotDueIso).getTime();
    if (Number.isNaN(slotDueMs)) {
      continue;
    }

    if (slotDueMs > best) {
      best = slotDueMs;
    }
  }

  return best >= 0 ? best : null;
};

const getRetryDelayMinutes = (retryCount: number) => {
  if (retryCount <= 0) {
    return 1;
  }

  const retrySchedule = [1, 2, 4, 8, 16] as const;
  return retrySchedule[Math.min(retryCount - 1, retrySchedule.length - 1)];
};

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const loadSubscriptions = async (userId: string) => {
  const withStoreId = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, store_id, shop_id, plan, status, current_period_end, updated_at, created_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (!withStoreId.error) {
    return (withStoreId.data ?? []) as SubscriptionRow[];
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw new Error(withStoreId.error.message);
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, shop_id, plan, status, current_period_end, updated_at, created_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return ((fallback.data ?? []) as SubscriptionRow[]).map((row) => ({
    ...row,
    store_id: row.shop_id && isUuid(row.shop_id) ? row.shop_id : null,
  }));
};

const loadSchedulerJobs = async (subscriptionIds: string[]) => {
  if (!subscriptionIds.length) {
    return [] as SchedulerJobRow[];
  }

  const selectCandidates = [
    "id, subscription_id, store_id, idempotency_key, status, trigger_type, run_at, updated_at, retry_count, error_message, created_at",
    "id, subscription_id, store_id, idempotency_key, status, trigger_type, run_at, updated_at, error_message, created_at",
    "id, subscription_id, idempotency_key, status, trigger_type, run_at, updated_at, error_message, created_at",
    "id, subscription_id, idempotency_key, status, run_at, updated_at, error_message, created_at",
    "id, subscription_id, idempotency_key, status, run_at, created_at",
  ] as const;

  let lastErrorMessage = "scheduler jobs could not be loaded";

  for (const select of selectCandidates) {
    const { data, error } = await supabaseAdmin
      .from("scheduler_jobs")
      .select(select)
      .in("subscription_id", subscriptionIds)
      .order("run_at", { ascending: false })
      .limit(1500);

    if (!error) {
      const rawRows = (data ?? []) as unknown as Array<{
        id: string;
        subscription_id?: string | null;
        store_id?: string | null;
        idempotency_key?: string | null;
        status?: string | null;
        trigger_type?: string | null;
        run_at?: string | null;
        updated_at?: string | null;
        retry_count?: number | null;
        error_message?: string | null;
        created_at?: string | null;
      }>;

      const rows = rawRows.map((row) => ({
        id: row.id,
        subscription_id: row.subscription_id ?? null,
        store_id: row.store_id ?? null,
        idempotency_key: row.idempotency_key ?? null,
        status: row.status ?? null,
        trigger_type: row.trigger_type ?? null,
        run_at: row.run_at ?? null,
        updated_at: row.updated_at ?? null,
        retry_count: row.retry_count ?? null,
        error_message: row.error_message ?? null,
        created_at: row.created_at ?? null,
      }));

      return rows as SchedulerJobRow[];
    }

    lastErrorMessage = error.message;

    if (!isRecoverableColumnError(error, ["store_id", "trigger_type", "updated_at", "retry_count", "error_message"])) {
      throw new Error(error.message);
    }
  }

  throw new Error(lastErrorMessage);
};

const loadStores = async (userId: string) => {
  const candidates = [
    {
      select: "id, user_id, store_name, category, status, price_cents, active_webhook_config_id, automation_updated_at, created_at",
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: true,
    },
    {
      select: "id, user_id, store_name, category, status, price_cents, active_webhook_config_id, created_at",
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: false,
    },
    {
      select: "id, user_id, store_name, category, status, price_cents, automation_updated_at, created_at",
      hasActiveWebhookColumn: false,
      hasAutomationUpdatedAtColumn: true,
    },
    {
      select: "id, user_id, store_name, category, status, price_cents, created_at",
      hasActiveWebhookColumn: false,
      hasAutomationUpdatedAtColumn: false,
    },
  ] as const;

  let lastErrorMessage = "stores could not be loaded";

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(candidate.select)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (!query.error) {
      const rows = ((query.data ?? []) as unknown as Array<{
        id: string;
        user_id: string;
        store_name: string;
        category: string | null;
        status: string | null;
        price_cents: number | null;
        active_webhook_config_id?: string | null;
        automation_updated_at?: string | null;
        created_at: string | null;
      }>).map((row) => ({
        ...row,
        active_webhook_config_id: candidate.hasActiveWebhookColumn ? row.active_webhook_config_id ?? null : null,
        automation_updated_at: candidate.hasAutomationUpdatedAtColumn ? row.automation_updated_at ?? null : null,
      }));

      return {
        rows: rows as StoreRow[],
        hasActiveWebhookColumn: candidate.hasActiveWebhookColumn,
      };
    }

    lastErrorMessage = query.error.message;

    if (!isRecoverableColumnError(query.error, ["active_webhook_config_id", "automation_updated_at"])) {
      throw new Error(query.error.message);
    }
  }

  throw new Error(lastErrorMessage);
};

const loadPaidOrderCounts = async (args: { userId: string; storeIds: string[] }) => {
  const countsByStoreId = new Map<string, number>();
  for (const storeId of args.storeIds) {
    countsByStoreId.set(storeId, 0);
  }

  if (!args.storeIds.length) {
    return {
      countsByStoreId,
      orphanPaidCount: 0,
    };
  }

  const candidates = [
    { select: "id, store_id, payment_status", hasStoreId: true, hasPaymentStatus: true },
    { select: "id, payment_status", hasStoreId: false, hasPaymentStatus: true },
    { select: "id, store_id", hasStoreId: true, hasPaymentStatus: false },
    { select: "id", hasStoreId: false, hasPaymentStatus: false },
  ] as const;

  let lastErrorMessage = "orders could not be loaded";
  const allowedStoreIds = new Set(args.storeIds);

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("orders")
      .select(candidate.select)
      .eq("user_id", args.userId)
      .limit(5000);

    if (!query.error) {
      const rows = (query.data ?? []) as unknown as OrderCountRow[];
      let orphanPaidCount = 0;

      for (const row of rows) {
        if (candidate.hasPaymentStatus) {
          const paymentStatus = (row.payment_status ?? "").toLowerCase();
          if (paymentStatus !== "paid") {
            continue;
          }
        } else {
          continue;
        }

        const storeId = candidate.hasStoreId ? row.store_id ?? null : null;

        if (storeId && allowedStoreIds.has(storeId)) {
          countsByStoreId.set(storeId, (countsByStoreId.get(storeId) ?? 0) + 1);
          continue;
        }

        orphanPaidCount += 1;
      }

      return {
        countsByStoreId,
        orphanPaidCount,
      };
    }

    lastErrorMessage = query.error.message;

    if (!isRecoverableColumnError(query.error, ["store_id", "payment_status"])) {
      throw new Error(query.error.message);
    }
  }

  throw new Error(lastErrorMessage);
};

const loadStoreWebhookMappingsFromLogs = async (storeIds: string[]) => {
  if (!storeIds.length) {
    return new Map<string, string[]>();
  }

  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("request_body, created_at")
    .eq("request_method", "STORE_WEBHOOK_MAP")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return new Map<string, string[]>();
  }

  const allowedStoreIds = new Set(storeIds);
  const mapping = new Map<string, string[]>();

  for (const row of (data ?? []) as Array<{ request_body: unknown }>) {
    const body =
      typeof row.request_body === "object" && row.request_body !== null
        ? (row.request_body as Record<string, unknown>)
        : null;

    const storeId = typeof body?.store_id === "string" ? body.store_id : null;
    const webhookConfigId = typeof body?.webhook_config_id === "string" ? body.webhook_config_id : null;

    if (!storeId || !webhookConfigId || !allowedStoreIds.has(storeId)) {
      continue;
    }

    const current = mapping.get(storeId) ?? [];
    if (!current.includes(webhookConfigId)) {
      current.push(webhookConfigId);
    }
    mapping.set(storeId, current);
  }

  return mapping;
};

const loadActiveAutomationWebhookIds = async () => {
  const candidates = [
    "id, enabled, scope",
    "id, enabled",
    "id, scope",
    "id",
  ] as const;

  for (const select of candidates) {
    const query = supabaseAdmin
      .from("webhook_configs")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(2000);

    const { data, error } = await query;

    if (error) {
      if (!isRecoverableColumnError(error, ["enabled", "scope"])) {
        throw new Error(error.message);
      }

      continue;
    }

    const rows = (data ?? []) as unknown as Array<{ id: string; enabled?: boolean | null; scope?: string | null }>;
    const activeIds = new Set<string>();

    for (const row of rows) {
      if (row.enabled === false) {
        continue;
      }

      if (row.scope && row.scope === "generic") {
        continue;
      }

      activeIds.add(row.id);
    }

    return activeIds;
  }

  return new Set<string>();
};

const loadLatestCronTickMs = async () => {
  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("created_at")
    .eq("request_method", "CRON_TICK")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string | null }>();

  if (error || !data?.created_at) {
    return null;
  }

  const parsed = new Date(data.created_at).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const triggerTickWithCronSecret = async (request: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return false;
  }

  try {
    const response = await fetch(`${request.nextUrl.origin}/api/scheduler/tick`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "x-listflow-tick-source": "stores-overview-fallback",
      },
    });

    return response.ok;
  } catch {
    return false;
  }
};

export async function GET(request: NextRequest) {
  try {
    const token = getAccessToken(request);

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rows: stores, hasActiveWebhookColumn } = await loadStores(user.id);
    const subscriptions = await loadSubscriptions(user.id);
    const subscriptionIds = subscriptions.map((row) => row.id);
    const storeIds = stores.map((store) => store.id);

    let schedulerJobs: SchedulerJobRow[] = [];

    try {
      schedulerJobs = await loadSchedulerJobs(subscriptionIds);
    } catch {
      schedulerJobs = [];
    }

    const { countsByStoreId, orphanPaidCount } = await loadPaidOrderCounts({
      userId: user.id,
      storeIds,
    });

    // Legacy orders created without store_id are assignable only when user has one store.
    if (orphanPaidCount > 0 && storeIds.length === 1) {
      const singleStoreId = storeIds[0];
      countsByStoreId.set(singleStoreId, (countsByStoreId.get(singleStoreId) ?? 0) + orphanPaidCount);
    }

    const fallbackStoreWebhookMap = hasActiveWebhookColumn
      ? new Map<string, string[]>()
      : await loadStoreWebhookMappingsFromLogs(storeIds);
    const activeAutomationWebhookIds = await loadActiveAutomationWebhookIds();
    const singletonActiveWebhookId =
      activeAutomationWebhookIds.size === 1 ? Array.from(activeAutomationWebhookIds)[0] : null;

    const resolveStoreWebhookId = (store: StoreRow) => {
      const explicitId = store.active_webhook_config_id;

      if (explicitId && activeAutomationWebhookIds.has(explicitId)) {
        return explicitId;
      }

      const fallbackCandidates = fallbackStoreWebhookMap.get(store.id) ?? [];
      for (const candidateId of fallbackCandidates) {
        if (activeAutomationWebhookIds.has(candidateId)) {
          return candidateId;
        }
      }

      return singletonActiveWebhookId;
    };

    const rows = stores.map((store) => {
      const matchedSubscriptions = subscriptions
        .filter((row) => {
          const storeId = row.store_id ?? (row.shop_id && isUuid(row.shop_id) ? row.shop_id : null);
          return storeId === store.id;
        })
        .sort((a, b) => {
          const aTs = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
          const bTs = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
          return bTs - aTs;
        });

      const activeSubscription = matchedSubscriptions.find((row) => isActiveSubscription(row)) ?? null;
      const primarySubscription = activeSubscription ?? matchedSubscriptions[0] ?? null;

      const plan = (primarySubscription?.plan ?? null)?.toLowerCase() || null;
      const intervalHours = plan ? getPlanWindowHours(plan) : null;
      const intervalMs = intervalHours ? intervalHours * 60 * 60 * 1000 : null;
      const nowMs = Date.now();
      const configuredWebhookId = resolveStoreWebhookId(store);
      const hasActiveAutomationWebhook = Boolean(configuredWebhookId);

      const subscriptionJobs = primarySubscription
        ? schedulerJobs.filter((job) => job.subscription_id === primarySubscription.id)
        : [];

      const storeScopedJobs = subscriptionJobs.filter((job) => {
        const resolvedStoreId = resolveStoreIdForJob(job);
        return resolvedStoreId ? resolvedStoreId === store.id : true;
      });

      const cadenceAnchorJobs = storeScopedJobs.filter((job) => {
        const status = (job.status ?? "").toLowerCase();

        if (status !== "success") {
          return false;
        }

        return isScheduledJob(job) || isManualSwitchJob(job) || isActivationJob(job);
      });

      const lastSuccessfulAutomationAt = getMostRecentIso(cadenceAnchorJobs);
      const latestScheduledSlotDueMs = getLatestScheduledSlotDueMs(storeScopedJobs);

      let nextAutomationAtMs: number | null = null;

      if (intervalMs !== null && hasActiveAutomationWebhook) {
        if (lastSuccessfulAutomationAt) {
          nextAutomationAtMs = new Date(lastSuccessfulAutomationAt).getTime() + intervalMs;
        } else if (latestScheduledSlotDueMs !== null) {
          nextAutomationAtMs = latestScheduledSlotDueMs;
        } else {
          nextAutomationAtMs = nowMs;
        }
      }

      const latestScheduledFailedJob = storeScopedJobs
        .filter((job) => isScheduledJob(job) && (job.status ?? "").toLowerCase() === "failed")
        .sort((a, b) => getJobTimestamp(b) - getJobTimestamp(a))[0];

      const retryCount = latestScheduledFailedJob?.retry_count ?? 0;
      const hasRetryWindow = Boolean(latestScheduledFailedJob) && retryCount < 5;

      if (hasActiveAutomationWebhook && hasRetryWindow && latestScheduledFailedJob) {
        const delayMinutes = getRetryDelayMinutes(retryCount);
        const retryAtMs = getJobTimestamp(latestScheduledFailedJob) + delayMinutes * 60 * 1000;
        nextAutomationAtMs = retryAtMs;
      } else if (
        hasActiveAutomationWebhook &&
        latestScheduledFailedJob &&
        retryCount >= 5 &&
        nextAutomationAtMs !== null &&
        intervalMs !== null
      ) {
        const slotDueIso = extractScheduledSlotDueIso(latestScheduledFailedJob.idempotency_key);
        const slotDueMs = slotDueIso ? new Date(slotDueIso).getTime() : null;
        if (slotDueMs !== null && !Number.isNaN(slotDueMs) && slotDueMs >= nextAutomationAtMs) {
          nextAutomationAtMs = slotDueMs + intervalMs;
        }
      }

      const nextAutomationAt = nextAutomationAtMs !== null ? new Date(nextAutomationAtMs).toISOString() : null;

      const hasProcessingAutomation = subscriptionJobs.some((job) => {
        const status = (job.status ?? "").toLowerCase();
        if (status !== "processing") {
          return false;
        }

        const resolvedStoreId = resolveStoreIdForJob(job);
        return resolvedStoreId ? resolvedStoreId === store.id : true;
      });

      const hasActiveSubscription = Boolean(activeSubscription);
      const canDelete = !hasActiveSubscription && !hasProcessingAutomation;
      const deleteBlockedReason = hasActiveSubscription
        ? "active_subscription"
        : hasProcessingAutomation
          ? "automation_running"
          : null;

      const automationState: "waiting" | "due" | "processing" | "retrying" | "error" = (() => {
        if (!hasActiveSubscription || !intervalMs || !hasActiveAutomationWebhook) {
          return "waiting";
        }

        if (hasProcessingAutomation) {
          return "processing";
        }

        if (hasRetryWindow) {
          return "retrying";
        }

        if (nextAutomationAtMs !== null && nextAutomationAtMs <= nowMs) {
          return "due";
        }

        if (latestScheduledFailedJob && retryCount >= 5) {
          return "error";
        }

        return "waiting";
      })();

      return {
        id: store.id,
        storeName: store.store_name,
        category: store.category,
        status: store.status,
        priceCents: store.price_cents ?? 0,
        orderCount: countsByStoreId.get(store.id) ?? 0,
        hasActiveSubscription,
        hasActiveAutomationWebhook,
        plan,
        subscriptionStatus: activeSubscription?.status ?? primarySubscription?.status ?? null,
        automationIntervalHours: intervalHours,
        automationLastRunAt: lastSuccessfulAutomationAt,
        lastSuccessfulAutomationAt,
        nextAutomationAt,
        automationState,
        canDelete,
        deleteBlockedReason,
      };
    });

    const nowMs = Date.now();
    const hasDueAutomation = rows.some((row) => {
      if (!row.hasActiveSubscription || !row.hasActiveAutomationWebhook || row.automationState === "processing") {
        return false;
      }

      if (!row.nextAutomationAt) {
        return false;
      }

      const nextAutomationAtMs = new Date(row.nextAutomationAt).getTime();
      if (Number.isNaN(nextAutomationAtMs)) {
        return false;
      }

      return nextAutomationAtMs <= nowMs;
    });

    if (hasDueAutomation) {
      const latestCronTickMs = await loadLatestCronTickMs();
      const isCronStale = latestCronTickMs === null || nowMs - latestCronTickMs > 3 * 60 * 1000;

      if (isCronStale) {
        await triggerTickWithCronSecret(request);
      }
    }

    return NextResponse.json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load stores overview";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
