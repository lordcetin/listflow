import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { getSubscriptionMonthIndex } from "@/lib/admin/automation";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";
import { dispatchN8nTrigger } from "@/lib/n8n/client";
import { createManualSwitchIdempotencyKey } from "@/lib/scheduler/idempotency";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";

type StoreRow = {
  id: string;
  user_id: string;
  product_id?: string | null;
  active_webhook_config_id?: string | null;
};

type SubscriptionRow = {
  id: string;
  plan: string;
  status: string;
  created_at: string | null;
  current_period_end: string | null;
  store_id?: string | null;
  shop_id?: string | null;
};

type WebhookConfigRow = {
  id: string;
  name: string;
  target_url: string;
  method: string | null;
  headers: Record<string, unknown> | null;
  enabled: boolean | null;
  product_id?: string | null;
  scope?: string | null;
};

const isMissingColumnError = (error: { message?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isMissingTableError = (error: { message?: string } | null | undefined, tableName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  const table = tableName.toLowerCase();
  return (
    (message.includes("relation") && message.includes(table)) ||
    (message.includes("could not find the table") && message.includes(table))
  );
};

const isMissingAnyColumnError = (error: { message?: string } | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const insertSchedulerJobWithFallback = async (args: {
  subscriptionId: string;
  userId: string;
  storeId: string;
  webhookConfigId: string;
  plan: string;
  idempotencyKey: string;
  runAt: string;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: "processing",
      trigger_type: "manual_switch",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
      request_payload: { client_id: args.storeId },
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: "processing",
      trigger_type: "manual_switch",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: "processing",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      plan: args.plan,
      status: "processing",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAt,
    },
  ];

  let lastError: string | null = null;

  for (const payload of payloads) {
    const attempt = await supabaseAdmin
      .from("scheduler_jobs")
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (!attempt.error) {
      return { id: attempt.data?.id ?? null, error: null as string | null };
    }

    const toleratedMissingColumn = isMissingAnyColumnError(attempt.error, [
      "request_payload",
      "trigger_type",
      "webhook_config_id",
      "store_id",
    ]);

    if (!toleratedMissingColumn) {
      return { id: null, error: attempt.error.message };
    }

    lastError = attempt.error.message;
  }

  return { id: null, error: lastError ?? "scheduler_jobs insert failed" };
};

const updateSchedulerJobWithFallback = async (jobId: string, patch: {
  status: string;
  responseStatus?: number | null;
  responsePayload?: string | null;
  errorMessage?: string | null;
}) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, unknown>> = [
    {
      status: patch.status,
      response_status: patch.responseStatus ?? null,
      response_payload: patch.responsePayload ?? null,
      error_message: patch.errorMessage ?? null,
      updated_at: nowIso,
    },
    {
      status: patch.status,
      response_status: patch.responseStatus ?? null,
      error_message: patch.errorMessage ?? null,
      updated_at: nowIso,
    },
    {
      status: patch.status,
      response_payload: patch.responsePayload ?? null,
      error_message: patch.errorMessage ?? null,
      updated_at: nowIso,
    },
    {
      status: patch.status,
      error_message: patch.errorMessage ?? null,
      updated_at: nowIso,
    },
    {
      status: patch.status,
      error_message: patch.errorMessage ?? null,
    },
    {
      status: patch.status,
    },
  ];

  for (const payload of payloads) {
    const attempt = await supabaseAdmin.from("scheduler_jobs").update(payload).eq("id", jobId);
    if (!attempt.error) {
      return;
    }

    const toleratedMissingColumn = isMissingAnyColumnError(attempt.error, [
      "response_status",
      "response_payload",
      "error_message",
      "updated_at",
    ]);

    if (!toleratedMissingColumn) {
      throw new Error(attempt.error.message);
    }
  }
};

const loadActiveSubscriptionForStore = async (storeId: string) => {
  const withStoreId = await supabaseAdmin
    .from("subscriptions")
    .select("id, plan, status, created_at, current_period_end, store_id")
    .eq("store_id", storeId)
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>();

  if (!withStoreId.error) {
    return withStoreId.data;
  }

  if (!isMissingColumnError(withStoreId.error, "store_id")) {
    throw new Error(withStoreId.error.message);
  }

  const fallback = await supabaseAdmin
    .from("subscriptions")
    .select("id, plan, status, created_at, current_period_end, shop_id")
    .eq("shop_id", storeId)
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>();

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return fallback.data;
};

const loadWebhookConfig = async (id: string) => {
  const withScope = await supabaseAdmin
    .from("webhook_configs")
    .select("id, name, target_url, method, headers, enabled, scope, product_id")
    .eq("id", id)
    .maybeSingle<WebhookConfigRow>();

  if (!withScope.error) {
    if (!withScope.data) {
      return null;
    }

    if (!withScope.data.product_id) {
      const map = await loadWebhookConfigProductMap([withScope.data.id]);
      return {
        ...withScope.data,
        product_id: map.get(withScope.data.id) ?? null,
      };
    }

    return withScope.data;
  }

  if (!isMissingColumnError(withScope.error, "scope")) {
    throw new Error(withScope.error.message);
  }

  const fallback = await supabaseAdmin
    .from("webhook_configs")
    .select("id, name, target_url, method, headers, enabled")
    .eq("id", id)
    .maybeSingle<WebhookConfigRow>();

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  if (!fallback.data) {
    return null;
  }

  const map = await loadWebhookConfigProductMap([fallback.data.id]);

  return {
    ...fallback.data,
    scope: "automation",
    product_id: map.get(fallback.data.id) ?? null,
  } satisfies WebhookConfigRow;
};

const loadStoreById = async (storeId: string) => {
  const candidates = [
    {
      select: "id, user_id, product_id, active_webhook_config_id",
      hasProductColumn: true,
      hasActiveWebhookColumn: true,
    },
    {
      select: "id, user_id, active_webhook_config_id",
      hasProductColumn: false,
      hasActiveWebhookColumn: true,
    },
    {
      select: "id, user_id, product_id",
      hasProductColumn: true,
      hasActiveWebhookColumn: false,
    },
    {
      select: "id, user_id",
      hasProductColumn: false,
      hasActiveWebhookColumn: false,
    },
  ] as const;

  let lastErrorMessage: string | null = null;

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(candidate.select)
      .eq("id", storeId)
      .maybeSingle<{
        id: string;
        user_id: string;
        product_id?: string | null;
        active_webhook_config_id?: string | null;
      }>();

    if (!query.error) {
      if (!query.data) {
        return { data: null, error: null as string | null };
      }

      return {
        data: {
          id: query.data.id,
          user_id: query.data.user_id,
          product_id: candidate.hasProductColumn ? query.data.product_id ?? null : null,
          active_webhook_config_id: candidate.hasActiveWebhookColumn ? query.data.active_webhook_config_id ?? null : null,
        } as StoreRow,
        error: null as string | null,
      };
    }

    lastErrorMessage = query.error.message;

    const recoverable = isMissingAnyColumnError(query.error, ["product_id", "active_webhook_config_id"]);
    if (!recoverable) {
      return { data: null, error: query.error.message };
    }
  }

  return { data: null, error: lastErrorMessage ?? "stores row could not be loaded" };
};

