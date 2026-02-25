import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchN8nTrigger } from "@/lib/n8n/client";
import {
  createScheduledSlotIdempotencyKey,
  extractScheduledSlotDueIso,
  getPlanWindowHours,
} from "@/lib/scheduler/idempotency";
import { isUuid } from "@/lib/utils/uuid";

type SubscriptionRow = {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  current_period_end?: string | null;
  store_id?: string | null;
  shop_id?: string | null;
  updated_at?: string | null;
};

type StoreRow = {
  id: string;
  active_webhook_config_id: string | null;
};

type WebhookConfigRow = {
  id: string;
  target_url: string;
  method: "GET" | "POST" | string | null;
  headers: Record<string, unknown> | null;
  enabled: boolean | null;
  scope?: string | null;
};

type SchedulerJobRow = {
  id: string;
  subscription_id: string | null;
  store_id: string | null;
  idempotency_key: string | null;
  status: string | null;
  trigger_type: string | null;
  run_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  retry_count: number | null;
  error_message: string | null;
};

type SchedulerSummary = {
  total: number;
  triggered: number;
  skipped: number;
  failed: number;
  reasonBreakdown: Record<string, number>;
};

type SchedulerJobResult = {
  id: string | null;
  error: { code?: string; message?: string } | null;
};

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BACKOFF_MINUTES = [1, 2, 4, 8, 16] as const;

const isUniqueViolation = (error: { code?: string; message?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  return error.code === "23505" || (error.message ?? "").toLowerCase().includes("duplicate");
};

const isMissingColumnError = (error: { message?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isMissingAnyColumnError = (error: { message?: string } | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const normalizeIso = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

const toTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const addReason = (summary: SchedulerSummary, reason: string) => {
  summary.reasonBreakdown[reason] = (summary.reasonBreakdown[reason] ?? 0) + 1;
};

const markSkipped = (summary: SchedulerSummary, reason: string) => {
  summary.skipped += 1;
  addReason(summary, reason);
};

const markFailed = (summary: SchedulerSummary, reason: string) => {
  summary.failed += 1;
  addReason(summary, reason);
};

const getSubscriptionStoreId = (subscription: SubscriptionRow) => {
  if (subscription.store_id) {
    return subscription.store_id;
  }

  if (subscription.shop_id && isUuid(subscription.shop_id)) {
    return subscription.shop_id;
  }

  return null;
};

const isSubscriptionEligible = (subscription: SubscriptionRow, nowMs: number) => {
  const status = (subscription.status ?? "").toLowerCase();
  if (!["active", "trialing"].includes(status)) {
    return false;
  }

  const periodEndMs = toTimestamp(subscription.current_period_end ?? null);
  if (periodEndMs === null) {
    return true;
  }

  return periodEndMs > nowMs;
};

const parseScheduledStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey || !idempotencyKey.startsWith("scheduled:")) {
    return null;
  }

  const parts = idempotencyKey.split(":");
  return parts.length >= 5 ? parts[2] : null;
};

const parseManualStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey || !idempotencyKey.startsWith("manual_switch:")) {
    return null;
  }

  const parts = idempotencyKey.split(":");
  return parts.length >= 4 ? parts[1] : null;
};

const parseActivationStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey || !idempotencyKey.startsWith("activation:")) {
    return null;
  }

  const parts = idempotencyKey.split(":");
  return parts.length >= 4 ? parts[2] : null;
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

const matchesStore = (job: SchedulerJobRow, storeId: string) => {
  const resolvedStoreId = resolveStoreIdForJob(job);
  return resolvedStoreId ? resolvedStoreId === storeId : true;
};

const getJobTimestamp = (job: SchedulerJobRow) => {
  return (
    toTimestamp(job.run_at) ??
    toTimestamp(job.updated_at) ??
    toTimestamp(job.created_at) ??
    0
  );
};

const getRetryDelayMinutes = (retryCount: number) => {
  const normalizedRetryCount = Math.max(1, retryCount);
  const index = Math.min(normalizedRetryCount - 1, RETRY_BACKOFF_MINUTES.length - 1);
  return RETRY_BACKOFF_MINUTES[index];
};

