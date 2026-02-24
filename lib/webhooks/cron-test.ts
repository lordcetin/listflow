import { supabaseAdmin } from "@/lib/supabase/admin";
import { redactObject } from "@/lib/webhooks/redaction";

export const CRON_TEST_NAME_PREFIX = "CRON_TEST_2M::";
export const CRON_TEST_INTERVAL_MS = 2 * 60 * 1000;
export const CRON_TEST_REQUEST_METHOD = "CRON_TEST";
export const CRON_TEST_MANUAL_REQUEST_METHOD = "CRON_TEST_MANUAL";

type QueryError = { message?: string; code?: string | null };

type RawCronTestConfigRow = {
  id: string;
  name: string;
  target_url?: string | null;
  method?: string | null;
  headers?: Record<string, unknown> | null;
  enabled?: boolean | null;
  scope?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CronTestConfig = {
  id: string;
  name: string;
  displayName: string;
  targetUrl: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  enabled: boolean;
  scope: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CronTestLogSnapshot = {
  configId: string;
  createdAt: string;
  responseStatus: number | null;
  responseBody: string | null;
};

export type CronTestDispatchResult = {
  ok: boolean;
  status: number | null;
  body: string | null;
  durationMs: number;
  triggeredAt: string;
};

export type CronTestTickSummary = {
  total: number;
  enabled: number;
  triggered: number;
  skipped: number;
  failed: number;
  reasonBreakdown: Record<string, number>;
};

const isRecoverableColumnError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("failed to parse") ||
    message.includes("does not exist")
  );
};

const normalizeMethod = (value: string | null | undefined) => {
  return value?.toUpperCase() === "GET" ? "GET" : "POST";
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

const prefixName = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return `${CRON_TEST_NAME_PREFIX}Webhook`;
  }

  if (trimmed.startsWith(CRON_TEST_NAME_PREFIX)) {
    return trimmed;
  }

  return `${CRON_TEST_NAME_PREFIX}${trimmed}`;
};

const displayName = (name: string) => {
  return name.startsWith(CRON_TEST_NAME_PREFIX) ? name.slice(CRON_TEST_NAME_PREFIX.length) : name;
};