const persistFallbackStoreWebhookMapping = async (args: {
  storeId: string;
  webhookConfigId: string;
  createdBy: string;
  idempotencyKey: string;
}) => {
  await supabaseAdmin.from("webhook_logs").insert({
    request_url: "store-webhook-mapping",
    request_method: "STORE_WEBHOOK_MAP",
    request_headers: {},
    request_body: {
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      idempotency_key: args.idempotencyKey,
    },
    response_status: 200,
    response_body: "mapping_saved",
    duration_ms: 0,
    created_by: args.createdBy,
  });
};

const updateStoreAutomationBindingWithFallback = async (args: {
  storeId: string;
  webhookConfigId: string;
  productId: string | null;
  nowIso: string;
  updatedBy: string;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      product_id: args.productId,
      active_webhook_config_id: args.webhookConfigId,
      automation_updated_at: args.nowIso,
      automation_updated_by: args.updatedBy,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
      automation_updated_at: args.nowIso,
      automation_updated_by: args.updatedBy,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
      automation_updated_at: args.nowIso,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
    },
  ];

  let lastError: string | null = null;

  for (const payload of payloads) {
    const update = await supabaseAdmin.from("stores").update(payload).eq("id", args.storeId);

    if (!update.error) {
      return { error: null as string | null };
    }

    const recoverable = isMissingAnyColumnError(update.error, [
      "product_id",
      "active_webhook_config_id",
      "automation_updated_at",
      "automation_updated_by",
    ]);

    if (!recoverable) {
      return { error: update.error.message };
    }

    lastError = update.error.message;
  }

  return { error: lastError };
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const { id: storeId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    targetWebhookConfigId?: string;
  };
  const targetWebhookConfigId = body.targetWebhookConfigId?.trim();

  if (!targetWebhookConfigId) {
    return NextResponse.json({ error: "targetWebhookConfigId is required" }, { status: 400 });
  }

  try {
    const { data: store, error: storeError } = await loadStoreById(storeId);

    if (storeError) {
      return NextResponse.json({ error: storeError }, { status: 500 });
    }

    if (!store) {
      return notFoundResponse();
    }

    const activeSubscription = await loadActiveSubscriptionForStore(store.id);

    if (!activeSubscription) {
      return NextResponse.json({ error: "Aktif veya deneme aboneliği bulunamadı." }, { status: 400 });
    }

    const monthIndex = getSubscriptionMonthIndex(activeSubscription.created_at);

    const targetWebhook = await loadWebhookConfig(targetWebhookConfigId);

    if (!targetWebhook) {
      return NextResponse.json(
        {
          code: "WEBHOOK_NOT_FOUND",
          message: "Hedef webhook bulunamadı.",
          error: "Hedef webhook bulunamadı.",
        },
        { status: 404 }
      );
    }

    if (!targetWebhook.enabled) {
      return NextResponse.json(
        {
          code: "WEBHOOK_DISABLED",
          message: `Hedef webhook pasif durumda: ${targetWebhook.name} (${targetWebhook.id}).`,
          error: "Hedef webhook pasif durumda.",
        },
        { status: 400 }
      );
    }

    if (targetWebhook.scope && targetWebhook.scope !== "automation") {
      return NextResponse.json(
        {
          code: "WEBHOOK_SCOPE_INVALID",
          message: `Hedef webhook automation scope'unda değil: ${targetWebhook.name} (${targetWebhook.id}).`,
          error: "Hedef webhook scope=automation olmalı.",
        },
        { status: 400 }
      );
    }

    const effectiveProductId = targetWebhook.product_id ?? store.product_id ?? null;

    const idempotencyKey = createManualSwitchIdempotencyKey(store.id, targetWebhook.id);
    const existingJob = await supabaseAdmin
      .from("scheduler_jobs")
      .select("id, status")
      .eq("idempotency_key", idempotencyKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; status: string }>();

    if (existingJob.data && ["processing", "success"].includes(existingJob.data.status)) {
      return NextResponse.json(
        {
          code: "MANUAL_SWITCH_DUPLICATE",
          message: "Aynı geçiş isteği bu dakika içinde zaten işlendi.",
          error: "Aynı geçiş isteği bu dakika içinde zaten işlendi.",
          idempotencyKey,
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const transitionInsert = await supabaseAdmin
      .from("store_automation_transitions")
      .insert({
        store_id: store.id,
        subscription_id: activeSubscription.id,
        from_webhook_config_id: store.active_webhook_config_id,
        to_webhook_config_id: targetWebhook.id,
        month_index: monthIndex,
        status: "processing",
        created_by: admin.user.id,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (transitionInsert.error && !isMissingTableError(transitionInsert.error, "store_automation_transitions")) {
      return NextResponse.json({ error: transitionInsert.error.message }, { status: 500 });
    }

    const transitionId = transitionInsert.data?.id ?? null;

    const storeUpdate = await updateStoreAutomationBindingWithFallback({
      storeId: store.id,
      webhookConfigId: targetWebhook.id,
      productId: effectiveProductId,
      nowIso,
      updatedBy: admin.user.id,
    });

    if (storeUpdate.error && !isMissingAnyColumnError({ message: storeUpdate.error }, ["product_id", "active_webhook_config_id", "automation_updated_at", "automation_updated_by"])) {
      if (transitionId) {
        await supabaseAdmin
          .from("store_automation_transitions")
          .update({
            status: "failed",
            trigger_response_body: storeUpdate.error,
          })
          .eq("id", transitionId);
      }

      return NextResponse.json({ error: storeUpdate.error }, { status: 500 });
    }

    // Legacy schema fallback: scheduler can read latest mapping from webhook_logs when stores mapping columns do not exist.
    await persistFallbackStoreWebhookMapping({
      storeId: store.id,
      webhookConfigId: targetWebhook.id,
      createdBy: admin.user.id,
      idempotencyKey,
    });
    const cronSync = await syncSchedulerCronJobLifecycle();

    const schedulerJobInsert = await insertSchedulerJobWithFallback({
      subscriptionId: activeSubscription.id,
      userId: store.user_id,
      storeId: store.id,
      webhookConfigId: targetWebhook.id,
      plan: activeSubscription.plan,
      idempotencyKey,
      runAt: nowIso,
    });

    if (schedulerJobInsert.error) {
      if (transitionId) {
        await supabaseAdmin
          .from("store_automation_transitions")
          .update({
            status: "failed",
            trigger_response_body: schedulerJobInsert.error,
          })
          .eq("id", transitionId);
      }

      return NextResponse.json({ error: schedulerJobInsert.error }, { status: 500 });
    }

    const schedulerJobId = schedulerJobInsert.id;

    try {
      const dispatchResult = await dispatchN8nTrigger({
        url: targetWebhook.target_url,
        method: targetWebhook.method === "GET" ? "GET" : "POST",
        headers: targetWebhook.headers ?? {},
        payload: {
          client_id: store.id,
        },
        idempotencyKey,
        triggeredAt: nowIso,
      });

      if (schedulerJobId) {
        await updateSchedulerJobWithFallback(schedulerJobId, {
          status: dispatchResult.ok ? "success" : "failed",
          responseStatus: dispatchResult.status,
          responsePayload: dispatchResult.body,
        });
      }

      if (transitionId) {
        await supabaseAdmin
          .from("store_automation_transitions")
          .update({
            status: dispatchResult.ok ? "success" : "failed",
            trigger_response_status: dispatchResult.status,
            trigger_response_body: dispatchResult.body,
          })
          .eq("id", transitionId);
      }

      return NextResponse.json({
        success: dispatchResult.ok,
        idempotencyKey,
        storeId: store.id,
        cronSync,
        transitionId: transitionId ?? null,
        schedulerJobId,
        monthIndex,
        targetWebhook: {
          id: targetWebhook.id,
          name: targetWebhook.name,
        },
        dispatch: {
          status: dispatchResult.status,
          body: dispatchResult.body,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Manual switch dispatch failed";

      if (schedulerJobId) {
        await updateSchedulerJobWithFallback(schedulerJobId, {
          status: "failed",
          errorMessage: message,
        });
      }

      if (transitionId) {
        await supabaseAdmin
          .from("store_automation_transitions")
          .update({
            status: "failed",
            trigger_response_body: message,
          })
          .eq("id", transitionId);
      }

      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manual switch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