const loadActiveSubscriptions = async () => {
  const withStoreId = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, plan, status, current_period_end, store_id, shop_id, updated_at")
    .in("status", ["active", "trialing"])
    .limit(1000);

  if (!withStoreId.error) {
    return (withStoreId.data ?? []) as SubscriptionRow[];
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw withStoreId.error;
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, plan, status, current_period_end, shop_id, updated_at")
    .in("status", ["active", "trialing"])
    .limit(1000);

  if (fallback.error) {
    throw fallback.error;
  }

  return ((fallback.data ?? []) as SubscriptionRow[]).map((row) => ({
    ...row,
    store_id: row.shop_id && isUuid(row.shop_id) ? row.shop_id : null,
  }));
};

const loadStores = async (storeIds: string[]) => {
  if (!storeIds.length) {
    return { rows: [] as StoreRow[], hasActiveWebhookColumn: true };
  }

  const withWebhook = await supabaseAdmin
    .from("stores")
    .select("id, active_webhook_config_id")
    .in("id", storeIds);

  if (!withWebhook.error) {
    return {
      rows: (withWebhook.data ?? []) as StoreRow[],
      hasActiveWebhookColumn: true,
    };
  }

  if (!isMissingColumnError(withWebhook.error, "active_webhook_config_id")) {
    throw withWebhook.error;
  }

  const fallback = await supabaseAdmin.from("stores").select("id").in("id", storeIds);
  if (fallback.error) {
    throw fallback.error;
  }

  return {
    rows: ((fallback.data ?? []) as Array<{ id: string }>).map((row) => ({
      id: row.id,
      active_webhook_config_id: null,
    })),
    hasActiveWebhookColumn: false,
  };
};

const loadStoreWebhookMappingsFromLogs = async (storeIds: string[]) => {
  if (!storeIds.length) {
    return new Map<string, string[]>();
  }

  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("request_body, request_url, created_at")
    .eq("request_method", "STORE_WEBHOOK_MAP")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return new Map<string, string[]>();
  }

  const allowedStoreIds = new Set(storeIds);
  const mapping = new Map<string, string[]>();

  for (const row of (data ?? []) as Array<{ request_body: unknown; request_url?: string | null }>) {
    const body =
      typeof row.request_body === "object" && row.request_body !== null
        ? (row.request_body as Record<string, unknown>)
        : null;

    const sourceUrl = typeof row.request_url === "string" ? row.request_url : null;
    const idempotencyKey = typeof body?.idempotency_key === "string" ? body.idempotency_key : null;
    const isManualBinding = sourceUrl === "store-webhook-mapping" || (idempotencyKey?.startsWith("manual_switch:") ?? false);
    const isActivationBinding =
      sourceUrl === "store-webhook-mapping-activation" || (idempotencyKey?.startsWith("activation:") ?? false);
    if (!isManualBinding && !isActivationBinding) {
      continue;
    }

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

const loadWebhookConfigs = async () => {
  const withScope = await supabaseAdmin
    .from("webhook_configs")
    .select("id, target_url, method, headers, enabled, scope")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (!withScope.error) {
    return (withScope.data ?? []) as WebhookConfigRow[];
  }

  if (!isMissingColumnError(withScope.error, "scope")) {
    throw withScope.error;
  }

  const fallback = await supabaseAdmin
    .from("webhook_configs")
    .select("id, target_url, method, headers, enabled")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (fallback.error) {
    throw fallback.error;
  }

  return ((fallback.data ?? []) as WebhookConfigRow[]).map((row) => ({
    ...row,
    scope: "automation",
  }));
};

const loadSchedulerJobs = async (subscriptionIds: string[]) => {
  if (!subscriptionIds.length) {
    return [] as SchedulerJobRow[];
  }

  const selectCandidates = [
    "id, subscription_id, store_id, idempotency_key, status, trigger_type, run_at, retry_count, error_message, created_at, updated_at",
    "id, subscription_id, store_id, idempotency_key, status, trigger_type, run_at, error_message, created_at, updated_at",
    "id, subscription_id, idempotency_key, status, trigger_type, run_at, error_message, created_at, updated_at",
    "id, subscription_id, idempotency_key, status, run_at, error_message, created_at, updated_at",
    "id, subscription_id, idempotency_key, status, run_at, created_at",
  ] as const;

  let lastError = "scheduler jobs could not be loaded";

  for (const select of selectCandidates) {
    const query = await supabaseAdmin
      .from("scheduler_jobs")
      .select(select)
      .in("subscription_id", subscriptionIds)
      .order("run_at", { ascending: false })
      .limit(10000);

    if (!query.error) {
      const rows = (query.data ?? []) as unknown as Array<{
        id: string;
        subscription_id?: string | null;
        store_id?: string | null;
        idempotency_key?: string | null;
        status?: string | null;
        trigger_type?: string | null;
        run_at?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
        retry_count?: number | null;
        error_message?: string | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        subscription_id: row.subscription_id ?? null,
        store_id: row.store_id ?? null,
        idempotency_key: row.idempotency_key ?? null,
        status: row.status ?? null,
        trigger_type: row.trigger_type ?? null,
        run_at: row.run_at ?? null,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
        retry_count: row.retry_count ?? null,
        error_message: row.error_message ?? null,
      })) as SchedulerJobRow[];
    }

    lastError = query.error.message;

    if (
      !isMissingAnyColumnError(query.error, [
        "store_id",
        "trigger_type",
        "retry_count",
        "error_message",
        "updated_at",
      ])
    ) {
      throw query.error;
    }
  }

  throw new Error(lastError);
};

