import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { dispatchN8nTrigger } from "@/lib/n8n/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { persistWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";
import { isUuid } from "@/lib/utils/uuid";

const ENABLE_AUTOBIND_ON_WEBHOOK_CREATE = false;
const ENABLE_DIRECT_BOOTSTRAP_ON_WEBHOOK_CREATE = false;
const ENABLE_CRON_SYNC_ON_WEBHOOK_CREATE = false;

type QueryError = { message?: string; code?: string | null };

type ConfigPayload = {
  name?: unknown;
  targetUrl?: unknown;
  method?: unknown;
  headers?: unknown;
  description?: unknown;
  enabled?: unknown;
  productId?: unknown;
};

type WebhookConfigForDispatch = {
  id: string;
  target_url: string;
  method: string | null;
  headers: Record<string, unknown> | null;
  enabled: boolean | null;
  scope?: string | null;
};

const isRecoverableColumnError = (error: QueryError | null | undefined) => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("failed to parse") ||
    message.includes("does not exist")
  );
};

const parseMethod = (value: unknown) => {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "POST";
  return normalized === "GET" ? "GET" : "POST";
};

const parseHeaders = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) continue;
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

const isMissingColumnError = (error: QueryError | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isMissingAnyColumnError = (error: QueryError | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const loadActiveSubscriptionStoreIds = async () => {
  const withStoreId = await supabaseAdmin
    .from("subscriptions")
    .select("store_id, shop_id, status")
    .in("status", ["active", "trialing"])
    .limit(5000);

  if (!withStoreId.error) {
    const ids = new Set<string>();

    for (const row of (withStoreId.data ?? []) as Array<{ store_id?: string | null; shop_id?: string | null }>) {
      const candidate = row.store_id ?? (row.shop_id && isUuid(row.shop_id) ? row.shop_id : null);
      if (candidate && isUuid(candidate)) {
        ids.add(candidate);
      }
    }

    return Array.from(ids);
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw new Error(withStoreId.error.message ?? "subscriptions could not be loaded");
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .select("shop_id, status")
    .in("status", ["active", "trialing"])
    .limit(5000);

  if (fallback.error) {
    throw new Error(fallback.error.message ?? "subscriptions could not be loaded");
  }

  const ids = new Set<string>();
  for (const row of (fallback.data ?? []) as Array<{ shop_id?: string | null }>) {
    if (row.shop_id && isUuid(row.shop_id)) {
      ids.add(row.shop_id);
    }
  }

  return Array.from(ids);
};

const loadExistingStoreIds = async (storeIds: string[]) => {
  if (!storeIds.length) {
    return [] as string[];
  }

  const { data, error } = await supabaseAdmin.from("stores").select("id").in("id", storeIds);
  if (error) {
    throw new Error(error.message ?? "stores could not be loaded");
  }

  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
};

const loadActiveAutomationWebhookIds = async () => {
  const selectCandidates = [
    "id,enabled,scope",
    "id,enabled",
    "id,scope",
    "id",
  ] as const;

  for (const select of selectCandidates) {
    const query = await supabaseAdmin.from("webhook_configs").select(select).limit(5000);
    if (query.error) {
      if (!isRecoverableColumnError(query.error)) {
        throw new Error(query.error.message ?? "webhook configs could not be loaded");
      }
      continue;
    }

    const ids = new Set<string>();
    for (const row of ((query.data ?? []) as unknown as Array<{ id: string; enabled?: boolean | null; scope?: string | null }>)) {
      if (row.enabled === false) {
        continue;
      }

      if (row.scope === "generic") {
        continue;
      }

      ids.add(row.id);
    }

    return ids;
  }

  return new Set<string>();
};

const loadLatestStoreWebhookMap = async (storeIds: string[]) => {
  const result = new Map<string, string>();
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
    if (isRecoverableColumnError(error)) {
      return result;
    }
    throw new Error(error.message ?? "store webhook mappings could not be loaded");
  }

  const allowedStoreIds = new Set(storeIds);
  for (const row of (data ?? []) as Array<{ request_body: unknown }>) {
    const body =
      typeof row.request_body === "object" && row.request_body !== null
        ? (row.request_body as Record<string, unknown>)
        : null;
    if (!body) {
      continue;
    }

    const storeId = typeof body.store_id === "string" ? body.store_id : null;
    const webhookConfigId = typeof body.webhook_config_id === "string" ? body.webhook_config_id : null;
    if (!storeId || !webhookConfigId || !allowedStoreIds.has(storeId)) {
      continue;
    }

    if (!result.has(storeId)) {
      result.set(storeId, webhookConfigId);
    }
  }

  return result;
};

const persistStoreWebhookMappingLog = async (args: {
  storeId: string;
  webhookConfigId: string;
  createdBy: string;
}) => {
  const payload = {
    store_id: args.storeId,
    webhook_config_id: args.webhookConfigId,
    idempotency_key: `auto_bind:${args.storeId}:${args.webhookConfigId}:${Date.now()}`,
  };

  const candidates: Array<Record<string, unknown>> = [
    {
      request_url: "store-webhook-mapping-auto-bind",
      request_method: "STORE_WEBHOOK_MAP",
      request_headers: {},
      request_body: payload,
      response_status: 200,
      response_body: "mapping_saved",
      duration_ms: 0,
      created_by: args.createdBy,
    },
    {
      request_url: "store-webhook-mapping-auto-bind",
      request_method: "STORE_WEBHOOK_MAP",
      request_body: payload,
    },
  ];

  for (const candidate of candidates) {
    const { error } = await supabaseAdmin.from("webhook_logs").insert(candidate);
    if (!error) {
      return true;
    }

    if (!isRecoverableColumnError(error)) {
      throw new Error(error.message ?? "webhook mapping log could not be inserted");
    }
  }

  return false;
};

const tryUpdateStoreBindingColumn = async (args: {
  storeId: string;
  webhookConfigId: string;
  adminUserId: string;
}) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, unknown>> = [
    {
      active_webhook_config_id: args.webhookConfigId,
      automation_updated_at: nowIso,
      automation_updated_by: args.adminUserId,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
      automation_updated_at: nowIso,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
    },
  ];

  for (const payload of payloads) {
    const update = await supabaseAdmin.from("stores").update(payload).eq("id", args.storeId);
    if (!update.error) {
      return { updated: true };
    }

    const recoverable = isMissingAnyColumnError(update.error, [
      "active_webhook_config_id",
      "automation_updated_at",
      "automation_updated_by",
    ]);

    if (!recoverable) {
      throw new Error(update.error.message ?? "stores binding update failed");
    }
  }

  return { updated: false };
};

const autoBindWebhookToActiveStores = async (args: {
  webhookConfigId: string;
  adminUserId: string;
}) => {
  const activeSubscriptionStoreIds = await loadActiveSubscriptionStoreIds();
  const storeIds = await loadExistingStoreIds(activeSubscriptionStoreIds);
  const activeWebhookIds = await loadActiveAutomationWebhookIds();
  const latestMappings = await loadLatestStoreWebhookMap(storeIds);

  let mappedCount = 0;
  let storeColumnUpdates = 0;
  let logMappings = 0;
  let skippedAlreadyMapped = 0;
  let forceReboundCount = 0;
  const mappedStoreIds: string[] = [];
  const forceRebindSingleStore = storeIds.length === 1;

  for (const storeId of storeIds) {
    const mappedWebhookId = latestMappings.get(storeId);
    const hasActiveMappedWebhook = Boolean(mappedWebhookId && activeWebhookIds.has(mappedWebhookId));

    if (hasActiveMappedWebhook && !forceRebindSingleStore) {
      skippedAlreadyMapped += 1;
      continue;
    }

    if (hasActiveMappedWebhook && forceRebindSingleStore) {
      forceReboundCount += 1;
    }

    const columnResult = await tryUpdateStoreBindingColumn({
      storeId,
      webhookConfigId: args.webhookConfigId,
      adminUserId: args.adminUserId,
    });

    if (columnResult.updated) {
      storeColumnUpdates += 1;
    }

    const logSaved = await persistStoreWebhookMappingLog({
      storeId,
      webhookConfigId: args.webhookConfigId,
      createdBy: args.adminUserId,
    });

    if (logSaved) {
      logMappings += 1;
    }

    mappedCount += 1;
    mappedStoreIds.push(storeId);
  }

  return {
    mappedCount,
    mappedStoreIds,
    storeColumnUpdates,
    logMappings,
    skippedAlreadyMapped,
    forceReboundCount,
  };
};

const loadWebhookConfigForDispatch = async (id: string) => {
  const candidates = [
    "id,target_url,method,headers,enabled,scope",
    "id,target_url,method,headers,enabled",
    "id,target_url,method,enabled,scope",
    "id,target_url,method,enabled",
    "id,target_url,method,headers",
    "id,target_url,method",
  ] as const;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin
      .from("webhook_configs")
      .select(select)
      .eq("id", id)
      .maybeSingle<WebhookConfigForDispatch>();

    if (!error) {
      return data;
    }

    if (!isRecoverableColumnError(error)) {
      throw new Error(error.message ?? "webhook config could not be loaded");
    }
  }

  return null;
};

