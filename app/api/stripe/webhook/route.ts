import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";
import { serverEnv } from "@/lib/env/server";
import { getPlanCentsByInterval, getStripeClientForMode } from "@/lib/stripe/client";
import { syncOneTimeCheckoutPayment } from "@/lib/stripe/checkout-payment-sync";
import { dispatchN8nTrigger } from "@/lib/n8n/client";
import { createActivationIdempotencyKey } from "@/lib/scheduler/idempotency";
import { findFirstProfileUserIdByEmail, syncProfileSubscriptionState } from "@/lib/subscription/profile-sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";
import { loadWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";

export const runtime = "nodejs";

const getStripe = () => getStripeClientForMode();
const ENABLE_STRIPE_ACTIVATION_AUTOMATION_DISPATCH = true;

const toIsoDate = (value: number | null | undefined) => {
  if (!value) {
    return null;
  }

  return new Date(value * 1000).toISOString();
};

const resolveSubscriptionPeriodEnd = (subscription: Stripe.Subscription) => {
  return subscription.items.data[0]?.current_period_end ?? null;
};

const resolveCustomerEmail = async (
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
) => {
  if (!customer) {
    return null;
  }

  if (typeof customer === "object") {
    if ("deleted" in customer && customer.deleted) {
      return null;
    }

    return customer.email ?? null;
  }

  try {
    const fetched = await getStripe().customers.retrieve(customer);
    if ("deleted" in fetched && fetched.deleted) {
      return null;
    }

    return fetched.email ?? null;
  } catch {
    return null;
  }
};

const isMissingRelationError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  if (error.code === "42P01") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
};

const isMissingColumnError = (
  error: { message?: string; code?: string } | null | undefined,
  columnName: string
) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isMissingOnConflictConstraintError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  return (error.message ?? "").toLowerCase().includes("no unique or exclusion constraint matching");
};

const throwSupabaseError = (context: string, error: { message?: string } | null | undefined) => {
  if (!error) {
    return;
  }

  throw new Error(`${context}: ${error.message ?? "Unknown database error"}`);
};

const isMissingAnyColumnError = (
  error: { message?: string; code?: string } | null | undefined,
  columns: string[]
) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const isUniqueViolation = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "23505" || message.includes("duplicate");
};

const loadStoreWebhookMappingFromLogs = async (storeId: string) => {
  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("request_body, request_url, created_at")
    .eq("request_method", "STORE_WEBHOOK_MAP")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    return null;
  }

  for (const row of (data ?? []) as Array<{ request_body: unknown; request_url?: string | null }>) {
    const body =
      typeof row.request_body === "object" && row.request_body !== null
        ? (row.request_body as Record<string, unknown>)
        : null;
    if (!body) continue;

    const sourceUrl = typeof row.request_url === "string" ? row.request_url : null;
    const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : null;
    const isManualBinding = sourceUrl === "store-webhook-mapping" || (idempotencyKey?.startsWith("manual_switch:") ?? false);
    const isActivationBinding =
      sourceUrl === "store-webhook-mapping-activation" || (idempotencyKey?.startsWith("activation:") ?? false);
    if (!isManualBinding && !isActivationBinding) continue;

    if (body.store_id !== storeId) continue;
    const webhookConfigId = typeof body.webhook_config_id === "string" ? body.webhook_config_id : null;
    if (webhookConfigId) return webhookConfigId;
  }

  return null;
};

const loadStoreWebhookConfigId = async (storeId: string) => {
  const withColumn = await supabaseAdmin
    .from("stores")
    .select("id, active_webhook_config_id")
    .eq("id", storeId)
    .maybeSingle<{ id: string; active_webhook_config_id: string | null }>();

  if (!withColumn.error) {
    return withColumn.data?.active_webhook_config_id ?? null;
  }

  if (!isMissingColumnError(withColumn.error, "active_webhook_config_id")) {
    throw new Error(withColumn.error.message);
  }

  return loadStoreWebhookMappingFromLogs(storeId);
};