const insertSchedulerJobWithFallback = async (args: {
  subscriptionId: string;
  userId: string;
  plan: string;
  idempotencyKey: string;
  runAt: string;
  status: "processing" | "skipped";
  storeId?: string | null;
  webhookConfigId?: string | null;
  triggerType?: "scheduled" | "manual_switch";
  requestPayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      plan: args.plan,
      status: args.status,
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
      store_id: args.storeId ?? null,
      webhook_config_id: args.webhookConfigId ?? null,
      trigger_type: args.triggerType ?? "scheduled",
      request_payload: args.requestPayload ?? null,
      error_message: args.errorMessage ?? null,
      retry_count: 0,
      updated_at: new Date().toISOString(),
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      plan: args.plan,
      status: args.status,
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
      store_id: args.storeId ?? null,
      webhook_config_id: args.webhookConfigId ?? null,
      trigger_type: args.triggerType ?? "scheduled",
      request_payload: args.requestPayload ?? null,
      error_message: args.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      plan: args.plan,
      status: args.status,
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
      store_id: args.storeId ?? null,
      webhook_config_id: args.webhookConfigId ?? null,
      error_message: args.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      plan: args.plan,
      status: args.status,
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
      error_message: args.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      plan: args.plan,
      status: args.status,
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
      error_message: args.errorMessage ?? null,
    },
  ];

  let lastError: { code?: string; message?: string } | null = null;

  for (const payload of payloads) {
    const attempt = await supabaseAdmin
      .from("scheduler_jobs")
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (!attempt.error) {
      return {
        id: attempt.data?.id ?? null,
        error: null,
      } satisfies SchedulerJobResult;
    }

    const toleratedMissingColumns = isMissingAnyColumnError(attempt.error, [
      "store_id",
      "webhook_config_id",
      "trigger_type",
      "request_payload",
      "error_message",
      "retry_count",
      "updated_at",
    ]);

    if (!toleratedMissingColumns) {
      return {
        id: null,
        error: {
          code: attempt.error.code,
          message: attempt.error.message,
        },
      } satisfies SchedulerJobResult;
    }

    lastError = {
      code: attempt.error.code,
      message: attempt.error.message,
    };
  }

  return {
    id: null,
    error: lastError,
  } satisfies SchedulerJobResult;
};