const persistDirectBootstrapLog = async (args: {
  url: string;
  method: "GET" | "POST";
  storeId: string;
  webhookConfigId: string;
  responseStatus: number | null;
  responseBody: string | null;
  durationMs: number;
  createdBy: string;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      request_url: args.url,
      request_method: "DIRECT_BOOTSTRAP",
      request_headers: {},
      request_body: {
        client_id: args.storeId,
        webhook_config_id: args.webhookConfigId,
      },
      response_status: args.responseStatus,
      response_body: args.responseBody,
      duration_ms: args.durationMs,
      created_by: args.createdBy,
    },
    {
      request_url: args.url,
      request_method: "DIRECT_BOOTSTRAP",
      request_body: {
        client_id: args.storeId,
        webhook_config_id: args.webhookConfigId,
      },
      response_status: args.responseStatus,
      response_body: args.responseBody,
      duration_ms: args.durationMs,
    },
  ];

  for (const payload of payloads) {
    const { error } = await supabaseAdmin.from("webhook_logs").insert(payload);
    if (!error) {
      return;
    }
    if (!isRecoverableColumnError(error)) {
      return;
    }
  }
};

const triggerDirectBootstrapDispatch = async (args: {
  webhookConfigId: string;
  storeIds: string[];
  createdBy: string;
}) => {
  if (!args.storeIds.length) {
    return { attempted: 0, success: 0, failed: 0 };
  }

  const webhook = await loadWebhookConfigForDispatch(args.webhookConfigId);
  if (!webhook || webhook.enabled === false || webhook.scope === "generic") {
    return { attempted: 0, success: 0, failed: 0 };
  }

  const method = webhook.method?.toUpperCase() === "GET" ? "GET" : "POST";
  let attempted = 0;
  let success = 0;
  let failed = 0;

  for (const storeId of args.storeIds.slice(0, 100)) {
    attempted += 1;
    const startedAt = Date.now();
    const idempotencyKey = `direct_bootstrap:${storeId}:${args.webhookConfigId}:${Math.floor(Date.now() / 60_000)}`;

    try {
      const dispatch = await dispatchN8nTrigger({
        url: webhook.target_url,
        method,
        headers: webhook.headers ?? {},
        payload: { client_id: storeId },
        idempotencyKey,
        triggeredAt: new Date().toISOString(),
      });

      if (dispatch.ok) {
        success += 1;
      } else {
        failed += 1;
      }

      await persistDirectBootstrapLog({
        url: webhook.target_url,
        method,
        storeId,
        webhookConfigId: args.webhookConfigId,
        responseStatus: dispatch.status,
        responseBody: dispatch.body,
        durationMs: Date.now() - startedAt,
        createdBy: args.createdBy,
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "direct bootstrap failed";
      await persistDirectBootstrapLog({
        url: webhook.target_url,
        method,
        storeId,
        webhookConfigId: args.webhookConfigId,
        responseStatus: null,
        responseBody: message,
        durationMs: Date.now() - startedAt,
        createdBy: args.createdBy,
      });
    }
  }

  return {
    attempted,
    success,
    failed,
  };
};

const resolveProductTitle = async (productId: string) => {
  const candidates = [
    "id,title_tr,title_en",
    "id,title_tr",
    "id,title",
  ] as const;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select(select)
      .eq("id", productId)
      .maybeSingle();

    if (!error) {
      if (!data) {
        throw new Error("Seçilen alt ürün bulunamadı.");
      }

      const row = data as { title_tr?: string | null; title_en?: string | null; title?: string | null };
      const title = row.title_tr?.trim() || row.title_en?.trim() || row.title?.trim();
      if (!title) {
        throw new Error("Seçilen alt ürünün başlığı bulunamadı.");
      }
      return title;
    }

    if (!isRecoverableColumnError(error)) {
      throw new Error(error.message);
    }
  }

  throw new Error("Alt ürün başlığı çözümlenemedi.");
};

const parseBody = async (raw: ConfigPayload) => {
  const targetUrl = typeof raw.targetUrl === "string" ? raw.targetUrl.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const productId = typeof raw.productId === "string" && raw.productId.trim() ? raw.productId.trim() : null;

  if (!targetUrl) {
    throw new Error("targetUrl is required");
  }

  if (!productId) {
    throw new Error("Alt ürün seçimi zorunlu.");
  }

  const derivedTitle = await resolveProductTitle(productId);
  const manualName = typeof raw.name === "string" ? raw.name.trim() : "";

  return {
    name: manualName || derivedTitle,
    target_url: targetUrl,
    method: parseMethod(raw.method),
    headers: parseHeaders(raw.headers),
    description: description || null,
    scope: "automation" as const,
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    product_id: productId,
  };
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  const candidates = [
    { select: "id,name,description,scope,target_url,method,headers,enabled,product_id,created_at,updated_at", hasScope: true },
    { select: "id,name,description,scope,target_url,method,headers,enabled,created_at,updated_at", hasScope: true },
    { select: "id,name,target_url,method,headers,enabled,product_id,created_at,updated_at", hasScope: false },
    { select: "id,name,target_url,method,headers,enabled,created_at,updated_at", hasScope: false },
  ] as const;

  for (const candidate of candidates) {
    let query = supabaseAdmin
      .from("webhook_configs")
      .select(candidate.select)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (candidate.hasScope) {
      query = query.eq("scope", "automation");
    }

    const { data, error } = await query;

    if (!error) {
      return NextResponse.json({ rows: data ?? [] });
    }

    if (!isRecoverableColumnError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ rows: [] });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  try {
    const body = (await request.json()) as ConfigPayload;
    const payload = await parseBody(body);

    const nowIso = new Date().toISOString();
    const insertCandidates: Array<Record<string, unknown>> = [
      {
        ...payload,
        updated_at: nowIso,
      },
      {
        name: payload.name,
        target_url: payload.target_url,
        method: payload.method,
        headers: payload.headers,
        enabled: payload.enabled,
        scope: payload.scope,
        product_id: payload.product_id,
      },
      {
        name: payload.name,
        target_url: payload.target_url,
        method: payload.method,
        headers: payload.headers,
        enabled: payload.enabled,
        scope: payload.scope,
        updated_at: nowIso,
      },
      {
        name: payload.name,
        target_url: payload.target_url,
        method: payload.method,
        headers: payload.headers,
        enabled: payload.enabled,
        scope: payload.scope,
      },
      {
        name: payload.name,
        target_url: payload.target_url,
        method: payload.method,
        headers: payload.headers,
        enabled: payload.enabled,
        updated_at: nowIso,
      },
      {
        name: payload.name,
        target_url: payload.target_url,
        method: payload.method,
        headers: payload.headers,
        enabled: payload.enabled,
      },
    ];

    let lastError: QueryError | null = null;

    for (const candidate of insertCandidates) {
      const { data, error } = await supabaseAdmin
        .from("webhook_configs")
        .insert(candidate)
        .select("id")
        .maybeSingle<{ id: string }>();

      if (!error) {
        if (data?.id) {
          await persistWebhookConfigProductMap({
            webhookConfigId: data.id,
            productId: payload.product_id,
            createdBy: admin.user.id,
          });
        }
        const autoBind = ENABLE_AUTOBIND_ON_WEBHOOK_CREATE && data?.id && payload.enabled
          ? await autoBindWebhookToActiveStores({
              webhookConfigId: data.id,
              adminUserId: admin.user.id,
            })
          : { mappedCount: 0, mappedStoreIds: [], storeColumnUpdates: 0, logMappings: 0, skippedAlreadyMapped: 0, forceReboundCount: 0 };
        const directBootstrap =
          ENABLE_DIRECT_BOOTSTRAP_ON_WEBHOOK_CREATE && data?.id && payload.enabled
            ? await triggerDirectBootstrapDispatch({
                webhookConfigId: data.id,
                storeIds: autoBind.mappedStoreIds,
                createdBy: admin.user.id,
              })
            : { attempted: 0, success: 0, failed: 0 };
        const cronSync = ENABLE_CRON_SYNC_ON_WEBHOOK_CREATE
          ? await syncSchedulerCronJobLifecycle()
          : {
              ok: true as const,
              status: "noop" as const,
              message:
                "Webhook kaydedildi. Cron yalnız mağazaya bağlandığında veya ilgili mağazada abonelik ödeme aktivasyonu tamamlandığında başlatılır.",
            };
        return NextResponse.json({ row: data, cronSync, autoBind, directBootstrap });
      }

      if (error.code === "23505") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }

      lastError = error;

      if (!isRecoverableColumnError(error)) {
        break;
      }
    }

    return NextResponse.json({ error: lastError?.message || "Config create failed" }, { status: 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Config create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
