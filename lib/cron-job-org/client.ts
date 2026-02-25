import { serverEnv } from "@/lib/env/server";
import { getPlanWindowHours } from "@/lib/scheduler/idempotency";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePublicSiteUrl } from "@/lib/url/public-site";

const CRON_JOB_ORG_BASE_URL = "https://api.cron-job.org";
const LISTFLOW_SCHEDULER_TITLE = "Listflow Scheduler Tick";
const LISTFLOW_AUTOMATION_TITLE_PREFIX = "Listflow Automation::";
const GET_REQUEST_METHOD = 0;
const POST_REQUEST_METHOD = 1;
const DEFAULT_AUTOMATION_MODE = "direct";
const PAGE_SIZE = 1000;
const IN_FILTER_CHUNK_SIZE = 200;
const DIRECT_JOBS_CACHE_TTL_MS = 90_000;
const CRON_LIFECYCLE_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const CRON_JOB_ORG_MAX_MUTATIONS_PER_SYNC = 25;
const CRON_JOB_ORG_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

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
      unchanged: number;
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

type DesiredDirectJob = {
  title: string;
  payload: CronJobPayload;
  subscriptionId: string;
  storeId: string;
  webhookConfigId: string;
  plan: string;
  anchorIso: string;
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

let directAutomationCronJobsCache:
  | {
      rows: DirectAutomationCronJob[];
      fetchedAt: number;
      expiresAt: number;
    }
  | null = null;

let directAutomationCronJobsInFlight: Promise<DirectAutomationCronJob[]> | null = null;
let lifecycleSyncInFlight: Promise<SchedulerCronSyncResult> | null = null;
let lifecycleSyncLastAt = 0;

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

const resolveSchedulerBaseUrl = () => {
  const raw = serverEnv.CRON_SCHEDULER_BASE_URL;
  if (raw && raw.trim()) {
    return stripTrailingSlashes(raw);
  }

  return stripTrailingSlashes(resolvePublicSiteUrl());
};

const schedulerTickUrl = () => `${resolveSchedulerBaseUrl()}/api/scheduler/tick`;

const createSchedule = (): CronJobSchedule => {
  // Direct mode uses per-webhook cron jobs for production dispatch.
  // Keep scheduler tick lightweight (daily) unless queue mode is enabled.
  if (isDirectAutomationMode()) {
    return {
      timezone: "UTC",
      expiresAt: 0,
      hours: [0],
      mdays: [-1],
      minutes: [0],
      months: [-1],
      wdays: [-1],
    };
  }

  return {
    timezone: "UTC",
    expiresAt: 0,
    hours: [-1],
    mdays: [-1],
    minutes: [-1],
    months: [-1],
    wdays: [-1],
  };
};

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

const isCronJobOrgRateLimitedError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("429") || message.includes("rate limit");
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const callCronJobOrgApi = async <T>(args: {
  method: "GET" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  apiKey: string;
}) => {
  let lastErrorMessage = "Unknown cron-job.org error";

  for (let attempt = 0; attempt <= CRON_JOB_ORG_RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetch(`${CRON_JOB_ORG_BASE_URL}${args.path}`, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
    });

    if (response.ok) {
      if (response.status === 204) {
        return {} as T;
      }

      const text = await response.text();
      if (!text) {
        return {} as T;
      }

      return JSON.parse(text) as T;
    }

    const message = await parseCronJobApiError(response);
    lastErrorMessage = message;

    const shouldRetry = response.status === 429 && attempt < CRON_JOB_ORG_RETRY_DELAYS_MS.length;
    if (shouldRetry) {
      await sleep(CRON_JOB_ORG_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    throw new Error(`HTTP ${response.status}: ${message}`);
  }

  throw new Error(lastErrorMessage);
};

const buildFixedPlanHours = (intervalHours: number) => {
  const safeInterval = intervalHours >= 1 ? intervalHours : 8;
  const hours: number[] = [];

  for (let hour = 0; hour < 24; hour += safeInterval) {
    hours.push(hour);
  }

  return hours.length ? hours : [0];
};

const resolveAnchorDate = (anchorIso: string | null | undefined, nowMs: number) => {
  const parsed = anchorIso ? new Date(anchorIso) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date(nowMs);
};

const createAutomationSchedule = (plan: string | null | undefined, anchorIso: string | null | undefined, nowMs: number) => {
  const intervalHours = getPlanWindowHours(plan ?? "standard");
  const anchorDate = resolveAnchorDate(anchorIso, nowMs);
  const anchorHour = anchorDate.getUTCHours();
  const anchorMinute = anchorDate.getUTCMinutes();
  const hours = buildFixedPlanHours(intervalHours).map((hourOffset) => (anchorHour + hourOffset) % 24);

  return {
    timezone: "UTC",
    expiresAt: 0,
    hours: Array.from(new Set(hours)).sort((a, b) => a - b),
    mdays: [-1],
    minutes: [anchorMinute],
    months: [-1],
    wdays: [-1],
  } satisfies CronJobSchedule;
};

const computeNextExecutionUnix = (args: { plan: string; nowMs: number; anchorIso: string | null | undefined }) => {
  const intervalMs = Math.max(1, getPlanWindowHours(args.plan)) * 60 * 60 * 1000;
  const anchorDate = resolveAnchorDate(args.anchorIso, args.nowMs);
  const anchorMs = Date.UTC(
    anchorDate.getUTCFullYear(),
    anchorDate.getUTCMonth(),
    anchorDate.getUTCDate(),
    anchorDate.getUTCHours(),
    anchorDate.getUTCMinutes(),
    0,
    0
  );

  const nextMs = (() => {
    if (anchorMs > args.nowMs) {
      return anchorMs;
    }

    const elapsedMs = args.nowMs - anchorMs;
    const elapsedSlots = Math.floor(elapsedMs / intervalMs) + 1;
    return anchorMs + elapsedSlots * intervalMs;
  })();

  return Math.floor(nextMs / 1000);
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
  const collect = async (select: string) => {
    const rows: ActiveSubscriptionRow[] = [];
    let from = 0;

    while (true) {
      const to = from + PAGE_SIZE - 1;
      const page = await supabaseAdmin
        .from("subscriptions")
        .select(select)
        .in("status", ["active", "trialing"])
        .order("id", { ascending: true })
        .range(from, to);

      if (page.error) {
        throw page.error;
      }

      const data = (page.data ?? []) as unknown as ActiveSubscriptionRow[];
      rows.push(...data);

      if (data.length < PAGE_SIZE) {
        break;
      }

      from += PAGE_SIZE;
    }

    return rows;
  };

  try {
    return await collect("id, plan, status, current_period_end, store_id, shop_id, updated_at, created_at");
  } catch (error) {
    if (!isMissingColumnError(error as { message?: string }, "store_id")) {
      throw error;
    }
  }

  const fallbackRows = await collect("id, plan, status, current_period_end, shop_id, updated_at, created_at");
  return fallbackRows.map((row) => ({
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

  const chunks: string[][] = [];
  for (let index = 0; index < storeIds.length; index += IN_FILTER_CHUNK_SIZE) {
    chunks.push(storeIds.slice(index, index + IN_FILTER_CHUNK_SIZE));
  }

  for (const candidate of candidates) {
    const map = new Map<string, StoreBindingRow>();
    let useNextCandidate = false;

    for (const chunk of chunks) {
      const query = await supabaseAdmin.from("stores").select(candidate.select).in("id", chunk);
      if (query.error) {
        if (!isMissingColumnError(query.error, "active_webhook_config_id") && !isMissingColumnError(query.error, "automation_updated_at")) {
          throw query.error;
        }
        useNextCandidate = true;
        break;
      }

      const rows = (query.data ?? []) as unknown as Array<{
        id: string;
        active_webhook_config_id?: string | null;
        automation_updated_at?: string | null;
      }>;
      for (const row of rows) {
        map.set(row.id, {
          id: row.id,
          active_webhook_config_id: candidate.hasWebhookColumn ? row.active_webhook_config_id ?? null : null,
          automation_updated_at: candidate.hasUpdatedAtColumn ? row.automation_updated_at ?? null : null,
        });
      }
    }

    if (!useNextCandidate) {
      return map;
    }
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
    .select("request_body, request_url, created_at")
    .eq("request_method", "STORE_WEBHOOK_MAP")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return result;
  }

  const allowedStoreIds = new Set(storeIds);
  for (const row of (data ?? []) as Array<{ request_body: unknown; request_url?: string | null; created_at: string | null }>) {
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
    const hasScope = select.includes("scope");
    const map = new Map<string, WebhookConfigRow>();
    let from = 0;
    let useNextCandidate = false;

    while (true) {
      const to = from + PAGE_SIZE - 1;
      const query = supabaseAdmin
        .from("webhook_configs")
        .select(select)
        .order("id", { ascending: true })
        .range(from, to);

      const scoped = hasScope ? query.or("scope.eq.automation,scope.is.null") : query;
      const { data, error } = await scoped;

      if (error) {
        if (!isMissingColumnError(error, "scope") && !isMissingColumnError(error, "enabled") && !isMissingColumnError(error, "headers")) {
          throw error;
        }
        useNextCandidate = true;
        break;
      }

      const rows = (data ?? []) as unknown as WebhookConfigRow[];
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

      if (rows.length < PAGE_SIZE) {
        break;
      }
      from += PAGE_SIZE;
    }

    if (!useNextCandidate) {
      return map;
    }
  }

  return new Map<string, WebhookConfigRow>();
};

const normalizeNumberArray = (value: number[] | null | undefined) =>
  Array.from(new Set((value ?? []).map((item) => Number(item)).filter((item) => Number.isFinite(item)))).sort(
    (a, b) => a - b
  );

const sameNumberArray = (left: number[] | null | undefined, right: number[] | null | undefined) => {
  const l = normalizeNumberArray(left);
  const r = normalizeNumberArray(right);
  if (l.length !== r.length) {
    return false;
  }

  for (let index = 0; index < l.length; index += 1) {
    if (l[index] !== r[index]) {
      return false;
    }
  }

  return true;
};

const hasSameSchedule = (current: CronJobSchedule | undefined, desired: CronJobSchedule) => {
  if (!current) {
    return false;
  }

  return (
    (current.timezone ?? "UTC") === (desired.timezone ?? "UTC") &&
    (current.expiresAt ?? 0) === (desired.expiresAt ?? 0) &&
    sameNumberArray(current.hours, desired.hours) &&
    sameNumberArray(current.minutes, desired.minutes) &&
    sameNumberArray(current.mdays, desired.mdays) &&
    sameNumberArray(current.months, desired.months) &&
    sameNumberArray(current.wdays, desired.wdays)
  );
};

const shouldUpdateManagedJob = (existing: CronJobListItem, desired: CronJobPayload) => {
  const urlChanged = (existing.url ?? "").trim() !== desired.url.trim();
  const methodChanged = (existing.requestMethod ?? POST_REQUEST_METHOD) !== desired.requestMethod;
  const enabledChanged = (existing.enabled ?? true) !== desired.enabled;
  const scheduleChanged = !hasSameSchedule(existing.schedule, desired.schedule);

  return urlChanged || methodChanged || enabledChanged || scheduleChanged;
};

const buildDesiredDirectJobs = async (nowMs: number) => {
  const subscriptions = await loadActiveSubscriptions();
  const eligibleSubscriptions = subscriptions.filter((row) => isSubscriptionEligible(row, nowMs));

  const subscriptionStoreIds = Array.from(
    new Set(
      eligibleSubscriptions
        .map((row) => getStoreIdFromSubscription(row))
        .filter((storeId): storeId is string => Boolean(storeId))
    )
  );

  const [storeBindings, mappingSnapshots, webhookConfigs] = await Promise.all([
    loadStoreBindings(subscriptionStoreIds),
    loadStoreWebhookMappingsFromLogs(subscriptionStoreIds),
    loadActiveAutomationWebhookConfigs(),
  ]);

  const existingStoreIds = new Set(storeBindings.keys());
  const desiredJobs: DesiredDirectJob[] = [];

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
      (mappedWebhookId && webhookConfigs.has(mappedWebhookId) ? mappedWebhookId : null);

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
      subscription.created_at ??
      subscription.updated_at ??
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
      schedule: createAutomationSchedule(plan, anchorIso, nowMs),
      extendedData: {
        headers: {
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          ...normalizedHeaders,
        },
        ...(method === "POST" ? { body: JSON.stringify({ client_id: storeId }) } : {}),
      },
    };

    desiredJobs.push({
      title,
      payload,
      subscriptionId: subscription.id,
      storeId,
      webhookConfigId,
      plan,
      anchorIso,
    });
  }

  return desiredJobs;
};

const syncDirectAutomationCronJobs = async (apiKey: string): Promise<DirectAutomationSyncResult> => {
  try {
    const nowMs = Date.now();
    const [desiredJobs, listResponse] = await Promise.all([
      buildDesiredDirectJobs(nowMs),
      callCronJobOrgApi<CronJobListResponse>({
        method: "GET",
        path: "/jobs",
        apiKey,
      }),
    ]);

    const desiredByTitle = new Map<string, CronJobPayload>(desiredJobs.map((job) => [job.title, job.payload]));

    const allJobs = (listResponse.jobs ?? []) as CronJobListItem[];
    const managedJobs = allJobs.filter((job) => isAutomationManagedTitle(job.title));
    const managedByTitle = new Map<string, CronJobListItem>(
      managedJobs
        .filter((job): job is CronJobListItem & { title: string } => Boolean(job.title))
        .map((job) => [job.title as string, job])
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let deleted = 0;
    let skippedDueToBudget = 0;
    let remainingMutations = CRON_JOB_ORG_MAX_MUTATIONS_PER_SYNC;

    for (const [title, payload] of desiredByTitle.entries()) {
      const existing = managedByTitle.get(title);
      if (existing) {
        if (shouldUpdateManagedJob(existing, payload)) {
          if (remainingMutations <= 0) {
            skippedDueToBudget += 1;
            continue;
          }
          await callCronJobOrgApi<Record<string, never>>({
            method: "PATCH",
            path: `/jobs/${existing.jobId}`,
            body: { job: payload },
            apiKey,
          });
          updated += 1;
          remainingMutations -= 1;
        } else {
          unchanged += 1;
        }
        continue;
      }

      if (remainingMutations <= 0) {
        skippedDueToBudget += 1;
        continue;
      }
      await callCronJobOrgApi<CronJobCreateResponse>({
        method: "PUT",
        path: "/jobs",
        body: { job: payload },
        apiKey,
      });
      created += 1;
      remainingMutations -= 1;
    }

    for (const managed of managedJobs) {
      const title = managed.title ?? "";
      if (desiredByTitle.has(title)) {
        continue;
      }

      if (remainingMutations <= 0) {
        skippedDueToBudget += 1;
        continue;
      }
      await callCronJobOrgApi<Record<string, never>>({
        method: "DELETE",
        path: `/jobs/${managed.jobId}`,
        apiKey,
      });
      deleted += 1;
      remainingMutations -= 1;
    }

    const mutationSummary =
      skippedDueToBudget > 0
        ? ` Mutasyon limiti nedeniyle ${skippedDueToBudget} işlem sonraki senkrona bırakıldı.`
        : "";

    return {
      ok: true,
      created,
      updated,
      unchanged,
      deleted,
      desired: desiredByTitle.size,
      existingManaged: managedJobs.length,
      message: `Direct cron senkronu tamamlandı (desired=${desiredByTitle.size}, created=${created}, updated=${updated}, unchanged=${unchanged}, deleted=${deleted}).${mutationSummary}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: "Direct automation cron senkronu başarısız.",
      details: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }
};

const buildDesiredDirectCronRows = async (nowMs: number) => {
  const desiredJobs = await buildDesiredDirectJobs(nowMs);
  const rows = desiredJobs
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((job, index) => {
      const nextExecution = computeNextExecutionUnix({
        plan: job.plan,
        nowMs,
        anchorIso: job.anchorIso,
      });

      return {
        jobId: -(index + 1),
        enabled: true,
        title: job.title,
        url: job.payload.url,
        requestMethod: job.payload.requestMethod,
        lastStatus: 0,
        lastDuration: null,
        lastExecution: null,
        nextExecution,
        schedule: job.payload.schedule,
        subscriptionId: job.subscriptionId,
        storeId: job.storeId,
        webhookConfigId: job.webhookConfigId,
        plan: job.plan,
      } satisfies DirectAutomationCronJob;
    });

  return rows;
};

export const loadDirectAutomationCronJobs = async (options?: { force?: boolean }) => {
  const apiKey = resolveCronApiKey();
  if (!apiKey) {
    throw new Error("Cron API key bulunamadı.");
  }

  const nowMs = Date.now();
  const force = options?.force === true;

  if (!force && directAutomationCronJobsCache && directAutomationCronJobsCache.expiresAt > nowMs) {
    return directAutomationCronJobsCache.rows;
  }

  if (!force && directAutomationCronJobsInFlight) {
    return directAutomationCronJobsInFlight;
  }

  const promise = (async () => {
    try {
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

      const fetchedAt = Date.now();
      directAutomationCronJobsCache = {
        rows,
        fetchedAt,
        expiresAt: fetchedAt + DIRECT_JOBS_CACHE_TTL_MS,
      };

      return rows;
    } catch (error) {
      if (isCronJobOrgRateLimitedError(error) && directAutomationCronJobsCache) {
        return directAutomationCronJobsCache.rows;
      }

      if (isCronJobOrgRateLimitedError(error)) {
        const fallbackRows = await buildDesiredDirectCronRows(Date.now());
        const fetchedAt = Date.now();
        directAutomationCronJobsCache = {
          rows: fallbackRows,
          fetchedAt,
          expiresAt: fetchedAt + DIRECT_JOBS_CACHE_TTL_MS,
        };
        return fallbackRows;
      }

      throw error;
    }
  })();

  directAutomationCronJobsInFlight = promise;

  try {
    return await promise;
  } finally {
    if (directAutomationCronJobsInFlight === promise) {
      directAutomationCronJobsInFlight = null;
    }
  }
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
    if (isCronJobOrgRateLimitedError(error)) {
      return {
        ok: false,
        status: "skipped",
        message: "cron-job.org rate limit nedeniyle scheduler cron sync atlandı.",
        details: error instanceof Error ? error.message : "Rate limit",
      };
    }

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
    if (isCronJobOrgRateLimitedError(error)) {
      return {
        ok: false,
        status: "skipped",
        message: "cron-job.org rate limit nedeniyle scheduler cron silme atlandı.",
        details: error instanceof Error ? error.message : "Rate limit",
      };
    }

    return {
      ok: false,
      status: "error",
      message: "cron-job.org job silme başarısız.",
      details: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }
};

export const syncSchedulerCronJobLifecycle = async (options?: { force?: boolean }): Promise<SchedulerCronSyncResult> => {
  const apiKey = resolveCronApiKey();

  if (!apiKey) {
    return {
      ok: false,
      status: "skipped",
      message: "Cron API key bulunamadı. Cron senkronu atlandı.",
    };
  }

  const force = options?.force === true;
  const nowMs = Date.now();

  if (!force) {
    if (lifecycleSyncInFlight) {
      return lifecycleSyncInFlight;
    }

    if (lifecycleSyncLastAt > 0 && nowMs - lifecycleSyncLastAt < CRON_LIFECYCLE_SYNC_COOLDOWN_MS) {
      return {
        ok: true,
        status: "noop",
        message: "Cron lifecycle senkronu kısa aralıkta tekrarlandığı için atlandı.",
      };
    }
  }

  const run = async (): Promise<SchedulerCronSyncResult> => {
    try {
      const schedulerResult = await ensureSchedulerCronJob();

      if (!schedulerResult.ok) {
        return schedulerResult;
      }

      const directResult = isDirectAutomationMode() ? await syncDirectAutomationCronJobs(apiKey) : null;
      if (directResult && !directResult.ok) {
        if (isCronJobOrgRateLimitedError(new Error(directResult.details ?? directResult.message))) {
          return {
            ok: false,
            status: "skipped",
            message: `${schedulerResult.message} cron-job.org rate limit nedeniyle direct cron sync bu tur atlandı.`,
            details: directResult.details ?? directResult.message,
          };
        }

        return {
          ok: false,
          status: "error",
          message: `${schedulerResult.message} ${directResult.message}`,
          details: directResult.details,
        };
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

  const inFlight = run();
  lifecycleSyncInFlight = inFlight;

  try {
    return await inFlight;
  } finally {
    lifecycleSyncLastAt = Date.now();
    if (lifecycleSyncInFlight === inFlight) {
      lifecycleSyncInFlight = null;
    }
  }
};