const loadAutomationWebhookConfig = async (id: string) => {
  const withScope = await supabaseAdmin
    .from("webhook_configs")
    .select("id, target_url, method, headers, enabled, scope")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      target_url: string;
      method: string | null;
      headers: Record<string, unknown> | null;
      enabled: boolean | null;
      scope?: string | null;
    }>();

  if (!withScope.error) {
    return withScope.data;
  }

  if (!isMissingColumnError(withScope.error, "scope")) {
    throw new Error(withScope.error.message);
  }

  const fallback = await supabaseAdmin
    .from("webhook_configs")
    .select("id, target_url, method, headers, enabled")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      target_url: string;
      method: string | null;
      headers: Record<string, unknown> | null;
      enabled: boolean | null;
    }>();

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  if (!fallback.data) {
    return null;
  }

  return { ...fallback.data, scope: "automation" };
};

const loadStoreActivationBinding = async (storeId: string) => {
  const candidates = [
    { select: "id,product_id,active_webhook_config_id", hasProduct: true, hasActiveWebhook: true },
    { select: "id,product_id", hasProduct: true, hasActiveWebhook: false },
    { select: "id,active_webhook_config_id", hasProduct: false, hasActiveWebhook: true },
    { select: "id", hasProduct: false, hasActiveWebhook: false },
  ] as const;

  for (const candidate of candidates) {
    const query = await supabaseAdmin
      .from("stores")
      .select(candidate.select)
      .eq("id", storeId)
      .maybeSingle<{ id: string; product_id?: string | null; active_webhook_config_id?: string | null }>();

    if (!query.error) {
      return {
        productId: candidate.hasProduct ? query.data?.product_id ?? null : null,
        activeWebhookConfigId: candidate.hasActiveWebhook ? query.data?.active_webhook_config_id ?? null : null,
      };
    }

    if (!isMissingAnyColumnError(query.error, ["product_id", "active_webhook_config_id"])) {
      throw new Error(query.error.message);
    }
  }

  return {
    productId: null,
    activeWebhookConfigId: null,
  };
};

const resolveWebhookByProduct = async (productId: string) => {
  const withProductScope = await supabaseAdmin
    .from("webhook_configs")
    .select("id,target_url,method,headers,enabled,scope,product_id")
    .eq("enabled", true)
    .eq("scope", "automation")
    .eq("product_id", productId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      target_url: string;
      method: string | null;
      headers: Record<string, unknown> | null;
      enabled: boolean | null;
      scope?: string | null;
      product_id?: string | null;
    }>();

  if (!withProductScope.error) {
    return withProductScope.data?.id ?? null;
  }

  if (!isMissingAnyColumnError(withProductScope.error, ["scope", "product_id"])) {
    throw new Error(withProductScope.error.message);
  }

  const fallbackRows = await supabaseAdmin
    .from("webhook_configs")
    .select("id,target_url,method,headers,enabled,scope")
    .eq("enabled", true)
    .order("updated_at", { ascending: false })
    .limit(5000);

  if (fallbackRows.error) {
    throw new Error(fallbackRows.error.message);
  }

  const candidates = (fallbackRows.data ?? []) as Array<{
    id: string;
    scope?: string | null;
    target_url?: string | null;
  }>;
  const activeAutomationConfigIds = candidates
    .filter((row) => Boolean(row.target_url) && (row.scope ?? "automation") !== "generic")
    .map((row) => row.id);

  if (!activeAutomationConfigIds.length) {
    return null;
  }

  const productMap = await loadWebhookConfigProductMap(activeAutomationConfigIds);
  for (const id of activeAutomationConfigIds) {
    if (productMap.get(id) === productId) {
      return id;
    }
  }

  return null;
};

const persistActivationStoreWebhookMapping = async (args: {
  storeId: string;
  webhookConfigId: string;
  idempotencyKey: string;
  createdBy: string | null;
}) => {
  const payload = {
    store_id: args.storeId,
    webhook_config_id: args.webhookConfigId,
    idempotency_key: args.idempotencyKey,
  };

  const candidates: Array<Record<string, unknown>> = [
    {
      request_url: "store-webhook-mapping-activation",
      request_method: "STORE_WEBHOOK_MAP",
      request_headers: {},
      request_body: payload,
      response_status: 200,
      response_body: "mapping_saved",
      duration_ms: 0,
      created_by: args.createdBy,
    },
    {
      request_url: "store-webhook-mapping-activation",
      request_method: "STORE_WEBHOOK_MAP",
      request_body: payload,
    },
  ];

  for (const candidate of candidates) {
    const { error } = await supabaseAdmin.from("webhook_logs").insert(candidate);
    if (!error) return;
    if (!isMissingAnyColumnError(error, ["request_headers", "response_status", "response_body", "duration_ms", "created_by"])) {
      throw new Error(error.message);
    }
  }
};