const updateSchedulerJobWithFallback = async (
  jobId: string,
  patch: {
    status: string;
    responseStatus?: number | null;
    responsePayload?: string | null;
    errorMessage?: string | null;
    runAt?: string;
    retryCount?: number;
  }
) => {
  const nowIso = new Date().toISOString();
  const fullPayload: Record<string, unknown> = {
    status: patch.status,
    response_status: patch.responseStatus ?? null,
    response_payload: patch.responsePayload ?? null,
    error_message: patch.errorMessage ?? null,
    run_at: patch.runAt ?? null,
    retry_count: patch.retryCount ?? null,
    updated_at: nowIso,
  };

  const payloads: Array<Record<string, unknown>> = [
    fullPayload,
    (() => {
      const next = { ...fullPayload };
      delete next.retry_count;
      return next;
    })(),
    (() => {
      const next = { ...fullPayload };
      delete next.response_payload;
      return next;
    })(),
    (() => {
      const next = { ...fullPayload };
      delete next.response_status;
      delete next.response_payload;
      return next;
    })(),
    (() => {
      const next = { ...fullPayload };
      delete next.response_status;
      delete next.response_payload;
      delete next.retry_count;
      return next;
    })(),
    (() => {
      const next = { ...fullPayload };
      delete next.response_status;
      delete next.response_payload;
      delete next.retry_count;
      delete next.run_at;
      return next;
    })(),
    {
      status: patch.status,
    },
  ];

  for (const payload of payloads) {
    const attempt = await supabaseAdmin.from("scheduler_jobs").update(payload).eq("id", jobId);

    if (!attempt.error) {
      return;
    }

    const toleratedMissingColumns = isMissingAnyColumnError(attempt.error, [
      "response_status",
      "response_payload",
      "error_message",
      "retry_count",
      "run_at",
      "updated_at",
    ]);

    if (!toleratedMissingColumns) {
      throw attempt.error;
    }
  }
};

const insertWebhookLogWithFallback = async (args: {
  requestUrl: string;
  requestMethod: "GET" | "POST";
  requestHeaders: Record<string, unknown>;
  requestBody: Record<string, unknown>;
  responseStatus: number | null;
  responseBody: string | null;
  durationMs: number;
  createdBy: string | null;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      request_url: args.requestUrl,
      request_method: args.requestMethod,
      request_headers: args.requestHeaders,
      request_body: args.requestBody,
      response_status: args.responseStatus,
      response_body: args.responseBody,
      duration_ms: args.durationMs,
      created_by: args.createdBy,
    },
    {
      request_url: args.requestUrl,
      request_method: args.requestMethod,
      request_headers: args.requestHeaders,
      request_body: args.requestBody,
      response_status: args.responseStatus,
      response_body: args.responseBody,
      duration_ms: args.durationMs,
    },
    {
      request_url: args.requestUrl,
      request_method: args.requestMethod,
      request_body: args.requestBody,
      response_status: args.responseStatus,
      response_body: args.responseBody,
      duration_ms: args.durationMs,
    },
    {
      request_url: args.requestUrl,
      request_method: args.requestMethod,
      response_status: args.responseStatus,
      response_body: args.responseBody,
      duration_ms: args.durationMs,
    },
  ];

  for (const payload of payloads) {
    const attempt = await supabaseAdmin.from("webhook_logs").insert(payload);

    if (!attempt.error) {
      return;
    }

    const toleratedMissingColumns = isMissingAnyColumnError(attempt.error, [
      "request_headers",
      "request_body",
      "response_status",
      "response_body",
      "duration_ms",
      "created_by",
    ]);

    if (!toleratedMissingColumns) {
      return;
    }
  }
};

const createSkippedJob = async (args: {
  subscription: SubscriptionRow;
  storeId: string;
  idempotencyKey: string;
  webhookConfigId?: string | null;
  reason: string;
}) => {
  const result = await insertSchedulerJobWithFallback({
    subscriptionId: args.subscription.id,
    userId: args.subscription.user_id,
    plan: args.subscription.plan,
    idempotencyKey: args.idempotencyKey,
    runAt: new Date().toISOString(),
    status: "skipped",
    storeId: args.storeId,
    webhookConfigId: args.webhookConfigId ?? null,
    triggerType: "scheduled",
    requestPayload: { client_id: args.storeId },
    errorMessage: args.reason,
  });

  if (result.error && !isUniqueViolation(result.error)) {
    throw result.error;
  }
};

