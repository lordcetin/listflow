import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

type QueryError = { message?: string; code?: string | null };

type ConfigRow = {
  id: string;
  name: string;
  description: string | null;
  scope: string | null;
  target_url: string;
  method: string | null;
  enabled: boolean | null;
  product_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type LogRow = {
  id: string;
  request_url: string | null;
  request_method: string | null;
  response_status: number | null;
  duration_ms: number | null;
  response_body: string | null;
  created_at: string | null;
};

type TransitionRow = {
  id: string;
  store_id: string | null;
  subscription_id: string | null;
  from_webhook_config_id: string | null;
  to_webhook_config_id: string | null;
  month_index: number | null;
  status: string | null;
  trigger_response_status: number | null;
  trigger_response_body: string | null;
  created_by: string | null;
  created_at: string | null;
};

type JobRow = {
  id: string;
  subscription_id: string | null;
  user_id: string | null;
  store_id: string | null;
  store_name?: string | null;
  webhook_config_id: string | null;
  plan: string | null;
  trigger_type: string | null;
  status: string | null;
  idempotency_key: string | null;
  run_at: string | null;
  response_status: number | null;
  error_message: string | null;
  created_at: string | null;
};

type SubscriptionRefRow = {
  id: string;
  store_id?: string | null;
  shop_id?: string | null;
};

type ProductRow = {
  id: string;
  category_id: string | null;
  title_tr: string | null;
  title_en: string | null;
  title?: string | null;
};

type CategoryRow = {
  id: string;
  title_tr: string | null;
  title_en: string | null;
  slug: string | null;
};

const CRON_TICK_STALE_AFTER_MS = 90 * 1000;

const isMissingTable = (error: QueryError | null | undefined) => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || message.includes("could not find the table") || (message.includes("relation") && message.includes("does not exist"));
};

const isRecoverableSelect = (error: QueryError | null | undefined) => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("failed to parse select") ||
    message.includes("does not exist")
  );
};

const isMissingColumn = (error: QueryError | null | undefined, columnName: string) => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
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

const parseManualWebhookIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey || !idempotencyKey.startsWith("manual_switch:")) {
    return null;
  }

  const parts = idempotencyKey.split(":");
  return parts.length >= 4 ? parts[2] : null;
};

const parseActivationStoreIdFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey || !idempotencyKey.startsWith("activation:")) {
    return null;
  }

  const parts = idempotencyKey.split(":");
  return parts.length >= 4 ? parts[2] : null;
};

const parseTriggerTypeFromKey = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey) {
    return null;
  }

  if (idempotencyKey.startsWith("manual_switch:")) {
    return "manual_switch";
  }

  if (idempotencyKey.startsWith("activation:")) {
    return "activation";
  }

  if (idempotencyKey.startsWith("scheduled:")) {
    return "scheduled";
  }

  return null;
};

const resolveStoreIdFromJob = (job: Pick<JobRow, "store_id" | "idempotency_key">) => {
  return (
    job.store_id ??
    parseScheduledStoreIdFromKey(job.idempotency_key) ??
    parseManualStoreIdFromKey(job.idempotency_key) ??
    parseActivationStoreIdFromKey(job.idempotency_key) ??
    null
  );
};

const loadSubscriptionStoreMap = async () => {
  const withStoreId = await supabaseAdmin.from("subscriptions").select("id, store_id, shop_id").limit(5000);

  if (!withStoreId.error) {
    const map = new Map<string, string>();
    for (const row of (withStoreId.data ?? []) as SubscriptionRefRow[]) {
      const storeId = row.store_id ?? (row.shop_id && isUuid(row.shop_id) ? row.shop_id : null);
      if (storeId) {
        map.set(row.id, storeId);
      }
    }
    return map;
  }

  if (!isMissingColumn(withStoreId.error, "store_id")) {
    throw new Error(withStoreId.error.message || "subscriptions load failed");
  }

  const fallback = await supabaseAdmin.from("subscriptions").select("id, shop_id").limit(5000);
  if (fallback.error) {
    throw new Error(fallback.error.message || "subscriptions load failed");
  }

  const map = new Map<string, string>();
  for (const row of (fallback.data ?? []) as SubscriptionRefRow[]) {
    const storeId = row.shop_id && isUuid(row.shop_id) ? row.shop_id : null;
    if (storeId) {
      map.set(row.id, storeId);
    }
  }

  return map;
};