const parseCronTestConfig = (row: RawCronTestConfigRow): CronTestConfig | null => {
  const rawName = (row.name ?? "").trim();
  const targetUrl = (row.target_url ?? "").trim();

  if (!rawName.startsWith(CRON_TEST_NAME_PREFIX) || !targetUrl) {
    return null;
  }

  return {
    id: row.id,
    name: rawName,
    displayName: displayName(rawName),
    targetUrl,
    method: normalizeMethod(row.method),
    headers: normalizeHeaders(row.headers),
    enabled: row.enabled !== false,
    scope: row.scope ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
};

const addReason = (summary: CronTestTickSummary, reason: string) => {
  summary.reasonBreakdown[reason] = (summary.reasonBreakdown[reason] ?? 0) + 1;
};

const insertWebhookLogWithFallback = async (payload: {
  request_url: string;
  request_method: string;
  request_headers: Record<string, unknown>;
  request_body: Record<string, unknown>;
  response_status: number | null;
  response_body: string | null;
  duration_ms: number;
  created_by?: string | null;
}) => {
  const candidates: Array<Record<string, unknown>> = [
    payload,
    {
      request_url: payload.request_url,
      request_method: payload.request_method,
      request_headers: payload.request_headers,
      request_body: payload.request_body,
      response_status: payload.response_status,
      response_body: payload.response_body,
      duration_ms: payload.duration_ms,
    },
    {
      request_url: payload.request_url,
      request_method: payload.request_method,
      request_body: payload.request_body,
      response_status: payload.response_status,
      response_body: payload.response_body,
      duration_ms: payload.duration_ms,
    },
    {
      request_url: payload.request_url,
      request_method: payload.request_method,
      response_status: payload.response_status,
      response_body: payload.response_body,
      duration_ms: payload.duration_ms,
    },
    {
      request_url: payload.request_url,
      request_method: payload.request_method,
      response_status: payload.response_status,
      response_body: payload.response_body,
      duration_ms: payload.duration_ms,
    },
  ];

  for (const candidate of candidates) {
    const attempt = await supabaseAdmin.from("webhook_logs").insert(candidate);
    if (!attempt.error) {
      return;
    }

    if (!isRecoverableColumnError(attempt.error)) {
      return;
    }
  }
};

const dispatchCronWebhook = async (
  config: CronTestConfig,
  requestMethod: string
): Promise<CronTestDispatchResult> => {
  const triggeredAt = new Date().toISOString();
  const startedAt = Date.now();
  const payload = {
    client_id: "cron-test",
    cron_test_config_id: config.id,
    triggered_at: triggeredAt,
  };
  const sanitizedHeaders = redactObject(config.headers as Record<string, unknown>);

  try {
    const response = await fetch(config.targetUrl, {
      method: config.method,
      headers: {
        ...(config.method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...config.headers,
        "x-listflow-cron-test": "true",
        "x-listflow-triggered-at": triggeredAt,
      },
      body: config.method === "POST" ? JSON.stringify(payload) : undefined,
    });

    const body = await response.text();
    const durationMs = Date.now() - startedAt;

    await insertWebhookLogWithFallback({
      request_url: config.targetUrl,
      request_method: requestMethod,
      request_headers: sanitizedHeaders,
      request_body: payload,
      response_status: response.status,
      response_body: body,
      duration_ms: durationMs,
      created_by: null,
    });

    return {
      ok: response.ok,
      status: response.status,
      body,
      durationMs,
      triggeredAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron test webhook dispatch failed";
    const durationMs = Date.now() - startedAt;

    await insertWebhookLogWithFallback({
      request_url: config.targetUrl,
      request_method: requestMethod,
      request_headers: sanitizedHeaders,
      request_body: payload,
      response_status: null,
      response_body: message,
      duration_ms: durationMs,
      created_by: null,
    });

    return {
      ok: false,
      status: null,
      body: message,
      durationMs,
      triggeredAt,
    };
  }
};

export const loadCronTestConfigs = async () => {
  const candidates = [
    "id,name,target_url,method,headers,enabled,scope,created_at,updated_at",
    "id,name,target_url,method,headers,enabled,created_at,updated_at",
    "id,name,target_url,method,enabled,scope,created_at,updated_at",
    "id,name,target_url,method,enabled,created_at,updated_at",
    "id,name,target_url,method,created_at,updated_at",
  ] as const;

  let lastError: QueryError | null = null;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin
      .from("webhook_configs")
      .select(select)
      .order("updated_at", { ascending: false })
      .limit(2000);

    if (!error) {
      const rows = (data ?? []) as unknown as RawCronTestConfigRow[];
      const parsed = rows.map(parseCronTestConfig).filter((row): row is CronTestConfig => Boolean(row));
      return parsed;
    }

    lastError = error;

    if (!isRecoverableColumnError(error)) {
      break;
    }
  }

  throw new Error(lastError?.message || "Cron test webhook configs could not be loaded.");
};

export const loadCronTestLatestRuns = async () => {
  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("request_body,response_status,response_body,created_at")
    .eq("request_method", CRON_TEST_REQUEST_METHOD)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    if (isRecoverableColumnError(error)) {
      return new Map<string, CronTestLogSnapshot>();
    }

    throw new Error(error.message || "Cron test logs could not be loaded.");
  }

  const map = new Map<string, CronTestLogSnapshot>();
  for (const row of (data ?? []) as Array<{
    request_body: unknown;
    response_status: number | null;
    response_body: string | null;
    created_at: string | null;
  }>) {
    if (!row.created_at) {
      continue;
    }

    const body =
      typeof row.request_body === "object" && row.request_body !== null
        ? (row.request_body as Record<string, unknown>)
        : null;
    const configId = typeof body?.cron_test_config_id === "string" ? body.cron_test_config_id : null;

    if (!configId || map.has(configId)) {
      continue;
    }

    map.set(configId, {
      configId,
      createdAt: row.created_at,
      responseStatus: row.response_status ?? null,
      responseBody: row.response_body ?? null,
    });
  }

  return map;
};

export const runCronTestTick = async (): Promise<CronTestTickSummary> => {
  const [configs, latestRuns] = await Promise.all([loadCronTestConfigs(), loadCronTestLatestRuns()]);

  const nowMs = Date.now();
  const summary: CronTestTickSummary = {
    total: configs.length,
    enabled: configs.filter((row) => row.enabled).length,
    triggered: 0,
    skipped: 0,
    failed: 0,
    reasonBreakdown: {},
  };

  for (const config of configs) {
    if (!config.enabled) {
      summary.skipped += 1;
      addReason(summary, "disabled");
      continue;
    }

    const latestRun = latestRuns.get(config.id) ?? null;
    const latestRunMs = latestRun ? new Date(latestRun.createdAt).getTime() : null;

    if (latestRunMs !== null && !Number.isNaN(latestRunMs)) {
      const nextDueMs = latestRunMs + CRON_TEST_INTERVAL_MS;
      if (nowMs < nextDueMs) {
        summary.skipped += 1;
        addReason(summary, "not_due_yet");
        continue;
      }
    }

    const result = await dispatchCronWebhook(config, CRON_TEST_REQUEST_METHOD);
    if (result.ok) {
      summary.triggered += 1;
    } else {
      summary.failed += 1;
      addReason(summary, "dispatch_failed");
    }
  }

  return summary;
};

export const triggerCronTestWebhookNow = async (config: CronTestConfig) => {
  return dispatchCronWebhook(config, CRON_TEST_MANUAL_REQUEST_METHOD);
};

export const createCronTestConfig = async (args: {
  name: string;
  targetUrl: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  enabled?: boolean;
}) => {
  const configName = prefixName(args.name);
  const nowIso = new Date().toISOString();
  const headers = args.headers ?? {};
  const enabled = args.enabled ?? true;

  const insertCandidates: Array<Record<string, unknown>> = [
    {
      name: configName,
      target_url: args.targetUrl,
      method: args.method,
      headers,
      enabled,
      scope: "generic",
      description: "Cron test webhook (2 minute interval)",
      updated_at: nowIso,
    },
    {
      name: configName,
      target_url: args.targetUrl,
      method: args.method,
      headers,
      enabled,
      scope: "generic",
      updated_at: nowIso,
    },
    {
      name: configName,
      target_url: args.targetUrl,
      method: args.method,
      headers,
      enabled,
      updated_at: nowIso,
    },
    {
      name: configName,
      target_url: args.targetUrl,
      method: args.method,
      headers,
      enabled,
    },
  ];

  let lastError: QueryError | null = null;

  for (const candidate of insertCandidates) {
    const { data, error } = await supabaseAdmin
      .from("webhook_configs")
      .insert(candidate)
      .select("id")
      .maybeSingle();

    if (!error) {
      const id = (data as { id?: string } | null)?.id ?? null;
      if (!id) {
        throw new Error("Cron test webhook oluşturuldu ancak id alınamadı.");
      }

      const parsed = await getCronTestConfigById(id);
      if (!parsed) {
        throw new Error("Cron test webhook oluşturuldu ancak doğrulanamadı.");
      }
      return parsed;
    }

    lastError = error;
    if (!isRecoverableColumnError(error)) {
      break;
    }
  }

  throw new Error(lastError?.message || "Cron test webhook oluşturulamadı.");
};

export const updateCronTestConfig = async (
  id: string,
  patch: {
    name?: string;
    targetUrl?: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    enabled?: boolean;
  }
) => {
  const candidatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.name !== undefined) {
    candidatePayload.name = prefixName(patch.name);
  }

  if (patch.targetUrl !== undefined) {
    candidatePayload.target_url = patch.targetUrl;
  }

  if (patch.method !== undefined) {
    candidatePayload.method = patch.method;
  }

  if (patch.headers !== undefined) {
    candidatePayload.headers = patch.headers;
  }

  if (patch.enabled !== undefined) {
    candidatePayload.enabled = patch.enabled;
  }

  const candidates: Array<Record<string, unknown>> = [
    candidatePayload,
    Object.fromEntries(Object.entries(candidatePayload).filter(([key]) => key !== "updated_at")),
  ].filter((item) => Object.keys(item).length > 0);

  let lastError: QueryError | null = null;

  for (const payload of candidates) {
    const { data, error } = await supabaseAdmin
      .from("webhook_configs")
      .update(payload)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (!error) {
      const resolvedId = (data as { id?: string } | null)?.id ?? id;
      const parsed = await getCronTestConfigById(resolvedId);
      if (!parsed) {
        throw new Error("Cron test webhook güncellendi ancak doğrulanamadı.");
      }
      return parsed;
    }

    lastError = error;
    if (!isRecoverableColumnError(error)) {
      break;
    }
  }

  throw new Error(lastError?.message || "Cron test webhook güncellenemedi.");
};

export const deleteCronTestConfig = async (id: string) => {
  const { error } = await supabaseAdmin.from("webhook_configs").delete().eq("id", id);
  if (error) {
    throw new Error(error.message || "Cron test webhook silinemedi.");
  }
};

export const getCronTestConfigById = async (id: string) => {
  const candidates = [
    "id,name,target_url,method,headers,enabled,scope,created_at,updated_at",
    "id,name,target_url,method,headers,enabled,created_at,updated_at",
    "id,name,target_url,method,enabled,created_at,updated_at",
  ] as const;

  let lastError: QueryError | null = null;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin.from("webhook_configs").select(select).eq("id", id).maybeSingle();

    if (!error) {
      const parsed = parseCronTestConfig(data as unknown as RawCronTestConfigRow);
      return parsed;
    }

    lastError = error;
    if (!isRecoverableColumnError(error)) {
      break;
    }
  }

  throw new Error(lastError?.message || "Cron test webhook bulunamadı.");
};