const getMostRecentCadenceSuccessAt = (jobs: SchedulerJobRow[], storeId: string) => {
  for (const job of jobs) {
    if (!matchesStore(job, storeId)) {
      continue;
    }

    if ((job.status ?? "").toLowerCase() !== "success") {
      continue;
    }

    if (!(isScheduledJob(job) || isManualSwitchJob(job) || isActivationJob(job))) {
      continue;
    }

    const iso = normalizeIso(job.run_at ?? job.updated_at ?? job.created_at);
    if (iso) {
      return iso;
    }
  }

  return null;
};

const getLatestScheduledSlotDueAt = (jobs: SchedulerJobRow[], storeId: string) => {
  let latestIso: string | null = null;
  let latestMs = -1;

  for (const job of jobs) {
    if (!matchesStore(job, storeId) || !isScheduledJob(job)) {
      continue;
    }

    const slotDueIso = extractScheduledSlotDueIso(job.idempotency_key);
    if (!slotDueIso) {
      continue;
    }

    const slotDueMs = toTimestamp(slotDueIso);
    if (slotDueMs === null) {
      continue;
    }

    if (slotDueMs > latestMs) {
      latestMs = slotDueMs;
      latestIso = slotDueIso;
    }
  }

  return latestIso;
};

const findScheduledSlotJob = (jobs: SchedulerJobRow[], storeId: string, slotKey: string) => {
  for (const job of jobs) {
    if (!matchesStore(job, storeId) || !isScheduledJob(job)) {
      continue;
    }

    if (job.idempotency_key === slotKey) {
      return job;
    }
  }

  return null;
};

const isActiveAutomationWebhook = (webhookConfig: WebhookConfigRow | null | undefined) => {
  if (!webhookConfig) {
    return false;
  }

  if (webhookConfig.enabled === false) {
    return false;
  }

  if (webhookConfig.scope === "generic") {
    return false;
  }

  return true;
};