const updateStoreActivationBinding = async (args: {
  storeId: string;
  webhookConfigId: string;
  productId: string | null;
  userId: string | null;
}) => {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, unknown>> = [
    {
      active_webhook_config_id: args.webhookConfigId,
      product_id: args.productId,
      automation_updated_at: nowIso,
      automation_updated_by: args.userId,
    },
    {
      active_webhook_config_id: args.webhookConfigId,
      product_id: args.productId,
      automation_updated_at: nowIso,
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
    const attempt = await supabaseAdmin.from("stores").update(payload).eq("id", args.storeId);
    if (!attempt.error) return;

    if (!isMissingAnyColumnError(attempt.error, ["active_webhook_config_id", "product_id", "automation_updated_at", "automation_updated_by"])) {
      throw new Error(attempt.error.message);
    }
  }
};

const ensureActivationWebhookBinding = async (args: {
  storeId: string;
  userId: string | null;
  idempotencyKey: string;
}) => {
  const storeBinding = await loadStoreActivationBinding(args.storeId);
  const explicitWebhookId = storeBinding.activeWebhookConfigId;

  if (explicitWebhookId) {
    const explicitWebhook = await loadAutomationWebhookConfig(explicitWebhookId);
    if (explicitWebhook && explicitWebhook.enabled && explicitWebhook.scope !== "generic") {
      return explicitWebhookId;
    }
  }

  if (!storeBinding.productId) {
    return loadStoreWebhookConfigId(args.storeId);
  }

  const webhookConfigId = await resolveWebhookByProduct(storeBinding.productId);
  if (!webhookConfigId) {
    return loadStoreWebhookConfigId(args.storeId);
  }

  await updateStoreActivationBinding({
    storeId: args.storeId,
    webhookConfigId,
    productId: storeBinding.productId,
    userId: args.userId,
  });

  await persistActivationStoreWebhookMapping({
    storeId: args.storeId,
    webhookConfigId,
    idempotencyKey: args.idempotencyKey,
    createdBy: args.userId,
  });

  return webhookConfigId;
};

const insertSchedulerActivationJobWithFallback = async (args: {
  subscriptionId: string;
  userId: string | null;
  storeId: string;
  plan: string;
  webhookConfigId: string | null;
  idempotencyKey: string;
  runAtIso: string;
  status: "processing" | "skipped";
  errorMessage?: string | null;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: args.status,
      trigger_type: "activation",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAtIso,
      request_payload: { client_id: args.storeId },
      error_message: args.errorMessage ?? null,
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: args.status,
      trigger_type: "activation",
      idempotency_key: args.idempotencyKey,
      run_at: args.runAtIso,
      error_message: args.errorMessage ?? null,
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      store_id: args.storeId,
      webhook_config_id: args.webhookConfigId,
      plan: args.plan,
      status: args.status,
      idempotency_key: args.idempotencyKey,
      run_at: args.runAtIso,
      error_message: args.errorMessage ?? null,
    },
    {
      subscription_id: args.subscriptionId,
      user_id: args.userId,
      plan: args.plan,
      status: args.status,
      idempotency_key: args.idempotencyKey,
      run_at: args.runAtIso,
      error_message: args.errorMessage ?? null,
    },
  ];

  let lastError: { message?: string; code?: string } | null = null;

  for (const payload of payloads) {
    const insert = await supabaseAdmin
      .from("scheduler_jobs")
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (!insert.error) {
      return { id: insert.data?.id ?? null };
    }

    if (isUniqueViolation(insert.error)) {
      return { id: null, duplicated: true };
    }

    lastError = insert.error;

    if (
      !isMissingAnyColumnError(insert.error, [
        "store_id",
        "webhook_config_id",
        "trigger_type",
        "request_payload",
        "error_message",
      ])
    ) {
      throw new Error(insert.error.message);
    }
  }

  throw new Error(lastError?.message ?? "scheduler_jobs activation insert failed");
};

