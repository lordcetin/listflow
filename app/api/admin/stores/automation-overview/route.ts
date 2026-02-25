import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { getSubscriptionMonthIndex } from "@/lib/admin/automation";
import {
  createScheduledSlotIdempotencyKey,
  extractScheduledSlotDueIso,
  getPlanWindowHours,
} from "@/lib/scheduler/idempotency";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";
import { loadWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";

type StoreRow = {
  id: string;
  user_id: string;
  store_name: string;
  status: string | null;
  category: string | null;
  product_id: string | null;
  active_webhook_config_id: string | null;
  automation_updated_at: string | null;
};

type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
};

type SubscriptionRow = {
  id: string;
  user_id: string | null;
  store_id?: string | null;
  shop_id?: string | null;
  plan: string | null;
  status: string | null;
  created_at: string | null;
  current_period_end: string | null;
  updated_at: string | null;
};

type SchedulerJobRow = {
  id: string;
  store_id: string | null;
  subscription_id: string | null;
  webhook_config_id: string | null;
  idempotency_key: string | null;
  status: string | null;
  trigger_type: string | null;
  response_status: number | null;
  error_message: string | null;
  run_at: string | null;
  updated_at: string | null;
  retry_count: number | null;
  created_at: string | null;
};

type WebhookConfigRow = {
  id: string;
  name: string;
  description: string | null;
  target_url: string;
  method: string | null;
  enabled: boolean | null;
  product_id: string | null;
  scope?: string | null;
};

type ProductRow = {
  id: string;
  category_id: string | null;
  title_tr: string | null;
  title_en: string | null;
};

type CategoryRow = {
  id: string;
  title_tr: string | null;
  title_en: string | null;
  slug: string | null;
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

const loadStores = async () => {
  const candidates = [
    {
      select: "id, user_id, store_name, status, category, product_id, active_webhook_config_id, automation_updated_at",
      hasProductColumn: true,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: true,
    },
    {
      select: "id, user_id, store_name, status, category, product_id, active_webhook_config_id",
      hasProductColumn: true,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: false,
    },
    {
      select: "id, user_id, store_name, status, category, active_webhook_config_id, automation_updated_at",
      hasProductColumn: false,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: true,
    },
    {
      select: "id, user_id, store_name, status, category, active_webhook_config_id",
      hasProductColumn: false,
      hasActiveWebhookColumn: true,
      hasAutomationUpdatedAtColumn: false,
    },
    {
      select: "id, user_id, store_name, status, category, product_id",
      hasProductColumn: true,
      hasActiveWebhookColumn: false,
      hasAutomationUpdatedAtColumn: false,
    },
    {
      select: "id, user_id, store_name, status, category",
      hasProductColumn: false,
      hasActiveWebhookColumn: false,
      hasAutomationUpdatedAtColumn: false,
    },
  ] as const;

  let lastErrorMessage = "stores could not be loaded";

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(candidate.select)
      .order("created_at", { ascending: true });

    if (!query.error) {
      const rows = ((query.data ?? []) as unknown as Array<{
        id: string;
        user_id: string;
        store_name: string;
        status?: string | null;
        category?: string | null;
        product_id?: string | null;
        active_webhook_config_id?: string | null;
        automation_updated_at?: string | null;
      }>).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        store_name: row.store_name,
        status: row.status ?? null,
        category: row.category ?? null,
        product_id: candidate.hasProductColumn ? row.product_id ?? null : null,
        active_webhook_config_id: candidate.hasActiveWebhookColumn ? row.active_webhook_config_id ?? null : null,
        automation_updated_at: candidate.hasAutomationUpdatedAtColumn ? row.automation_updated_at ?? null : null,
      })) as StoreRow[];

      return {
        rows,
        hasActiveWebhookColumn: candidate.hasActiveWebhookColumn,
      };
    }

    lastErrorMessage = query.error.message;

    if (!isMissingAnyColumnError(query.error, ["product_id", "active_webhook_config_id", "automation_updated_at"])) {
      throw new Error(query.error.message);
    }
  }

  throw new Error(lastErrorMessage);
};