export const runSchedulerTick = async (): Promise<SchedulerSummary> => {
  const subscriptions = await loadActiveSubscriptions();
  const nowMs = Date.now();

  const summary: SchedulerSummary = {
    total: subscriptions.length,
    triggered: 0,
    skipped: 0,
    failed: 0,
    reasonBreakdown: {},
  };

  const storeIds = Array.from(
    new Set(
      subscriptions
        .map((subscription) => getSubscriptionStoreId(subscription))
        .filter((storeId): storeId is string => Boolean(storeId))
    )
  );

  const [{ rows: storeRows }, schedulerJobs] = await Promise.all([
    loadStores(storeIds),
    loadSchedulerJobs(subscriptions.map((row) => row.id)),
  ]);

  const fallbackStoreWebhookMap = await loadStoreWebhookMappingsFromLogs(storeIds);
  const storesById = new Map<string, StoreRow>(storeRows.map((store) => [store.id, store]));
  const webhookConfigs = await loadWebhookConfigs();
  const webhooksById = new Map<string, WebhookConfigRow>(
    webhookConfigs.map((config) => [config.id, config])
  );
  const activeAutomationWebhookIds = webhookConfigs
    .filter((config) => isActiveAutomationWebhook(config))
    .map((config) => config.id);
  const singletonActiveWebhookId = activeAutomationWebhookIds.length === 1 ? activeAutomationWebhookIds[0] : null;
  const activeWebhookByStoreId = new Map<string, string | null>();

  for (const storeId of storeIds) {
    const explicitWebhookId = storesById.get(storeId)?.active_webhook_config_id ?? null;
    const fallbackWebhookCandidates = fallbackStoreWebhookMap.get(storeId) ?? [];

    let resolvedWebhookId: string | null = null;

    if (explicitWebhookId && isActiveAutomationWebhook(webhooksById.get(explicitWebhookId))) {
      resolvedWebhookId = explicitWebhookId;
    }

    if (!resolvedWebhookId) {
      for (const candidateId of fallbackWebhookCandidates) {
        if (isActiveAutomationWebhook(webhooksById.get(candidateId))) {
          resolvedWebhookId = candidateId;
          break;
        }
      }
    }

    if (!resolvedWebhookId && singletonActiveWebhookId) {
      resolvedWebhookId = singletonActiveWebhookId;
    }

    activeWebhookByStoreId.set(storeId, resolvedWebhookId);
  }

  const jobsBySubscriptionId = new Map<string, SchedulerJobRow[]>();

  for (const job of schedulerJobs) {
    if (!job.subscription_id) {
      continue;
    }

    if (!jobsBySubscriptionId.has(job.subscription_id)) {
      jobsBySubscriptionId.set(job.subscription_id, []);
    }

    jobsBySubscriptionId.get(job.subscription_id)?.push(job);
  }

  for (const jobs of jobsBySubscriptionId.values()) {
    jobs.sort((a, b) => getJobTimestamp(b) - getJobTimestamp(a));
  }

  for (const subscription of subscriptions) {
    try {
      if (!isSubscriptionEligible(subscription, nowMs)) {
        markSkipped(summary, "subscription_inactive_or_expired");
        continue;
      }

      const storeId = getSubscriptionStoreId(subscription);

      if (!storeId) {
        markSkipped(summary, "subscription_inactive_or_expired");
        continue;
      }

      const intervalHours = getPlanWindowHours(subscription.plan);
      const intervalMs = intervalHours * 60 * 60 * 1000;
      const subscriptionJobs = jobsBySubscriptionId.get(subscription.id) ?? [];
      const cadenceAnchorIso = getMostRecentCadenceSuccessAt(subscriptionJobs, storeId);
      const latestScheduledSlotDueIso = getLatestScheduledSlotDueAt(subscriptionJobs, storeId);

      let slotDueMs = (() => {
        const cadenceAnchorMs = toTimestamp(cadenceAnchorIso);
        if (cadenceAnchorMs !== null) {
          return cadenceAnchorMs + intervalMs;
        }

        const latestScheduledSlotDueMs = toTimestamp(latestScheduledSlotDueIso);
        if (latestScheduledSlotDueMs !== null) {
          return latestScheduledSlotDueMs;
        }

        return nowMs;
      })();

      let slotDueIso = new Date(slotDueMs).toISOString();
      let idempotencyKey = createScheduledSlotIdempotencyKey({
        subscriptionId: subscription.id,
        storeId,
        plan: subscription.plan,
        slotDueAtIso: slotDueIso,
      });
      let slotJob = findScheduledSlotJob(subscriptionJobs, storeId, idempotencyKey);

      while (slotJob && (slotJob.status ?? "").toLowerCase() === "failed" && (slotJob.retry_count ?? 0) >= MAX_RETRY_ATTEMPTS) {
        slotDueMs += intervalMs;
        slotDueIso = new Date(slotDueMs).toISOString();
        idempotencyKey = createScheduledSlotIdempotencyKey({
          subscriptionId: subscription.id,
          storeId,
          plan: subscription.plan,
          slotDueAtIso: slotDueIso,
        });
        slotJob = findScheduledSlotJob(subscriptionJobs, storeId, idempotencyKey);
      }

      if (nowMs < slotDueMs) {
        markSkipped(summary, "not_due_yet");
        continue;
      }

      const activeWebhookConfigId = activeWebhookByStoreId.get(storeId) ?? null;

      if (!activeWebhookConfigId) {
        await createSkippedJob({
          subscription,
          storeId,
          idempotencyKey,
          reason: "no_active_webhook_config",
        });
        markSkipped(summary, "no_active_webhook_config");
        continue;
      }

      const webhookConfig = webhooksById.get(activeWebhookConfigId);

      if (!webhookConfig || !webhookConfig.enabled || webhookConfig.scope === "generic") {
        await createSkippedJob({
          subscription,
          storeId,
          webhookConfigId: activeWebhookConfigId,
          idempotencyKey,
          reason: "inactive_or_invalid_webhook_config",
        });
        markSkipped(summary, "inactive_or_invalid_webhook_config");
        continue;
      }

      const existingStatus = (slotJob?.status ?? "").toLowerCase();

      if (slotJob && ["processing", "success"].includes(existingStatus)) {
        markSkipped(summary, "not_due_yet");
        continue;
      }

      const nowIso = new Date().toISOString();
      let currentRetryCount = slotJob?.retry_count ?? 0;
      let schedulerJobId: string | null = null;

      if (slotJob && existingStatus === "failed") {
        const lastAttemptMs = getJobTimestamp(slotJob);
        const retryDelayMinutes = getRetryDelayMinutes(currentRetryCount);
        const nextRetryAtMs = lastAttemptMs + retryDelayMinutes * 60 * 1000;

        if (nowMs < nextRetryAtMs) {
          markSkipped(summary, "retry_backoff");
          continue;
        }

        await updateSchedulerJobWithFallback(slotJob.id, {
          status: "processing",
          runAt: nowIso,
          errorMessage: null,
        });

        schedulerJobId = slotJob.id;
      } else if (slotJob && existingStatus === "skipped") {
        await updateSchedulerJobWithFallback(slotJob.id, {
          status: "processing",
          runAt: nowIso,
          errorMessage: null,
        });

        schedulerJobId = slotJob.id;
        currentRetryCount = slotJob.retry_count ?? 0;
      } else {
        const createdJobResult = await insertSchedulerJobWithFallback({
          subscriptionId: subscription.id,
          userId: subscription.user_id,
          plan: subscription.plan,
          idempotencyKey,
          runAt: nowIso,
          status: "processing",
          storeId,
          webhookConfigId: activeWebhookConfigId,
          triggerType: "scheduled",
          requestPayload: {
            client_id: storeId,
          },
        });

        if (createdJobResult.error) {
          if (isUniqueViolation(createdJobResult.error)) {
            markSkipped(summary, "not_due_yet");
            continue;
          }

          throw createdJobResult.error;
        }

        schedulerJobId = createdJobResult.id;
        currentRetryCount = 0;
      }

      const requestMethod = webhookConfig.method === "GET" ? "GET" : "POST";
      const requestBody = {
        client_id: storeId,
        trigger_type: "scheduled",
        subscription_id: subscription.id,
        webhook_config_id: activeWebhookConfigId,
        idempotency_key: idempotencyKey,
        slot_due_at: slotDueIso,
        attempt: currentRetryCount + 1,
        triggered_at: nowIso,
      };
      const requestHeaders = webhookConfig.headers ?? {};
      const requestStartAt = Date.now();

      try {
        const result = await dispatchN8nTrigger({
          url: webhookConfig.target_url,
          method: requestMethod,
          headers: requestHeaders,
          payload: {
            client_id: storeId,
          },
          idempotencyKey,
          triggeredAt: nowIso,
        });

        if (schedulerJobId) {
          await updateSchedulerJobWithFallback(schedulerJobId, {
            status: result.ok ? "success" : "failed",
            responsePayload: result.body,
            responseStatus: result.status,
            runAt: nowIso,
            retryCount: result.ok ? currentRetryCount : currentRetryCount + 1,
            errorMessage: result.ok ? null : result.body,
          });
        }

        await insertWebhookLogWithFallback({
          requestUrl: webhookConfig.target_url,
          requestMethod,
          requestHeaders,
          requestBody,
          responseStatus: result.status,
          responseBody: result.body,
          durationMs: Date.now() - requestStartAt,
          createdBy: isUuid(subscription.user_id) ? subscription.user_id : null,
        });

        if (result.ok) {
          summary.triggered += 1;
        } else {
          markFailed(summary, "dispatch_failed");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Scheduler dispatch failed";

        if (schedulerJobId) {
          await updateSchedulerJobWithFallback(schedulerJobId, {
            status: "failed",
            runAt: nowIso,
            retryCount: currentRetryCount + 1,
            errorMessage: message,
          });
        }

        await insertWebhookLogWithFallback({
          requestUrl: webhookConfig.target_url,
          requestMethod,
          requestHeaders,
          requestBody,
          responseStatus: null,
          responseBody: message,
          durationMs: Date.now() - requestStartAt,
          createdBy: isUuid(subscription.user_id) ? subscription.user_id : null,
        });

        markFailed(summary, "dispatch_failed");
      }
    } catch {
      markFailed(summary, "internal_error");
    }
  }

  return summary;
};