const updateSchedulerJobWithFallback = async (jobId: string, patch: {
  status: string;
  responseStatus?: number | null;
  responsePayload?: string | null;
  errorMessage?: string | null;
}) => {
  const payloads: Array<Record<string, unknown>> = [
    {
      status: patch.status,
      response_status: patch.responseStatus ?? null,
      response_payload: patch.responsePayload ?? null,
      error_message: patch.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      status: patch.status,
      response_status: patch.responseStatus ?? null,
      error_message: patch.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      status: patch.status,
      error_message: patch.errorMessage ?? null,
      updated_at: new Date().toISOString(),
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
    if (!attempt.error) return;

    if (!isMissingAnyColumnError(attempt.error, ["response_status", "response_payload", "error_message", "updated_at"])) {
      throw new Error(attempt.error.message);
    }
  }
};

const triggerActivationAutomation = async (args: {
  storeId: string;
  subscription: Stripe.Subscription;
  plan: string;
  userId: string | null;
}) => {
  const runAtIso = new Date().toISOString();
  const currentPeriodEndIso = toIsoDate(resolveSubscriptionPeriodEnd(args.subscription));
  const idempotencyKey = createActivationIdempotencyKey(
    args.subscription.id,
    args.storeId,
    currentPeriodEndIso
  );

  const activeWebhookConfigId = await ensureActivationWebhookBinding({
    storeId: args.storeId,
    userId: args.userId,
    idempotencyKey,
  });

  if (!activeWebhookConfigId) {
    await insertSchedulerActivationJobWithFallback({
      subscriptionId: args.subscription.id,
      userId: args.userId,
      storeId: args.storeId,
      plan: args.plan,
      webhookConfigId: null,
      idempotencyKey,
      runAtIso,
      status: "skipped",
      errorMessage: "no_active_webhook_config",
    });
    return;
  }

  const webhook = await loadAutomationWebhookConfig(activeWebhookConfigId);

  if (!webhook || !webhook.enabled || webhook.scope === "generic") {
    await insertSchedulerActivationJobWithFallback({
      subscriptionId: args.subscription.id,
      userId: args.userId,
      storeId: args.storeId,
      plan: args.plan,
      webhookConfigId: activeWebhookConfigId,
      idempotencyKey,
      runAtIso,
      status: "skipped",
      errorMessage: "inactive_or_invalid_webhook_config",
    });
    return;
  }

  const createdJob = await insertSchedulerActivationJobWithFallback({
    subscriptionId: args.subscription.id,
    userId: args.userId,
    storeId: args.storeId,
    plan: args.plan,
    webhookConfigId: activeWebhookConfigId,
    idempotencyKey,
    runAtIso,
    status: "processing",
  });

  if (createdJob.duplicated) {
    return;
  }

  if (!createdJob.id) {
    return;
  }

  try {
    const dispatch = await dispatchN8nTrigger({
      url: webhook.target_url,
      method: webhook.method === "GET" ? "GET" : "POST",
      headers: webhook.headers ?? {},
      payload: { client_id: args.storeId },
      idempotencyKey,
      triggeredAt: runAtIso,
    });

    await updateSchedulerJobWithFallback(createdJob.id, {
      status: dispatch.ok ? "success" : "failed",
      responseStatus: dispatch.status,
      responsePayload: dispatch.body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "activation dispatch failed";
    await updateSchedulerJobWithFallback(createdJob.id, {
      status: "failed",
      errorMessage: message,
    });
  }
};

const persistStripeEvent = async (event: Stripe.Event) => {
  const basePayload = {
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event,
    processed_at: new Date().toISOString(),
  };
  const withMode = await supabaseAdmin
    .from("stripe_event_logs")
    .insert({
      ...basePayload,
      stripe_mode: event.livemode ? "live" : "test",
    })
    .select("id")
    .maybeSingle();

  if (!withMode.error) {
    return { duplicated: false, id: withMode.data?.id };
  }

  if (withMode.error.message.toLowerCase().includes("duplicate") || withMode.error.code === "23505") {
    return { duplicated: true };
  }

  if (isMissingRelationError(withMode.error)) {
    throw new Error(
      "Missing table public.stripe_event_logs. Apply Supabase schema/migrations before processing Stripe webhooks."
    );
  }

  if (!isMissingColumnError(withMode.error, "stripe_mode")) {
    throw new Error(`Failed to persist Stripe event log: ${withMode.error.message}`);
  }

  const fallback = await supabaseAdmin
    .from("stripe_event_logs")
    .insert(basePayload)
    .select("id")
    .maybeSingle();

  if (fallback.error) {
    if (fallback.error.message.toLowerCase().includes("duplicate") || fallback.error.code === "23505") {
      return { duplicated: true };
    }

    if (isMissingRelationError(fallback.error)) {
      throw new Error(
        "Missing table public.stripe_event_logs. Apply Supabase schema/migrations before processing Stripe webhooks."
      );
    }

    throw new Error(`Failed to persist Stripe event log: ${fallback.error.message}`);
  }

  return { duplicated: false, id: fallback.data?.id };
};

const upsertSubscriptionFromStripe = async (
  subscription: Stripe.Subscription,
  metadata?: Stripe.Metadata | null,
  customerId?: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  subscriberEmail?: string | null,
  options?: {
    triggerActivationDispatch?: boolean;
  }
) => {
  const plan = (metadata?.plan as string | undefined) ?? "standard";
  const billingInterval = (metadata?.billingInterval as string | undefined) === "year" ? "year" : "month";
  const metadataUserId = metadata?.userId as string | undefined;
  const emailUserId = !metadataUserId && subscriberEmail ? await findFirstProfileUserIdByEmail(subscriberEmail) : null;
  const userId = metadataUserId ?? emailUserId ?? null;
  const shopId = metadata?.shopId as string | undefined;
  const storeId = isUuid(shopId) ? shopId : null;
  const stripeUnitAmount = subscription.items.data[0]?.price?.unit_amount ?? null;
  const stripeCustomerId = typeof customerId === "string"
    ? customerId
    : typeof subscription.customer === "string"
      ? subscription.customer
      : null;

  const payload = {
    user_id: userId,
    shop_id: shopId ?? null,
    store_id: storeId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    plan,
    status: subscription.status,
    current_period_end: toIsoDate(resolveSubscriptionPeriodEnd(subscription)),
    updated_at: new Date().toISOString(),
  };

  const upsertResult = await supabaseAdmin
    .from("subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (upsertResult.error) {
    if (!isMissingOnConflictConstraintError(upsertResult.error)) {
      throwSupabaseError("Failed to upsert subscription", upsertResult.error);
    }

    const existing = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle<{ id?: string }>();

    throwSupabaseError("Failed to read existing subscription fallback", existing.error);

    if (existing.data?.id) {
      const updated = await supabaseAdmin
        .from("subscriptions")
        .update(payload)
        .eq("id", existing.data.id);

      throwSupabaseError("Failed to update subscription fallback", updated.error);
    } else {
      const inserted = await supabaseAdmin
        .from("subscriptions")
        .insert(payload);

      throwSupabaseError("Failed to insert subscription fallback", inserted.error);
    }
  }

  if (storeId) {
    const fallbackPlan = (plan === "pro" || plan === "turbo" ? plan : "standard") as "standard" | "pro" | "turbo";
    const cents = stripeUnitAmount ?? getPlanCentsByInterval(fallbackPlan, billingInterval);

    const storeUpdate = await supabaseAdmin
      .from("stores")
      .update({
        status: subscription.status === "active" || subscription.status === "trialing" ? "active" : subscription.status,
        price_cents: cents,
      })
      .eq("id", storeId);

    throwSupabaseError("Failed to update store after subscription sync", storeUpdate.error);

    if (
      ENABLE_STRIPE_ACTIVATION_AUTOMATION_DISPATCH &&
      options?.triggerActivationDispatch === true &&
      (subscription.status === "active" || subscription.status === "trialing")
    ) {
      try {
        await triggerActivationAutomation({
          storeId,
          subscription,
          plan: fallbackPlan,
          userId,
        });
      } catch {
        // Activation dispatch should not block authoritative subscription sync.
      }
    }
  }

  await syncProfileSubscriptionState({
    userId,
    email: subscriberEmail ?? null,
    status: subscription.status,
    plan,
    stripeCustomerId,
  });
};

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(payload, signature, serverEnv.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const persisted = await persistStripeEvent(event);
    if (persisted.duplicated) {
      return NextResponse.json({ received: true, duplicated: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Event log persist failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    let shouldSyncCronLifecycle = false;

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.mode === "subscription" && typeof session.subscription === "string") {
          shouldSyncCronLifecycle = true;
          const subscription = await getStripe().subscriptions.retrieve(session.subscription);
          const subscriberEmail =
            session.customer_details?.email ??
            session.customer_email ??
            (await resolveCustomerEmail(session.customer));
          const mergedMetadata = {
            ...(subscription.metadata ?? {}),
            ...(session.metadata ?? {}),
          };
          await upsertSubscriptionFromStripe(subscription, mergedMetadata, session.customer, subscriberEmail, {
            triggerActivationDispatch: true,
          });
        }

        if (session.mode === "payment") {
          await syncOneTimeCheckoutPayment(session);
        }

        break;
      }
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "payment") {
          await syncOneTimeCheckoutPayment(session, { forcedStatus: "paid" });
        }
        break;
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "payment") {
          await syncOneTimeCheckoutPayment(session, { forcedStatus: "failed" });
        }
        break;
      }
      case "customer.subscription.created": {
        shouldSyncCronLifecycle = true;
        const subscription = event.data.object as Stripe.Subscription;
        const subscriberEmail = await resolveCustomerEmail(subscription.customer);
        await upsertSubscriptionFromStripe(subscription, subscription.metadata, subscription.customer, subscriberEmail, {
          triggerActivationDispatch: true,
        });
        break;
      }
      case "customer.subscription.updated": {
        shouldSyncCronLifecycle = true;
        const subscription = event.data.object as Stripe.Subscription;
        const subscriberEmail = await resolveCustomerEmail(subscription.customer);
        await upsertSubscriptionFromStripe(subscription, subscription.metadata, subscription.customer, subscriberEmail, {
          triggerActivationDispatch: false,
        });
        break;
      }
      case "customer.subscription.deleted": {
        shouldSyncCronLifecycle = true;
        const subscription = event.data.object as Stripe.Subscription;
        const existingSubscription = await supabaseAdmin
          .from("subscriptions")
          .select("user_id, plan, stripe_customer_id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle<{ user_id?: string | null; plan?: string | null; stripe_customer_id?: string | null }>();

        throwSupabaseError("Failed to read subscription for profile sync", existingSubscription.error);

        const deletedUpdate = await supabaseAdmin
          .from("subscriptions")
          .update({
            status: "canceled",
            current_period_end: toIsoDate(resolveSubscriptionPeriodEnd(subscription)),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        throwSupabaseError("Failed to mark subscription as canceled", deletedUpdate.error);

        const customerEmail = await resolveCustomerEmail(subscription.customer);
        const metadataUserId = subscription.metadata?.userId as string | undefined;
        const metadataPlan = subscription.metadata?.plan as string | undefined;
        const stripeCustomerId =
          existingSubscription.data?.stripe_customer_id ??
          (typeof subscription.customer === "string" ? subscription.customer : null);

        await syncProfileSubscriptionState({
          userId: existingSubscription.data?.user_id ?? metadataUserId ?? null,
          email: customerEmail,
          status: "canceled",
          plan: existingSubscription.data?.plan ?? metadataPlan ?? null,
          stripeCustomerId,
        });
        break;
      }
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceSubscription =
          typeof invoice.parent?.subscription_details?.subscription === "string"
            ? invoice.parent.subscription_details.subscription
            : null;

        const invoicePaymentInsert = await supabaseAdmin.from("payments").insert({
          user_id: invoice.metadata?.userId ?? null,
          shop_id: invoice.metadata?.shopId ?? null,
          stripe_invoice_id: invoice.id,
          stripe_subscription_id: invoiceSubscription,
          amount_cents: invoice.amount_paid || invoice.amount_due || 0,
          currency: invoice.currency ?? "usd",
          status: event.type === "invoice.payment_succeeded" ? "paid" : "failed",
        });

        throwSupabaseError("Failed to persist invoice payment", invoicePaymentInsert.error);

        const invoiceEmail = invoice.customer_email ?? (await resolveCustomerEmail(invoice.customer));
        const invoicePlan = (invoice.metadata?.plan as string | undefined) ?? null;
        const invoiceStatus = event.type === "invoice.payment_succeeded" ? "active" : "past_due";
        const invoiceCustomerId = typeof invoice.customer === "string" ? invoice.customer : null;

        await syncProfileSubscriptionState({
          userId: (invoice.metadata?.userId as string | undefined) ?? null,
          email: invoiceEmail,
          status: invoiceStatus,
          plan: invoicePlan,
          stripeCustomerId: invoiceCustomerId,
        });
        break;
      }
      default:
        break;
    }

    let cronSyncError: string | null = null;
    if (shouldSyncCronLifecycle) {
      try {
        await syncSchedulerCronJobLifecycle();
      } catch (error) {
        cronSyncError = error instanceof Error ? error.message : "Cron sync failed";
      }
    }

    return NextResponse.json({ received: true, cronSyncError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handler error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