const loadStoreActiveWebhookMap = async (storeIds: string[]) => {
  if (!storeIds.length) {
    return {
      map: new Map<string, string>(),
      hasColumn: true,
    };
  }

  const withColumn = await supabaseAdmin.from("stores").select("id, active_webhook_config_id").in("id", storeIds);

  if (!withColumn.error) {
    const map = new Map<string, string>();
    for (const row of (withColumn.data ?? []) as Array<{ id: string; active_webhook_config_id: string | null }>) {
      if (row.active_webhook_config_id) {
        map.set(row.id, row.active_webhook_config_id);
      }
    }
    return { map, hasColumn: true };
  }

  if (!isMissingColumn(withColumn.error, "active_webhook_config_id")) {
    throw new Error(withColumn.error.message || "stores load failed");
  }

  const fallback = await supabaseAdmin.from("stores").select("id").in("id", storeIds);
  if (fallback.error) {
    throw new Error(fallback.error.message || "stores load failed");
  }

  return {
    map: new Map<string, string>(),
    hasColumn: false,
  };
};

const loadStoreNameMap = async (storeIds: string[]) => {
  if (!storeIds.length) {
    return new Map<string, string>();
  }

  const withStoreName = await supabaseAdmin.from("stores").select("id, store_name").in("id", storeIds);

  if (!withStoreName.error) {
    const map = new Map<string, string>();
    for (const row of (withStoreName.data ?? []) as Array<{ id: string; store_name: string | null }>) {
      if (row.store_name) {
        map.set(row.id, row.store_name);
      }
    }
    return map;
  }

  if (!isMissingColumn(withStoreName.error, "store_name")) {
    throw new Error(withStoreName.error.message || "stores name load failed");
  }

  const fallback = await supabaseAdmin.from("stores").select("id, name").in("id", storeIds);
  if (fallback.error) {
    throw new Error(fallback.error.message || "stores name load failed");
  }

  const map = new Map<string, string>();
  for (const row of (fallback.data ?? []) as Array<{ id: string; name: string | null }>) {
    if (row.name) {
      map.set(row.id, row.name);
    }
  }
  return map;
};

const loadStoreWebhookMappingsFromLogs = async (storeIds: string[]) => {
  if (!storeIds.length) {
    return new Map<string, string>();
  }

  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("request_body, request_url, created_at")
    .eq("request_method", "STORE_WEBHOOK_MAP")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return new Map<string, string>();
  }

  const storeSet = new Set(storeIds);
  const map = new Map<string, string>();

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

    if (!storeId || !webhookConfigId || !storeSet.has(storeId) || map.has(storeId)) {
      continue;
    }

    map.set(storeId, webhookConfigId);
  }

  return map;
};

const selectWithCandidates = async <T,>(
  table: string,
  candidates: readonly string[],
  orderBy?: { column: string; ascending?: boolean },
  limit = 200
): Promise<{ rows: T[]; missingTable?: boolean }> => {
  let lastError: QueryError | null = null;

  for (const select of candidates) {
    for (const useOrder of [true, false]) {
      let query = supabaseAdmin.from(table).select(select).limit(limit);

      if (orderBy && useOrder) {
        query = query.order(orderBy.column, { ascending: Boolean(orderBy.ascending) });
      }

      const { data, error } = await query;

      if (!error) {
        return { rows: (data ?? []) as T[] };
      }

      if (isMissingTable(error)) {
        return { rows: [], missingTable: true };
      }

      lastError = error;

      if (!isRecoverableSelect(error)) {
        break;
      }
    }
  }

  throw new Error(lastError?.message || `${table} load failed`);
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
    return;
  }

  try {
    await fetch(`${request.nextUrl.origin}/api/scheduler/tick`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "x-listflow-tick-source": "admin-webhooks-overview-fallback",
      },
    });
  } catch {
    // Cron fallback must never break the admin overview response.
  }
};

