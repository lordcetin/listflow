import { serverEnv } from "@/lib/env/server";
import { getPlanWindowHours } from "@/lib/scheduler/idempotency";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePublicSiteUrl } from "@/lib/url/public-site";

const CRON_JOB_ORG_BASE_URL = "https://api.cron-job.org";
const LISTFLOW_SCHEDULER_TITLE = "Listflow Scheduler Tick";
const LISTFLOW_AUTOMATION_TITLE_PREFIX = "Listflow Automation::";
const CRON_TEST_NAME_PREFIX = "CRON_TEST_2M::";
const GET_REQUEST_METHOD = 0;
const POST_REQUEST_METHOD = 1;
const DEFAULT_AUTOMATION_MODE = "direct";

type CronJobSchedule = {
  timezone: string;
  expiresAt: number;
  hours: number[];
  mdays: number[];
  minutes: number[];
  months: number[];
  wdays: number[];
};

type CronJobExtendedData = {
  headers?: Record<string, string>;
  body?: string;
};

type CronJobPayload = {
  enabled: boolean;
  title: string;
  saveResponses: boolean;
  url: string;
  redirectSuccess: boolean;
  requestMethod: number;
  schedule: CronJobSchedule;
  extendedData: CronJobExtendedData;
};

type CronJobSummary = {
  jobId: number;
  enabled?: boolean;
  title?: string;
  url?: string;
  lastStatus?: number;
  lastDuration?: number;
  lastExecution?: number;
  nextExecution?: number;
  requestMethod?: number;
  schedule?: CronJobSchedule;
};

type CronJobListItem = CronJobSummary;

type CronJobListResponse = {
  jobs?: CronJobSummary[];
  someFailed?: boolean;
};

type CronJobCreateResponse = {
  jobId?: number;
};

export type SchedulerCronSyncResult =
  | {
      ok: true;
      status: "created" | "updated" | "deleted" | "noop";
      jobId?: number;
      message: string;
    }
  | {
      ok: false;
      status: "skipped" | "error";
      message: string;
      details?: string;
    };

type DirectAutomationSyncResult =
  | {
      ok: true;
      created: number;
      updated: number;
      deleted: number;
      desired: number;
      existingManaged: number;
      message: string;
    }
  | {
      ok: false;
      message: string;
      details?: string;
    };

type ActiveSubscriptionRow = {
  id: string;
  plan: string | null;
  status: string | null;
  current_period_end?: string | null;
  store_id?: string | null;
  shop_id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type StoreBindingRow = {
  id: string;
  active_webhook_config_id?: string | null;
  automation_updated_at?: string | null;
};

type WebhookConfigRow = {
  id: string;
  target_url: string;
  method?: string | null;
  headers?: Record<string, unknown> | null;
  enabled?: boolean | null;
  scope?: string | null;
};

type MappingSnapshot = {
  webhookConfigId: string;
  mappedAt: string | null;
};

export type DirectAutomationCronJob = {
  jobId: number;
  enabled: boolean;
  title: string;
  url: string;
  requestMethod: number;
  lastStatus: number | null;
  lastDuration: number | null;
  lastExecution: number | null;
  nextExecution: number | null;
  schedule: CronJobSchedule | null;
  subscriptionId: string | null;
  storeId: string | null;
  webhookConfigId: string | null;
  plan: string | null;
};

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

const resolveSchedulerBaseUrl = () => {
  const raw = serverEnv.CRON_SCHEDULER_BASE_URL;
  if (raw && raw.trim()) {
    return stripTrailingSlashes(raw);
  }

  return stripTrailingSlashes(resolvePublicSiteUrl());
};

const schedulerTickUrl = () => `${resolveSchedulerBaseUrl()}/api/scheduler/tick`;

const createSchedule = (): CronJobSchedule => ({
  timezone: "UTC",
  expiresAt: 0,
  hours: [-1],
  mdays: [-1],
  minutes: [-1],
  months: [-1],
  wdays: [-1],
});

const createSchedulerJobPayload = (): CronJobPayload => ({
  enabled: true,
  title: LISTFLOW_SCHEDULER_TITLE,
  saveResponses: true,
  url: schedulerTickUrl(),
  redirectSuccess: true,
  requestMethod: POST_REQUEST_METHOD,
  schedule: createSchedule(),
  extendedData: {
    headers: {
      Authorization: `Bearer ${serverEnv.CRON_SECRET}`,
      "Content-Type": "application/json",
    },
  },
});

const isPositiveInteger = (value: string | null) => {
  if (!value) {
    return false;
  }

  return /^\d+$/.test(value.trim());
};

const resolveConfiguredJobId = () => {
  const raw = serverEnv.CRON_JOB_ORG_JOB_ID;
  if (!isPositiveInteger(raw)) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveCronApiKey = () => {
  return serverEnv.CRON_JOB_ORG_API_KEY ?? serverEnv.CRON_SECRET;
};

const normalizeHeaders = (headers: Record<string, unknown> | null | undefined) => {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return {} as Record<string, string>;
  }

  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(headers)) {
    if (!key.trim()) {
      continue;
    }

    if (typeof raw === "string") {
      next[key] = raw;
      continue;
    }

    if (typeof raw === "number" || typeof raw === "boolean") {
      next[key] = String(raw);
    }
  }

  return next;
};

const toTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const isSubscriptionEligible = (subscription: ActiveSubscriptionRow, nowMs: number) => {
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

const getStoreIdFromSubscription = (subscription: ActiveSubscriptionRow) => {
  return subscription.store_id ?? subscription.shop_id ?? null;
};

const getAutomationMode = () => {
  const raw = process.env.AUTOMATION_DISPATCH_MODE?.trim().toLowerCase();
  return raw || DEFAULT_AUTOMATION_MODE;
};

export const isDirectAutomationMode = () => getAutomationMode() === "direct";

const isMissingColumnError = (error: { message?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isMissingTableError = (error: { code?: string | null; message?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    message.includes("could not find the table") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
};

const parseCronJobApiError = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(text) as { error?: string; message?: string; code?: number };
    return data.error || data.message || `HTTP ${response.status}`;
  } catch {
    return text;
  }
};

const callCronJobOrgApi = async <T>(args: {
  method: "GET" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  apiKey: string;
}) => {
  const response = await fetch(`${CRON_JOB_ORG_BASE_URL}${args.path}`, {
    method: args.method,
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });

  if (!response.ok) {
    const message = await parseCronJobApiError(response);
    throw new Error(message);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
};

const buildAnchoredHours = (intervalHours: number, anchorHour: number) => {
  const safeInterval = intervalHours >= 1 ? intervalHours : 8;
  const safeHour = ((anchorHour % 24) + 24) % 24;
  const remainder = safeHour % safeInterval;
  const hours: number[] = [];

  for (let hour = remainder; hour < 24; hour += safeInterval) {
    hours.push(hour);
  }

  return hours.length ? hours : [safeHour];
};

const createAutomationSchedule = (plan: string | null | undefined, anchorIso: string) => {
  const intervalHours = getPlanWindowHours(plan ?? "standard");
  const anchor = new Date(anchorIso);
  const hour = Number.isNaN(anchor.getTime()) ? 0 : anchor.getUTCHours();
  const minute = Number.isNaN(anchor.getTime()) ? 0 : anchor.getUTCMinutes();

  return {
    timezone: "UTC",
    expiresAt: 0,
    hours: buildAnchoredHours(intervalHours, hour),
    mdays: [-1],
    minutes: [minute],
    months: [-1],
    wdays: [-1],
  } satisfies CronJobSchedule;
};

const buildAutomationTitle = (args: {
  subscriptionId: string;
  storeId: string;
  webhookConfigId: string;
  plan: string;
}) =>
  `${LISTFLOW_AUTOMATION_TITLE_PREFIX}${args.subscriptionId}::${args.storeId}::${args.webhookConfigId}::${args.plan.toLowerCase()}`;

const isAutomationManagedTitle = (title: string | null | undefined) =>
  Boolean(title && title.startsWith(LISTFLOW_AUTOMATION_TITLE_PREFIX));

const parseAutomationTitle = (title: string | null | undefined) => {
  if (!title || !title.startsWith(LISTFLOW_AUTOMATION_TITLE_PREFIX)) {
    return {
      subscriptionId: null,
      storeId: null,
      webhookConfigId: null,
      plan: null,
    };
  }

  const raw = title.slice(LISTFLOW_AUTOMATION_TITLE_PREFIX.length);
  const parts = raw.split("::");

  return {
    subscriptionId: parts[0] ?? null,
    storeId: parts[1] ?? null,
    webhookConfigId: parts[2] ?? null,
    plan: parts[3] ?? null,
  };
};

const loadActiveSubscriptions = async () => {
  const withStoreId = await supabaseAdmin
    .from("subscriptions")
    .select("id, plan, status, current_period_end, store_id, shop_id, updated_at, created_at")
    .in("status", ["active", "trialing"])
    .limit(5000);

  if (!withStoreId.error) {
    return (withStoreId.data ?? []) as ActiveSubscriptionRow[];
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw withStoreId.error;
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .select("id, plan, status, current_period_end, shop_id, updated_at, created_at")
    .in("status", ["active", "trialing"])
    .limit(5000);

  if (fallback.error) {
    throw fallback.error;
  }

  return ((fallback.data ?? []) as ActiveSubscriptionRow[]).map((row) => ({
    ...row,
    store_id: row.shop_id ?? null,
  }));
};

const loadStoreBindings = async (storeIds: string[]) => {
  if (!storeIds.length) {
    return new Map<string, StoreBindingRow>();
  }

  const candidates = [
    { select: "id,active_webhook_config_id,automation_updated_at", hasWebhookColumn: true, hasUpdatedAtColumn: true },
    { select: "id,active_webhook_config_id", hasWebhookColumn: true, hasUpdatedAtColumn: false },
    { select: "id,automation_updated_at", hasWebhookColumn: false, hasUpdatedAtColumn: true },
    { select: "id", hasWebhookColumn: false, hasUpdatedAtColumn: false },
  ] as const;

  for (const candidate of candidates) {
    const query = await supabaseAdmin.from("stores").select(candidate.select).in("id", storeIds);
    if (query.error) {
      if (!isMissingColumnError(query.error, "active_webhook_config_id") && !isMissingColumnError(query.error, "automation_updated_at")) {
        throw query.error;
      }
      continue;
    }

    const rows = (query.data ?? []) as unknown as Array<{
      id: string;
      active_webhook_config_id?: string | null;
      automation_updated_at?: string | null;
    }>;
    const map = new Map<string, StoreBindingRow>();
    for (const row of rows) {
      map.set(row.id, {
        id: row.id,
        active_webhook_config_id: candidate.hasWebhookColumn ? row.active_webhook_config_id ?? null : null,
        automation_updated_at: candidate.hasUpdatedAtColumn ? row.automation_updated_at ?? null : null,
      });
    }
    return map;
  }

  return new Map<string, StoreBindingRow>();
};

const loadStoreWebhookMappingsFromLogs = async (storeIds: string[]) => {
  const result = new Map<string, MappingSnapshot>();
  if (!storeIds.length) {
    return result;
  }

  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("request_body, created_at")
    .eq("request_method", "STORE_WEBHOOK_MAP")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return result;
  }

  const allowedStoreIds = new Set(storeIds);
  for (const row of (data ?? []) as Array<{ request_body: unknown; created_at: string | null }>) {
    const body =
      typeof row.request_body === "object" && row.request_body !== null
        ? (row.request_body as Record<string, unknown>)
        : null;

    const storeId = typeof body?.store_id === "string" ? body.store_id : null;
    const webhookConfigId = typeof body?.webhook_config_id === "string" ? body.webhook_config_id : null;
    if (!storeId || !webhookConfigId || !allowedStoreIds.has(storeId)) {
      continue;
    }

    if (!result.has(storeId)) {
      result.set(storeId, {
        webhookConfigId,
        mappedAt: row.created_at ?? null,
      });
    }
  }

  return result;
};

const loadActiveAutomationWebhookConfigs = async () => {
  const candidates = [
    "id,target_url,method,headers,enabled,scope",
    "id,target_url,method,headers,enabled",
    "id,target_url,method,enabled,scope",
    "id,target_url,method,enabled",
    "id,target_url,method,headers",
    "id,target_url,method",
  ] as const;

  for (const select of candidates) {
    const query = supabaseAdmin
      .from("webhook_configs")
      .select(select)
      .order("updated_at", { ascending: false })
      .limit(5000);

    const hasScope = select.includes("scope");
    const scoped = hasScope ? query.or("scope.eq.automation,scope.is.null") : query;
    const { data, error } = await scoped;

    if (error) {
      if (!isMissingColumnError(error, "scope") && !isMissingColumnError(error, "enabled") && !isMissingColumnError(error, "headers")) {
        throw error;
      }
      continue;
    }

    const rows = (data ?? []) as unknown as WebhookConfigRow[];
    const map = new Map<string, WebhookConfigRow>();
    for (const row of rows) {
      if (row.enabled === false) {
        continue;
      }
      if ((row.scope ?? "automation") === "generic") {
        continue;
      }
      if (!row.target_url) {
        continue;
      }
      map.set(row.id, row);
    }
    return map;
  }

  return new Map<string, WebhookConfigRow>();
};

const loadEnabledCronTestWebhookCount = async () => {
  const withNameAndEnabled = await supabaseAdmin
    .from("webhook_configs")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true)
    .ilike("name", `${CRON_TEST_NAME_PREFIX}%`);

  if (!withNameAndEnabled.error) {
    return withNameAndEnabled.count ?? 0;
  }

  if (isMissingTableError(withNameAndEnabled.error)) {
    return 0;
  }

  const fallback = await supabaseAdmin
    .from("webhook_configs")
    .select("id,name", { count: "exact" })
    .limit(5000);

  if (fallback.error) {
    if (isMissingTableError(fallback.error)) {
      return 0;
    }
    throw fallback.error;
  }

  const rows = (fallback.data ?? []) as Array<{ id: string; name?: string | null }>;
  return rows.filter((row) => (row.name ?? "").startsWith(CRON_TEST_NAME_PREFIX)).length;
};

const syncDirectAutomationCronJobs = async (apiKey: string): Promise<DirectAutomationSyncResult> => {
  try {
    const nowMs = Date.now();
    const subscriptions = await loadActiveSubscriptions();
    const eligibleSubscriptions = subscriptions.filter((row) => isSubscriptionEligible(row, nowMs));

    const subscriptionStoreIds = Array.from(
      new Set(
        eligibleSubscriptions
          .map((row) => getStoreIdFromSubscription(row))
          .filter((storeId): storeId is string => Boolean(storeId))
      )
    );

    const [storeBindings, mappingSnapshots, webhookConfigs, listResponse] = await Promise.all([
      loadStoreBindings(subscriptionStoreIds),
      loadStoreWebhookMappingsFromLogs(subscriptionStoreIds),
      loadActiveAutomationWebhookConfigs(),
      callCronJobOrgApi<CronJobListResponse>({
        method: "GET",
        path: "/jobs",
        apiKey,
      }),
    ]);
    const existingStoreIds = new Set(storeBindings.keys());

    const singletonWebhookId = webhookConfigs.size === 1 ? Array.from(webhookConfigs.keys())[0] : null;
    const desiredByTitle = new Map<string, CronJobPayload>();

    for (const subscription of eligibleSubscriptions) {
      const storeId = getStoreIdFromSubscription(subscription);
      if (!storeId) {
        continue;
      }
      if (!existingStoreIds.has(storeId)) {
        continue;
      }

      const binding = storeBindings.get(storeId);
      const mapped = mappingSnapshots.get(storeId);
      const explicitWebhookId = binding?.active_webhook_config_id ?? null;
      const mappedWebhookId = mapped?.webhookConfigId ?? null;

      const webhookConfigId =
        (explicitWebhookId && webhookConfigs.has(explicitWebhookId) ? explicitWebhookId : null) ??
        (mappedWebhookId && webhookConfigs.has(mappedWebhookId) ? mappedWebhookId : null) ??
        singletonWebhookId;

      if (!webhookConfigId) {
        continue;
      }

      const webhook = webhookConfigs.get(webhookConfigId);
      if (!webhook) {
        continue;
      }

      const anchorIso =
        binding?.automation_updated_at ??
        mapped?.mappedAt ??
        subscription.updated_at ??
        subscription.created_at ??
        new Date(nowMs).toISOString();

      const plan = (subscription.plan ?? "standard").toLowerCase();
      const method = (webhook.method ?? "POST").toUpperCase() === "GET" ? "GET" : "POST";
      const normalizedHeaders = normalizeHeaders(webhook.headers);
      const title = buildAutomationTitle({
        subscriptionId: subscription.id,
        storeId,
        webhookConfigId,
        plan,
      });

      const payload: CronJobPayload = {
        enabled: true,
        title,
        saveResponses: true,
        url: webhook.target_url,
        redirectSuccess: true,
        requestMethod: method === "GET" ? GET_REQUEST_METHOD : POST_REQUEST_METHOD,
        schedule: createAutomationSchedule(plan, anchorIso),
        extendedData: {
          headers: {
            ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
            ...normalizedHeaders,
          },
          ...(method === "POST" ? { body: JSON.stringify({ client_id: storeId }) } : {}),
        },
      };

      desiredByTitle.set(title, payload);
    }

    const allJobs = (listResponse.jobs ?? []) as CronJobListItem[];
    const managedJobs = allJobs.filter((job) => isAutomationManagedTitle(job.title));
    const managedByTitle = new Map<string, CronJobListItem>(
      managedJobs
        .filter((job): job is CronJobListItem & { title: string } => Boolean(job.title))
        .map((job) => [job.title as string, job])
    );

    let created = 0;
    let updated = 0;
    let deleted = 0;

    for (const [title, payload] of desiredByTitle.entries()) {
      const existing = managedByTitle.get(title);
      if (existing) {
        await callCronJobOrgApi<Record<string, never>>({
          method: "PATCH",
          path: `/jobs/${existing.jobId}`,
          body: { job: payload },
          apiKey,
        });
        updated += 1;
        continue;
      }

      await callCronJobOrgApi<CronJobCreateResponse>({
        method: "PUT",
        path: "/jobs",
        body: { job: payload },
        apiKey,
      });
      created += 1;
    }

    for (const managed of managedJobs) {
      const title = managed.title ?? "";
      if (desiredByTitle.has(title)) {
        continue;
      }

      await callCronJobOrgApi<Record<string, never>>({
        method: "DELETE",
        path: `/jobs/${managed.jobId}`,
        apiKey,
      });
      deleted += 1;
    }

    return {
      ok: true,
      created,
      updated,
      deleted,
      desired: desiredByTitle.size,
      existingManaged: managedJobs.length,
      message: `Direct cron senkronu tamamlandı (desired=${desiredByTitle.size}, created=${created}, updated=${updated}, deleted=${deleted}).`,
    };
  } catch (error) {
    return {
      ok: false,
      message: "Direct automation cron senkronu başarısız.",
      details: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }
};

export const loadDirectAutomationCronJobs = async () => {
  const apiKey = resolveCronApiKey();
  if (!apiKey) {
    throw new Error("Cron API key bulunamadı.");
  }

  const listResponse = await callCronJobOrgApi<CronJobListResponse>({
    method: "GET",
    path: "/jobs",
    apiKey,
  });

  const rows = ((listResponse.jobs ?? []) as CronJobSummary[])
    .filter((job) => isAutomationManagedTitle(job.title))
    .map((job) => {
      const parsed = parseAutomationTitle(job.title ?? null);
      return {
        jobId: job.jobId,
        enabled: job.enabled !== false,
        title: job.title ?? "",
        url: job.url ?? "",
        requestMethod: job.requestMethod ?? POST_REQUEST_METHOD,
        lastStatus: job.lastStatus ?? null,
        lastDuration: job.lastDuration ?? null,
        lastExecution: job.lastExecution ?? null,
        nextExecution: job.nextExecution ?? null,
        schedule: job.schedule ?? null,
        subscriptionId: parsed.subscriptionId,
        storeId: parsed.storeId,
        webhookConfigId: parsed.webhookConfigId,
        plan: parsed.plan,
      } satisfies DirectAutomationCronJob;
    })
    .sort((a, b) => {
      const aNext = a.nextExecution ?? 0;
      const bNext = b.nextExecution ?? 0;
      return aNext - bNext;
    });

  return rows;
};

const findExistingSchedulerJobId = async (apiKey: string) => {
  const configuredJobId = resolveConfiguredJobId();
  const listResponse = await callCronJobOrgApi<CronJobListResponse>({
    method: "GET",
    path: "/jobs",
    apiKey,
  });

  const jobs = listResponse.jobs ?? [];

  if (configuredJobId !== null) {
    const exactById = jobs.find((job) => job.jobId === configuredJobId);
    if (exactById) {
      return exactById.jobId;
    }
  }

  const targetUrl = schedulerTickUrl();
  const byTitleAndUrl = jobs.find(
    (job) => (job.title ?? "").trim() === LISTFLOW_SCHEDULER_TITLE && (job.url ?? "").trim() === targetUrl
  );

  if (byTitleAndUrl) {
    return byTitleAndUrl.jobId;
  }

  const byUrl = jobs.find((job) => (job.url ?? "").trim() === targetUrl);
  if (byUrl) {
    return byUrl.jobId;
  }

  return null;
};

export const ensureSchedulerCronJob = async (): Promise<SchedulerCronSyncResult> => {
  const apiKey = resolveCronApiKey();

  if (!apiKey) {
    return {
      ok: false,
      status: "skipped",
      message: "Cron API key bulunamadı. Cron senkronu atlandı.",
    };
  }

  const payload = createSchedulerJobPayload();

  try {
    const existingJobId = await findExistingSchedulerJobId(apiKey);

    if (existingJobId !== null) {
      await callCronJobOrgApi<Record<string, never>>({
        method: "PATCH",
        path: `/jobs/${existingJobId}`,
        body: {
          job: payload,
        },
        apiKey,
      });

      return {
        ok: true,
        status: "updated",
        jobId: existingJobId,
        message: `Cron job güncellendi (jobId=${existingJobId}, url=${payload.url}).`,
      };
    }

    const created = await callCronJobOrgApi<CronJobCreateResponse>({
      method: "PUT",
      path: "/jobs",
      body: {
        job: payload,
      },
      apiKey,
    });

    if (!created.jobId || !Number.isFinite(created.jobId)) {
      return {
        ok: false,
        status: "error",
        message: "Cron job oluşturuldu ancak jobId alınamadı.",
      };
    }

    return {
      ok: true,
      status: "created",
      jobId: created.jobId,
      message: `Cron job oluşturuldu (jobId=${created.jobId}, url=${payload.url}).`,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      message: "cron-job.org senkronu başarısız.",
      details: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }
};

export const deleteSchedulerCronJob = async (): Promise<SchedulerCronSyncResult> => {
  const apiKey = resolveCronApiKey();

  if (!apiKey) {
    return {
      ok: false,
      status: "skipped",
      message: "Cron API key bulunamadı. Cron job silme atlandı.",
    };
  }

  try {
    const existingJobId = await findExistingSchedulerJobId(apiKey);
    if (existingJobId === null) {
      return {
        ok: true,
        status: "noop",
        message: "Silinecek scheduler cron job bulunamadı.",
      };
    }

    await callCronJobOrgApi<Record<string, never>>({
      method: "DELETE",
      path: `/jobs/${existingJobId}`,
      apiKey,
    });

    return {
      ok: true,
      status: "deleted",
      jobId: existingJobId,
      message: `Scheduler cron job silindi (jobId=${existingJobId}).`,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      message: "cron-job.org job silme başarısız.",
      details: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }
};

export const syncSchedulerCronJobLifecycle = async (): Promise<SchedulerCronSyncResult> => {
  const apiKey = resolveCronApiKey();

  if (!apiKey) {
    return {
      ok: false,
      status: "skipped",
      message: "Cron API key bulunamadı. Cron senkronu atlandı.",
    };
  }

  try {
    const directResult = isDirectAutomationMode() ? await syncDirectAutomationCronJobs(apiKey) : null;

    if (directResult && !directResult.ok) {
      return {
        ok: false,
        status: "error",
        message: directResult.message,
        details: directResult.details,
      };
    }

    const cronTestCount = await loadEnabledCronTestWebhookCount();
    const schedulerResult =
      cronTestCount > 0
        ? await ensureSchedulerCronJob()
        : await deleteSchedulerCronJob();

    if (!schedulerResult.ok) {
      return schedulerResult;
    }

    if (directResult) {
      return {
        ...schedulerResult,
        message: `${schedulerResult.message} ${directResult.message}`,
      };
    }

    return schedulerResult;
  } catch (error) {
    return {
      ok: false,
      status: "error",
      message: "Cron lifecycle senkronu başarısız.",
      details: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }
};