const loadProfiles = async (userIds: string[]) => {
  if (!userIds.length) {
    return [] as ProfileRow[];
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, email, full_name")
    .in("user_id", userIds);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ProfileRow[];
};

const loadSubscriptions = async () => {
  const withStoreId = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, store_id, shop_id, plan, status, created_at, current_period_end, updated_at")
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false });

  if (!withStoreId.error) {
    return (withStoreId.data ?? []) as SubscriptionRow[];
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw new Error(withStoreId.error.message);
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, shop_id, plan, status, created_at, current_period_end, updated_at")
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false });

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return ((fallback.data ?? []) as SubscriptionRow[]).map((row) => ({
    ...row,
    store_id: isUuid(row.shop_id) ? row.shop_id : null,
  }));
};

const loadSchedulerJobs = async () => {
  const candidates = [
    "id, store_id, subscription_id, webhook_config_id, idempotency_key, status, trigger_type, response_status, error_message, run_at, updated_at, retry_count, created_at",
    "id, store_id, subscription_id, webhook_config_id, idempotency_key, status, trigger_type, response_status, error_message, run_at, updated_at, created_at",
    "id, store_id, subscription_id, webhook_config_id, idempotency_key, status, response_status, error_message, run_at, updated_at, created_at",
    "id, subscription_id, idempotency_key, status, response_status, error_message, run_at, updated_at, created_at",
    "id, subscription_id, idempotency_key, status, run_at, created_at",
  ] as const;

  let lastError: string | null = null;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin
      .from("scheduler_jobs")
      .select(select)
      .order("run_at", { ascending: false })
      .limit(1000);

    if (!error) {
      const rows = ((data ?? []) as unknown) as Array<{
        id: string;
        store_id?: string | null;
        subscription_id?: string | null;
        webhook_config_id?: string | null;
        idempotency_key?: string | null;
        status?: string | null;
        trigger_type?: string | null;
        response_status?: number | null;
        error_message?: string | null;
        run_at?: string | null;
        updated_at?: string | null;
        retry_count?: number | null;
        created_at?: string | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        store_id: row.store_id ?? null,
        subscription_id: row.subscription_id ?? null,
        webhook_config_id: row.webhook_config_id ?? null,
        idempotency_key: row.idempotency_key ?? null,
        status: row.status ?? null,
        trigger_type: row.trigger_type ?? null,
        response_status: row.response_status ?? null,
        error_message: row.error_message ?? null,
        run_at: row.run_at ?? null,
        updated_at: row.updated_at ?? null,
        retry_count: row.retry_count ?? null,
        created_at: row.created_at ?? null,
      })) as SchedulerJobRow[];
    }

    if (
      !isMissingAnyColumnError(error, [
        "store_id",
        "subscription_id",
        "webhook_config_id",
        "idempotency_key",
        "trigger_type",
        "response_status",
        "error_message",
        "updated_at",
        "retry_count",
      ])
    ) {
      throw new Error(error.message);
    }

    lastError = error.message;
  }

  throw new Error(lastError ?? "scheduler_jobs could not be loaded");
};

const loadAutomationWebhooks = async () => {
  const candidates = [
    "id, name, description, target_url, method, enabled, scope, product_id",
    "id, name, target_url, method, enabled, scope, product_id",
    "id, name, description, target_url, method, enabled, scope",
    "id, name, target_url, method, enabled, scope",
    "id, name, description, target_url, method, enabled",
    "id, name, target_url, method, enabled",
  ] as const;

  let lastError: string | null = null;

  for (const select of candidates) {
    const hasScope = select.includes("scope");
    const query = supabaseAdmin
      .from("webhook_configs")
      .select(select)
      .eq("enabled", true)
      .order("name", { ascending: true });

    const scopedQuery = hasScope ? query.or("scope.eq.automation,scope.is.null") : query;
    const { data, error } = await scopedQuery;

    if (!error) {
      const rows = ((data ?? []) as unknown) as Array<{
        id: string;
        name: string;
        target_url: string;
        method: string | null;
        enabled: boolean | null;
        scope?: string | null;
        description?: string | null;
        product_id?: string | null;
      }>;

      const webhookProductMap = await loadWebhookConfigProductMap(rows.map((row) => row.id));

      return rows
        .map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description ?? null,
          target_url: row.target_url,
          method: row.method ?? "POST",
          enabled: row.enabled ?? true,
          scope: row.scope ?? "automation",
          product_id: row.product_id ?? webhookProductMap.get(row.id) ?? null,
        }))
        .filter((row) => !hasScope || row.scope === "automation" || row.scope === null);
    }

    lastError = error.message;
  }

  throw new Error(lastError ?? "webhook_configs could not be loaded");
};