const ensureFreshCronTick = async (request: NextRequest) => {
  const latestTickMs = await loadLatestCronTickMs();
  const nowMs = Date.now();

  if (latestTickMs !== null && nowMs - latestTickMs <= CRON_TICK_STALE_AFTER_MS) {
    return;
  }

  await triggerTickWithCronSecret(request);
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  try {
    await ensureFreshCronTick(request);

    const [configsRes, logsRes, transitionsRes, jobsRes, productsRes, categoriesRes] = await Promise.all([
      selectWithCandidates<ConfigRow>(
        "webhook_configs",
        [
          "id,name,description,scope,target_url,method,enabled,product_id,created_at,updated_at",
          "id,name,scope,target_url,method,enabled,product_id,created_at,updated_at",
          "id,name,description,scope,target_url,method,enabled,created_at,updated_at",
          "id,name,scope,target_url,method,enabled,created_at,updated_at",
          "id,name,target_url,method,enabled,created_at,updated_at",
        ],
        { column: "updated_at", ascending: false },
        500
      ),
      selectWithCandidates<LogRow>(
        "webhook_logs",
        [
          "id,request_url,request_method,response_status,duration_ms,response_body,created_at",
          "id,request_url,request_method,response_status,duration_ms,created_at",
        ],
        { column: "created_at", ascending: false },
        500
      ),
      selectWithCandidates<TransitionRow>(
        "store_automation_transitions",
        [
          "id,store_id,subscription_id,from_webhook_config_id,to_webhook_config_id,month_index,status,trigger_response_status,trigger_response_body,created_by,created_at",
          "id,store_id,subscription_id,from_webhook_config_id,to_webhook_config_id,month_index,status,created_by,created_at",
        ],
        { column: "created_at", ascending: false },
        500
      ),
      selectWithCandidates<JobRow>(
        "scheduler_jobs",
        [
          "id,subscription_id,user_id,store_id,webhook_config_id,plan,trigger_type,status,idempotency_key,run_at,response_status,error_message,created_at",
          "id,subscription_id,user_id,plan,status,idempotency_key,run_at,response_status,error_message,created_at",
          "id,subscription_id,user_id,plan,status,idempotency_key,run_at,created_at",
        ],
        { column: "run_at", ascending: false },
        500
      ),
      selectWithCandidates<ProductRow>(
        "products",
        ["id,category_id,title_tr,title_en", "id,category_id,title_tr", "id,category_id,title"],
        { column: "created_at", ascending: false },
        2000
      ),
      selectWithCandidates<CategoryRow>(
        "categories",
        ["id,title_tr,title_en,slug", "id,title_tr,slug", "id,name,slug"],
        { column: "created_at", ascending: false },
        500
      ),
    ]);

    const categoriesById = new Map(
      categoriesRes.rows.map((row) => [
        row.id,
        {
          titleTr: row.title_tr ?? row.slug ?? row.id,
          titleEn: row.title_en ?? row.title_tr ?? row.slug ?? row.id,
        },
      ])
    );

    const products = productsRes.rows.map((row) => {
      const category = row.category_id ? categoriesById.get(row.category_id) : null;
      const titleTr = row.title_tr ?? row.title ?? row.id;
      const titleEn = row.title_en ?? titleTr;
      const categoryTitleTr = category?.titleTr ?? null;
      const categoryTitleEn = category?.titleEn ?? null;
      const labelTr = categoryTitleTr ? `${categoryTitleTr} / ${titleTr}` : titleTr;
      const labelEn = categoryTitleEn ? `${categoryTitleEn} / ${titleEn}` : titleEn;

      return {
        id: row.id,
        categoryId: row.category_id,
        categoryTitleTr,
        categoryTitleEn,
        titleTr,
        titleEn,
        labelTr,
        labelEn,
      };
    });

    const storeIdBySubscriptionId = await loadSubscriptionStoreMap();

    const rawJobs = jobsRes.rows.map((job) => ({
      id: job.id,
      subscription_id: job.subscription_id ?? null,
      user_id: job.user_id ?? null,
      store_id: job.store_id ?? null,
      webhook_config_id: job.webhook_config_id ?? null,
      plan: job.plan ?? null,
      trigger_type: job.trigger_type ?? null,
      status: job.status ?? null,
      idempotency_key: job.idempotency_key ?? null,
      run_at: job.run_at ?? null,
      response_status: job.response_status ?? null,
      error_message: job.error_message ?? null,
      created_at: job.created_at ?? null,
    })) as JobRow[];

    const derivedStoreIds = Array.from(
      new Set(
        rawJobs
          .map((job) => {
            const bySubscription = job.subscription_id ? storeIdBySubscriptionId.get(job.subscription_id) ?? null : null;
            return resolveStoreIdFromJob({ store_id: job.store_id ?? bySubscription, idempotency_key: job.idempotency_key });
          })
          .filter((value): value is string => Boolean(value))
      )
    );

    const [{ map: activeWebhookByStore, hasColumn: hasActiveWebhookColumn }, storeNameById] = await Promise.all([
      loadStoreActiveWebhookMap(derivedStoreIds),
      loadStoreNameMap(derivedStoreIds),
    ]);
    const mappedWebhookByStore = hasActiveWebhookColumn
      ? new Map<string, string>()
      : await loadStoreWebhookMappingsFromLogs(derivedStoreIds);

    const jobs = rawJobs.map((job) => {
      const fallbackStoreBySubscription = job.subscription_id ? storeIdBySubscriptionId.get(job.subscription_id) ?? null : null;
      const resolvedStoreId =
        resolveStoreIdFromJob(
          {
            store_id: job.store_id ?? fallbackStoreBySubscription,
            idempotency_key: job.idempotency_key,
          }
        ) ?? null;

      const parsedTriggerType = parseTriggerTypeFromKey(job.idempotency_key);
      const resolvedTriggerType = (job.trigger_type ?? parsedTriggerType ?? "scheduled").toLowerCase();

      const resolvedWebhookConfigId =
        job.webhook_config_id ??
        parseManualWebhookIdFromKey(job.idempotency_key) ??
        (resolvedStoreId ? activeWebhookByStore.get(resolvedStoreId) ?? mappedWebhookByStore.get(resolvedStoreId) ?? null : null);

      return {
        ...job,
        store_id: resolvedStoreId,
        store_name: resolvedStoreId ? storeNameById.get(resolvedStoreId) ?? null : null,
        webhook_config_id: resolvedWebhookConfigId,
        trigger_type: resolvedTriggerType,
      };
    });

    const derivedManualTransitions = jobs
      .filter((job) => job.trigger_type === "manual_switch" && Boolean(job.store_id))
      .map((job) => ({
        id: `job-${job.id}`,
        store_id: job.store_id,
        subscription_id: job.subscription_id,
        from_webhook_config_id: null,
        to_webhook_config_id: job.webhook_config_id,
        month_index: null,
        status: job.status,
        trigger_response_status: job.response_status,
        trigger_response_body: job.error_message,
        created_by: null,
        created_at: job.run_at ?? job.created_at,
      }));

    const transitions =
      transitionsRes.missingTable || transitionsRes.rows.length === 0
        ? derivedManualTransitions
        : transitionsRes.rows;

    return NextResponse.json({
      configs: configsRes.rows,
      logs: logsRes.rows,
      transitions,
      jobs,
      products,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook overview could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