const loadProducts = async () => {
  const candidates = [
    "id, category_id, title_tr, title_en",
    "id, category_id, title_tr",
    "id, category_id, title",
  ] as const;

  let lastError: string | null = null;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (!error) {
      const rows = ((data ?? []) as unknown) as Array<{
        id: string;
        category_id?: string | null;
        title_tr?: string | null;
        title_en?: string | null;
        title?: string | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        category_id: row.category_id ?? null,
        title_tr: row.title_tr ?? row.title ?? null,
        title_en: row.title_en ?? row.title_tr ?? row.title ?? null,
      })) as ProductRow[];
    }

    if (!isMissingAnyColumnError(error, ["category_id", "title_tr", "title_en", "title"])) {
      throw new Error(error.message);
    }

    lastError = error.message;
  }

  throw new Error(lastError ?? "products could not be loaded");
};

const loadCategories = async () => {
  const candidates = [
    "id, title_tr, title_en, slug",
    "id, title_tr, slug",
    "id, name, slug",
  ] as const;

  let lastError: string | null = null;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin
      .from("categories")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(500);

    if (!error) {
      const rows = ((data ?? []) as unknown) as Array<{
        id: string;
        title_tr?: string | null;
        title_en?: string | null;
        name?: string | null;
        slug?: string | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        title_tr: row.title_tr ?? row.name ?? row.slug ?? row.id,
        title_en: row.title_en ?? row.title_tr ?? row.name ?? row.slug ?? row.id,
        slug: row.slug ?? null,
      })) as CategoryRow[];
    }

    if (!isMissingAnyColumnError(error, ["title_tr", "title_en", "name", "slug"])) {
      throw new Error(error.message);
    }

    lastError = error.message;
  }

  throw new Error(lastError ?? "categories could not be loaded");
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

const getJobTimestamp = (job: SchedulerJobRow) => {
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

const getMostRecentCadenceSuccessAt = (jobs: SchedulerJobRow[]) => {
  for (const job of jobs) {
    if ((job.status ?? "").toLowerCase() !== "success") {
      continue;
    }

    if (!(isScheduledJob(job) || isManualSwitchJob(job) || isActivationJob(job))) {
      continue;
    }

    const candidates = [job.run_at, job.updated_at, job.created_at];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }

  return null;
};

const getLatestScheduledSlotDueMs = (jobs: SchedulerJobRow[]) => {
  let latest = -1;

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

    if (slotDueMs > latest) {
      latest = slotDueMs;
    }
  }

  return latest >= 0 ? latest : null;
};

const findScheduledSlotJob = (jobs: SchedulerJobRow[], storeId: string, slotKey: string) => {
  for (const job of jobs) {
    if (!isScheduledJob(job)) {
      continue;
    }

    if ((resolveStoreIdForJob(job) ?? storeId) !== storeId) {
      continue;
    }

    if (job.idempotency_key === slotKey) {
      return job;
    }
  }

  return null;
};

const getRetryDelayMinutes = (retryCount: number) => {
  if (retryCount <= 0) {
    return 1;
  }

  const retrySchedule = [1, 2, 4, 8, 16] as const;
  return retrySchedule[Math.min(retryCount - 1, retrySchedule.length - 1)];
};

const computeNextTriggerAt = (args: {
  subscriptionId: string | null | undefined;
  storeId: string;
  plan: string | null | undefined;
  jobs: SchedulerJobRow[];
  nowMs: number;
}) => {
  if (!args.plan) {
    return {
      cadenceHours: null as number | null,
      nextTriggerAt: null as string | null,
      lastCadenceSuccessAt: null as string | null,
    };
  }

  const cadenceHours = getPlanWindowHours(args.plan);
  const cadenceMs = cadenceHours * 60 * 60 * 1000;
  const lastCadenceSuccessAt = getMostRecentCadenceSuccessAt(args.jobs);
  const latestScheduledSlotDueMs = getLatestScheduledSlotDueMs(args.jobs);

  let slotDueMs = (() => {
    if (lastCadenceSuccessAt) {
      return new Date(lastCadenceSuccessAt).getTime() + cadenceMs;
    }

    if (latestScheduledSlotDueMs !== null) {
      return latestScheduledSlotDueMs;
    }

    return args.nowMs;
  })();

  if (args.subscriptionId) {
    let slotDueIso = new Date(slotDueMs).toISOString();
    let slotKey = createScheduledSlotIdempotencyKey({
      subscriptionId: args.subscriptionId,
      storeId: args.storeId,
      plan: args.plan,
      slotDueAtIso: slotDueIso,
    });
    let slotJob = findScheduledSlotJob(args.jobs, args.storeId, slotKey);

    while (
      slotJob &&
      (slotJob.status ?? "").toLowerCase() === "failed" &&
      (slotJob.retry_count ?? 0) >= 5
    ) {
      slotDueMs += cadenceMs;
      slotDueIso = new Date(slotDueMs).toISOString();
      slotKey = createScheduledSlotIdempotencyKey({
        subscriptionId: args.subscriptionId,
        storeId: args.storeId,
        plan: args.plan,
        slotDueAtIso: slotDueIso,
      });
      slotJob = findScheduledSlotJob(args.jobs, args.storeId, slotKey);
    }

    if (slotJob && (slotJob.status ?? "").toLowerCase() === "failed") {
      const retryCount = slotJob.retry_count ?? 0;
      if (retryCount < 5) {
        slotDueMs = getJobTimestamp(slotJob) + getRetryDelayMinutes(retryCount) * 60 * 1000;
      } else {
        slotDueMs += cadenceMs;
      }
    }
  }

  return {
    cadenceHours,
    nextTriggerAt: new Date(slotDueMs).toISOString(),
    lastCadenceSuccessAt,
  };
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const [
      { rows: stores },
      subscriptions,
      webhooks,
      schedulerJobs,
      products,
      categories,
    ] = await Promise.all([
      loadStores(),
      loadSubscriptions(),
      loadAutomationWebhooks(),
      loadSchedulerJobs(),
      loadProducts(),
      loadCategories(),
    ]);

    const storeWebhookMappingFallback = await loadStoreWebhookMappingsFromLogs(stores.map((store) => store.id));

    const userIds = Array.from(new Set(stores.map((store) => store.user_id)));
    const profiles = await loadProfiles(userIds);

    const profileByUserId = new Map<string, ProfileRow>(profiles.map((profile) => [profile.user_id, profile]));
    const categoriesById = new Map(
      categories.map((category) => [category.id, { tr: category.title_tr, en: category.title_en }])
    );
    const productsById = new Map(
      products.map((product) => {
        const category = product.category_id ? categoriesById.get(product.category_id) : null;
        const labelTr = [category?.tr, product.title_tr].filter(Boolean).join(" / ");
        const labelEn = [category?.en, product.title_en].filter(Boolean).join(" / ");
        return [
          product.id,
          {
            ...product,
            labelTr: labelTr || product.title_tr || product.id,
            labelEn: labelEn || product.title_en || product.title_tr || product.id,
          },
        ];
      })
    );
    const subscriptionByStoreId = new Map<string, SubscriptionRow>();
    const storeIdBySubscriptionId = new Map<string, string>();
    const latestJobByStoreId = new Map<string, SchedulerJobRow>();
    const jobsByStoreId = new Map<string, SchedulerJobRow[]>();
    const webhookById = new Map<string, WebhookConfigRow>(webhooks.map((webhook) => [webhook.id, webhook]));
    const activeWebhookIds = new Set(webhooks.map((webhook) => webhook.id));
    const nowMs = Date.now();

    for (const subscription of subscriptions) {
      const resolvedStoreId = subscription.store_id ?? (subscription.shop_id && isUuid(subscription.shop_id) ? subscription.shop_id : null);
      if (!resolvedStoreId) {
        continue;
      }

      storeIdBySubscriptionId.set(subscription.id, resolvedStoreId);

      if (!subscriptionByStoreId.has(resolvedStoreId)) {
        subscriptionByStoreId.set(resolvedStoreId, subscription);
      }
    }

    for (const job of schedulerJobs) {
      const resolvedStoreId =
        resolveStoreIdForJob(job) ??
        (job.subscription_id ? storeIdBySubscriptionId.get(job.subscription_id) ?? null : null);

      if (!resolvedStoreId) {
        continue;
      }

      if (!jobsByStoreId.has(resolvedStoreId)) {
        jobsByStoreId.set(resolvedStoreId, []);
      }
      jobsByStoreId.get(resolvedStoreId)?.push(job);

      if (!latestJobByStoreId.has(resolvedStoreId)) {
        latestJobByStoreId.set(resolvedStoreId, job);
      }
    }

    for (const jobs of jobsByStoreId.values()) {
      jobs.sort((a, b) => getJobTimestamp(b) - getJobTimestamp(a));
    }

    const resolveStoreWebhookId = (store: StoreRow) => {
      const explicitId = store.active_webhook_config_id;
      if (explicitId && activeWebhookIds.has(explicitId)) {
        return explicitId;
      }

      const fallbackCandidates = storeWebhookMappingFallback.get(store.id) ?? [];
      for (const candidateId of fallbackCandidates) {
        if (activeWebhookIds.has(candidateId)) {
          return candidateId;
        }
      }

      return null;
    };

    const rows = stores.map((store) => {
      const profile = profileByUserId.get(store.user_id);
      const activeSubscription = subscriptionByStoreId.get(store.id) ?? null;
      const monthIndex = getSubscriptionMonthIndex(activeSubscription?.created_at ?? null);
      const canSwitch = Boolean(activeSubscription);
      const lastJob = latestJobByStoreId.get(store.id) ?? null;
      const storeJobs = jobsByStoreId.get(store.id) ?? [];
      const activeWebhookConfigId = resolveStoreWebhookId(store);
      const activeWebhook = activeWebhookConfigId ? webhookById.get(activeWebhookConfigId) ?? null : null;
      const storeProduct = store.product_id ? productsById.get(store.product_id) : null;
      const hasStoreBoundProduct = Boolean(store.product_id);
      const unboundWebhooks = webhooks.filter((webhook) => !webhook.product_id);
      const productBoundWebhooks = webhooks.filter((webhook) => Boolean(webhook.product_id));
      const exactProductWebhooks = hasStoreBoundProduct
        ? productBoundWebhooks.filter((webhook) => webhook.product_id === store.product_id)
        : [];
      const eligibleWebhooks = exactProductWebhooks.length
        ? [...exactProductWebhooks, ...unboundWebhooks]
        : webhooks;
      const eligibleWebhookConfigIds = eligibleWebhooks.map((webhook) => webhook.id);
      const scheduleState = computeNextTriggerAt({
        subscriptionId: activeSubscription?.id,
        storeId: store.id,
        plan: activeSubscription?.plan,
        jobs: storeJobs,
        nowMs,
      });

      return {
        storeId: store.id,
        storeName: store.store_name,
        storeStatus: store.status ?? "pending",
        category: store.category,
        userId: store.user_id,
        userLabel:
          profile?.full_name?.trim() ||
          profile?.email?.trim() ||
          `${store.user_id.slice(0, 8)}...`,
        productId: store.product_id,
        productLabel: storeProduct?.labelTr ?? null,
        eligibleWebhookConfigIds,
        subscriptionId: activeSubscription?.id ?? null,
        subscriptionStatus: activeSubscription?.status ?? null,
        plan: activeSubscription?.plan ?? null,
        currentPeriodEnd: activeSubscription?.current_period_end ?? null,
        monthIndex,
        canSwitch,
        minMonthRequired: 1,
        eligibilityReason: !activeSubscription ? "active_subscription_required" : null,
        activeWebhookConfigId,
        activeWebhookName: activeWebhook?.name ?? null,
        automationUpdatedAt: store.automation_updated_at,
        cadenceHours: scheduleState.cadenceHours,
        nextTriggerAt: scheduleState.nextTriggerAt,
        lastCadenceSuccessAt: scheduleState.lastCadenceSuccessAt,
        lastTrigger: lastJob
          ? {
              status: lastJob.status,
              triggerType: lastJob.trigger_type,
              responseStatus: lastJob.response_status,
              errorMessage: lastJob.error_message,
              createdAt: lastJob.run_at ?? lastJob.created_at,
              webhookConfigId: lastJob.webhook_config_id,
            }
          : null,
      };
    });

    return NextResponse.json({
      rows,
      webhookOptions: webhooks.map((webhook) => ({
        id: webhook.id,
        name: webhook.name,
        description: webhook.description,
        targetUrl: webhook.target_url,
        method: webhook.method,
        enabled: webhook.enabled ?? true,
        productId: webhook.product_id,
        productLabel: webhook.product_id ? productsById.get(webhook.product_id)?.labelTr ?? null : null,
      })),
      products: Array.from(productsById.values()).map((item) => ({
        id: item.id,
        categoryId: item.category_id,
        titleTr: item.title_tr,
        titleEn: item.title_en,
        labelTr: item.labelTr,
        labelEn: item.labelEn,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation overview could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
