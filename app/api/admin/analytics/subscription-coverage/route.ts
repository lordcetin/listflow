import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { getStripeClientForMode, type BillingPlan, type StripeMode } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

type CoverageMode = StripeMode | "all";
type BillingInterval = "month" | "year";
type CurrencyFilter = "all" | "usd" | "try";

type DbSubscriptionRow = {
  id: string;
  user_id: string | null;
  shop_id: string | null;
  store_id: string | null;
  plan: string | null;
  status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StripeSubscriptionSnapshot = {
  stripeMode: StripeMode;
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  stripeCustomerEmail: string | null;
  status: string;
  plan: BillingPlan | null;
  interval: BillingInterval | null;
  amountCents: number | null;
  currency: string | null;
  shopId: string | null;
  storeId: string | null;
  userIdFromMetadata: string | null;
  currentPeriodEnd: string | null;
  createdAt: string | null;
};

type StripeResolvedRow = StripeSubscriptionSnapshot & {
  resolvedUserId: string | null;
  resolvedStoreId: string | null;
  resolvedShopId: string | null;
  resolvedPlan: BillingPlan;
};

type CoverageRow = {
  source: "supabase" | "stripe" | "both";
  stripeMode: StripeMode | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  amountCents: number | null;
  currency: string | null;
  userId: string | null;
  userEmail: string | null;
  storeId: string | null;
  shopId: string | null;
  plan: string | null;
  interval: BillingInterval | null;
  status: string | null;
  currentPeriodEnd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CoverageSummary = {
  dbCount: number;
  stripeCount: number;
  mergedCount: number;
  bothCount: number;
  stripeOnlyCount: number;
  dbOnlyCount: number;
  activeOrTrialingCount: number;
};

const parseCoverageMode = (value: string | null): CoverageMode => {
  if (value === "live" || value === "test" || value === "all") {
    return value;
  }

  return "all";
};

const parseCurrencyFilter = (value: string | null): CurrencyFilter => {
  if (value === "all" || value === "usd" || value === "try") {
    return value;
  }

  if (value === "tl") {
    return "try";
  }

  return "all";
};

const normalizeCurrency = (value: string | null | undefined) => {
  return (value ?? "usd").toLowerCase();
};

const toStripeModes = (mode: CoverageMode): StripeMode[] => {
  if (mode === "all") {
    return ["live", "test"];
  }

  return [mode];
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

const isMissingColumnError = (error: { message?: string; code?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  if (error.code === "42703") {
    return true;
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

const isBillingPlan = (value: string | null | undefined): value is BillingPlan => {
  return value === "standard" || value === "pro" || value === "turbo";
};

const PLAN_DEFAULT_MONTHLY_CENTS: Record<BillingPlan, number> = {
  standard: 2990,
  pro: 4990,
  turbo: 7990,
};

const inferPlanDefaultCents = (plan: string | null | undefined) => {
  if (!isBillingPlan(plan)) {
    return null;
  }

  return PLAN_DEFAULT_MONTHLY_CENTS[plan];
};

const normalizeEmail = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  return value.trim().toLowerCase();
};

const toIso = (value: number | null | undefined) => {
  if (!value) {
    return null;
  }

  return new Date(value * 1000).toISOString();
};

const toInterval = (value: string | null | undefined): BillingInterval | null => {
  if (value === "month" || value === "year") {
    return value;
  }

  return null;
};

const splitIntoChunks = <T,>(items: T[], chunkSize = 200) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
};

type SubscriptionPaymentAmount = {
  amountCents: number | null;
  currency: string | null;
  createdAt: string | null;
};

const loadSubscriptionsColumnAvailability = async () => {
  const [storeProbe, updatedProbe] = await Promise.all([
    supabaseAdmin.from("subscriptions").select("store_id").limit(1),
    supabaseAdmin.from("subscriptions").select("updated_at").limit(1),
  ]);

  if (storeProbe.error && !isMissingColumnError(storeProbe.error, "store_id")) {
    throw new Error(storeProbe.error.message);
  }

  if (updatedProbe.error && !isMissingColumnError(updatedProbe.error, "updated_at")) {
    throw new Error(updatedProbe.error.message);
  }

  return {
    hasStoreId: !Boolean(storeProbe.error),
    hasUpdatedAt: !Boolean(updatedProbe.error),
  };
};

const loadDbSubscriptions = async (): Promise<DbSubscriptionRow[]> => {
  const availability = await loadSubscriptionsColumnAvailability();
  const selectColumns = [
    "id",
    "user_id",
    "shop_id",
    ...(availability.hasStoreId ? ["store_id"] : []),
    "plan",
    "status",
    "stripe_customer_id",
    "stripe_subscription_id",
    "current_period_end",
    "created_at",
    ...(availability.hasUpdatedAt ? ["updated_at"] : []),
  ].join(",");

  let query = supabaseAdmin.from("subscriptions").select(selectColumns).limit(5000);
  query = availability.hasUpdatedAt
    ? query.order("updated_at", { ascending: false })
    : query.order("created_at", { ascending: false });

  const { data, error } = await query;

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }

    throw new Error(error.message);
  }

  return ((data ?? []) as unknown as Array<{
    id: string;
    user_id?: string | null;
    shop_id?: string | null;
    store_id?: string | null;
    plan?: string | null;
    status?: string | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    current_period_end?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }>).map((row) => ({
    id: row.id,
    user_id: row.user_id ?? null,
    shop_id: row.shop_id ?? null,
    store_id: row.store_id ?? (isUuid(row.shop_id ?? null) ? (row.shop_id as string) : null),
    plan: row.plan ?? null,
    status: row.status ?? null,
    stripe_customer_id: row.stripe_customer_id ?? null,
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    current_period_end: row.current_period_end ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? row.created_at ?? null,
  }));
};

const loadLatestPaymentBySubscriptionId = async (subscriptionIds: Array<string | null | undefined>) => {
  const normalizedIds = Array.from(
    new Set(
      subscriptionIds
        .filter((value): value is string => Boolean(value && value.trim()))
        .map((value) => value.trim())
    )
  );

  const map = new Map<string, SubscriptionPaymentAmount>();

  if (!normalizedIds.length) {
    return map;
  }

  for (const chunk of splitIntoChunks(normalizedIds, 200)) {
    const { data, error } = await supabaseAdmin
      .from("payments")
      .select("stripe_subscription_id, amount_cents, currency, created_at")
      .in("stripe_subscription_id", chunk)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error, "stripe_subscription_id")) {
        return map;
      }

      throw new Error(error.message);
    }

    for (const row of (data ?? []) as Array<{
      stripe_subscription_id?: string | null;
      amount_cents?: number | null;
      currency?: string | null;
      created_at?: string | null;
    }>) {
      const subscriptionId = row.stripe_subscription_id ?? null;
      if (!subscriptionId || map.has(subscriptionId)) {
        continue;
      }

      map.set(subscriptionId, {
        amountCents: row.amount_cents ?? null,
        currency: row.currency ?? null,
        createdAt: row.created_at ?? null,
      });
    }
  }

  return map;
};

const loadEmailByUserId = async (userIds: string[]) => {
  const uniqueUserIds = Array.from(new Set(userIds.filter((value) => isUuid(value))));
  const map = new Map<string, string>();

  if (!uniqueUserIds.length) {
    return map;
  }

  for (const chunk of splitIntoChunks(uniqueUserIds, 200)) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("user_id, email")
      .in("user_id", chunk);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as Array<{ user_id?: string | null; email?: string | null }>) {
      if (!row.user_id || !row.email) {
        continue;
      }

      map.set(row.user_id, row.email);
    }
  }

  return map;
};

const loadUserIdByEmail = async (emails: Array<string | null | undefined>) => {
  const uniqueEmails = Array.from(
    new Set(
      emails
        .map((value) => normalizeEmail(value))
        .filter((value): value is string => Boolean(value))
    )
  );

  const map = new Map<string, string>();

  if (!uniqueEmails.length) {
    return map;
  }

  for (const chunk of splitIntoChunks(uniqueEmails, 200)) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("user_id, email")
      .in("email", chunk);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as Array<{ user_id?: string | null; email?: string | null }>) {
      const normalized = normalizeEmail(row.email);
      if (!normalized || !row.user_id) {
        continue;
      }

      map.set(normalized, row.user_id);
    }
  }

  return map;
};

const loadStoreIdsByUserId = async (userIds: string[]) => {
  const uniqueUserIds = Array.from(new Set(userIds.filter((value) => isUuid(value))));
  const map = new Map<string, string[]>();

  if (!uniqueUserIds.length) {
    return map;
  }

  for (const chunk of splitIntoChunks(uniqueUserIds, 200)) {
    const { data, error } = await supabaseAdmin
      .from("stores")
      .select("id, user_id")
      .in("user_id", chunk);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as Array<{ id?: string | null; user_id?: string | null }>) {
      if (!row.id || !row.user_id) {
        continue;
      }

      const current = map.get(row.user_id) ?? [];
      current.push(row.id);
      map.set(row.user_id, current);
    }
  }

  return map;
};

const loadPlanByPriceId = async (mode: StripeMode) => {
  const withMode = await supabaseAdmin
    .from("stripe_plan_prices")
    .select("plan, stripe_price_id, stripe_mode");

  if (withMode.error && isMissingRelationError(withMode.error)) {
    return new Map<string, BillingPlan>();
  }

  let rows = withMode.data as Array<{
    plan?: string | null;
    stripe_price_id?: string | null;
    stripe_mode?: string | null;
  }> | null;
  let rowsError = withMode.error;
  let hasModeColumn = true;

  if (withMode.error && isMissingColumnError(withMode.error, "stripe_mode")) {
    hasModeColumn = false;

    const fallback = await supabaseAdmin
      .from("stripe_plan_prices")
      .select("plan, stripe_price_id");

    if (fallback.error) {
      if (isMissingRelationError(fallback.error)) {
        return new Map<string, BillingPlan>();
      }

      throw new Error(fallback.error.message);
    }

    rows = (fallback.data ?? []) as Array<{
      plan?: string | null;
      stripe_price_id?: string | null;
      stripe_mode?: string | null;
    }>;
    rowsError = null;
  }

  if (rowsError) {
    throw new Error(rowsError.message);
  }

  const map = new Map<string, BillingPlan>();

  for (const row of rows ?? []) {
    if (!row.stripe_price_id || !isBillingPlan(row.plan)) {
      continue;
    }

    if (hasModeColumn && row.stripe_mode && row.stripe_mode !== mode) {
      continue;
    }

    map.set(row.stripe_price_id, row.plan);
  }

  return map;
};

const resolvePlanFromSubscription = (
  subscription: Stripe.Subscription,
  modePriceMap: Map<string, BillingPlan>
): BillingPlan | null => {
  if (isBillingPlan(subscription.metadata?.plan)) {
    return subscription.metadata.plan;
  }

  const firstItem = subscription.items.data[0];
  const firstPrice = firstItem?.price;

  if (firstPrice && isBillingPlan(firstPrice.metadata?.plan)) {
    return firstPrice.metadata.plan;
  }

  if (firstPrice?.id && modePriceMap.has(firstPrice.id)) {
    return modePriceMap.get(firstPrice.id) ?? null;
  }

  return null;
};

const resolveMetadataString = (metadata: Stripe.Metadata | null | undefined, keys: string[]) => {
  if (!metadata) {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

const listStripeSubscriptionsForMode = async (mode: StripeMode): Promise<StripeSubscriptionSnapshot[]> => {
  const stripe = getStripeClientForMode(mode);
  const planByPriceId = await loadPlanByPriceId(mode);
  const snapshots: StripeSubscriptionSnapshot[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 100; page += 1) {
    const response = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      starting_after: cursor,
      // Stripe allows max 4-level expand. Keep price expanded, do not expand product here.
      expand: ["data.customer", "data.items.data.price"],
    });

    if (!response.data.length) {
      break;
    }

    for (const subscription of response.data) {
      const firstItem = subscription.items.data[0];
      const firstPrice = firstItem?.price;
      const recurringInterval = toInterval(firstPrice?.recurring?.interval ?? null);
      const rawShopId = resolveMetadataString(subscription.metadata, [
        "shopId",
        "shop_id",
        "storeId",
        "store_id",
      ]);
      const rawUserId = resolveMetadataString(subscription.metadata, ["userId", "user_id"]);
      const customer =
        typeof subscription.customer === "object" && subscription.customer && !("deleted" in subscription.customer)
          ? subscription.customer
          : null;

      snapshots.push({
        stripeMode: mode,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : customer?.id ?? null,
        stripeCustomerEmail: customer?.email ?? null,
        status: subscription.status,
        plan: resolvePlanFromSubscription(subscription, planByPriceId),
        interval: recurringInterval,
        amountCents: firstPrice?.unit_amount ?? null,
        currency: firstPrice?.currency ?? null,
        shopId: rawShopId ?? null,
        storeId: isUuid(rawShopId) ? rawShopId : null,
        userIdFromMetadata: isUuid(rawUserId) ? rawUserId : null,
        currentPeriodEnd: toIso(firstItem?.current_period_end ?? null),
        createdAt: toIso(subscription.created),
      });
    }

    if (!response.has_more) {
      break;
    }

    cursor = response.data[response.data.length - 1]?.id;
    if (!cursor) {
      break;
    }
  }

  return snapshots;
};

const loadStripeSnapshots = async (mode: CoverageMode) => {
  const rows: StripeSubscriptionSnapshot[] = [];
  const warnings: string[] = [];
  const targetModes = toStripeModes(mode);

  for (const targetMode of targetModes) {
    try {
      const modeRows = await listStripeSubscriptionsForMode(targetMode);
      rows.push(...modeRows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe subscriptions could not be listed.";
      warnings.push(`${targetMode} mode okunamadı: ${message}`);
    }
  }

  return { rows, warnings };
};

const resolveStripeRows = async (rows: StripeSubscriptionSnapshot[]) => {
  const emailToUserId = await loadUserIdByEmail(rows.map((row) => row.stripeCustomerEmail));
  const userIdsFromMetadata = rows
    .map((row) => row.userIdFromMetadata)
    .filter((value): value is string => Boolean(value));
  const userIdsFromEmails = Array.from(emailToUserId.values());
  const storeIdsByUserId = await loadStoreIdsByUserId([...userIdsFromMetadata, ...userIdsFromEmails]);

  return rows.map<StripeResolvedRow>((row) => {
    const userIdFromEmail = normalizeEmail(row.stripeCustomerEmail)
      ? emailToUserId.get(normalizeEmail(row.stripeCustomerEmail) as string) ?? null
      : null;
    const resolvedUserId = row.userIdFromMetadata ?? userIdFromEmail;
    const candidateStoreIds = resolvedUserId ? storeIdsByUserId.get(resolvedUserId) ?? [] : [];
    const resolvedStoreId = row.storeId ?? (candidateStoreIds.length === 1 ? candidateStoreIds[0] : null);
    const resolvedShopId = row.shopId ?? resolvedStoreId;

    return {
      ...row,
      resolvedUserId,
      resolvedStoreId,
      resolvedShopId,
      resolvedPlan: row.plan ?? "standard",
    };
  });
};

const buildSubscriptionPayload = (
  row: StripeResolvedRow,
  nowIso: string,
  options: { hasStoreId: boolean; hasUpdatedAt: boolean }
) => {
  const payload: Record<string, unknown> = {
    user_id: row.resolvedUserId,
    shop_id: row.resolvedShopId,
    plan: row.resolvedPlan,
    status: row.status,
    stripe_customer_id: row.stripeCustomerId,
    stripe_subscription_id: row.stripeSubscriptionId,
    current_period_end: row.currentPeriodEnd,
  };

  if (options.hasStoreId) {
    payload.store_id = row.resolvedStoreId;
  }

  if (options.hasUpdatedAt) {
    payload.updated_at = nowIso;
  }

  return payload;
};

const upsertSingleSubscription = async (
  row: StripeResolvedRow,
  options: { hasStoreId: boolean; hasUpdatedAt: boolean }
) => {
  const nowIso = new Date().toISOString();
  const payload = buildSubscriptionPayload(row, nowIso, options);

  const upsert = await supabaseAdmin
    .from("subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" })
    .select("id")
    .maybeSingle();

  if (!upsert.error) {
    return { ok: true as const };
  }

  if (!isMissingOnConflictConstraintError(upsert.error)) {
    return { ok: false as const, reason: upsert.error.message };
  }

  const existing = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", row.stripeSubscriptionId)
    .maybeSingle<{ id?: string }>();

  if (existing.error) {
    return { ok: false as const, reason: existing.error.message };
  }

  if (existing.data?.id) {
    const updated = await supabaseAdmin
      .from("subscriptions")
      .update(payload)
      .eq("id", existing.data.id);

    if (updated.error) {
      return { ok: false as const, reason: updated.error.message };
    }

    return { ok: true as const };
  }

  const inserted = await supabaseAdmin
    .from("subscriptions")
    .insert(payload);

  if (inserted.error) {
    return { ok: false as const, reason: inserted.error.message };
  }

  return { ok: true as const };
};

const syncStripeRowsToSupabase = async (rows: StripeResolvedRow[]) => {
  const availability = await loadSubscriptionsColumnAvailability();
  const failures: Array<{ stripeSubscriptionId: string; reason: string }> = [];
  let upserted = 0;

  for (const row of rows) {
    const result = await upsertSingleSubscription(row, availability);

    if (!result.ok) {
      failures.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        reason: result.reason,
      });
      continue;
    }

    upserted += 1;
  }

  return {
    scanned: rows.length,
    upserted,
    failed: failures.length,
    failures,
  };
};

const mergeCoverage = async (
  dbRows: DbSubscriptionRow[],
  stripeRows: StripeResolvedRow[],
  mode: CoverageMode
) => {
  const latestPaymentBySubscriptionId = await loadLatestPaymentBySubscriptionId(
    dbRows.map((row) => row.stripe_subscription_id)
  );
  const userIds = [
    ...dbRows.map((row) => row.user_id),
    ...stripeRows.map((row) => row.resolvedUserId),
  ].filter((value): value is string => Boolean(value));
  const emailByUserId = await loadEmailByUserId(userIds);

  const mergedByKey = new Map<string, CoverageRow>();

  for (const dbRow of dbRows) {
    const key = dbRow.stripe_subscription_id ? `sub:${dbRow.stripe_subscription_id}` : `db:${dbRow.id}`;
    const paymentSummary = dbRow.stripe_subscription_id
      ? latestPaymentBySubscriptionId.get(dbRow.stripe_subscription_id) ?? null
      : null;

    mergedByKey.set(key, {
      source: "supabase",
      stripeMode: mode === "all" ? null : mode,
      stripeSubscriptionId: dbRow.stripe_subscription_id ?? null,
      stripeCustomerId: dbRow.stripe_customer_id ?? null,
      amountCents: paymentSummary?.amountCents ?? inferPlanDefaultCents(dbRow.plan),
      currency: paymentSummary?.currency ?? "usd",
      userId: dbRow.user_id ?? null,
      userEmail: dbRow.user_id ? emailByUserId.get(dbRow.user_id) ?? null : null,
      storeId: dbRow.store_id ?? null,
      shopId: dbRow.shop_id ?? null,
      plan: dbRow.plan ?? null,
      interval: null,
      status: dbRow.status ?? null,
      currentPeriodEnd: dbRow.current_period_end ?? null,
      createdAt: dbRow.created_at ?? null,
      updatedAt: dbRow.updated_at ?? dbRow.created_at ?? null,
    });
  }

  for (const stripeRow of stripeRows) {
    const key = `sub:${stripeRow.stripeSubscriptionId}`;
    const current = mergedByKey.get(key);
    const inferredEmail =
      stripeRow.resolvedUserId ? emailByUserId.get(stripeRow.resolvedUserId) ?? stripeRow.stripeCustomerEmail : stripeRow.stripeCustomerEmail;

    if (!current) {
      mergedByKey.set(key, {
        source: "stripe",
        stripeMode: stripeRow.stripeMode,
        stripeSubscriptionId: stripeRow.stripeSubscriptionId,
        stripeCustomerId: stripeRow.stripeCustomerId,
        amountCents: stripeRow.amountCents ?? inferPlanDefaultCents(stripeRow.resolvedPlan),
        currency: stripeRow.currency ?? "usd",
        userId: stripeRow.resolvedUserId,
        userEmail: inferredEmail ?? null,
        storeId: stripeRow.resolvedStoreId,
        shopId: stripeRow.resolvedShopId,
        plan: stripeRow.resolvedPlan,
        interval: stripeRow.interval,
        status: stripeRow.status,
        currentPeriodEnd: stripeRow.currentPeriodEnd,
        createdAt: stripeRow.createdAt,
        updatedAt: stripeRow.createdAt,
      });
      continue;
    }

    mergedByKey.set(key, {
      source: "both",
      stripeMode: stripeRow.stripeMode,
      stripeSubscriptionId: stripeRow.stripeSubscriptionId,
      stripeCustomerId: stripeRow.stripeCustomerId ?? current.stripeCustomerId,
      amountCents: stripeRow.amountCents ?? current.amountCents,
      currency: stripeRow.currency ?? current.currency,
      userId: current.userId ?? stripeRow.resolvedUserId,
      userEmail: current.userEmail ?? inferredEmail ?? null,
      storeId: current.storeId ?? stripeRow.resolvedStoreId,
      shopId: current.shopId ?? stripeRow.resolvedShopId,
      plan: current.plan ?? stripeRow.resolvedPlan,
      interval: stripeRow.interval ?? current.interval,
      status: stripeRow.status ?? current.status,
      currentPeriodEnd: stripeRow.currentPeriodEnd ?? current.currentPeriodEnd,
      createdAt: current.createdAt ?? stripeRow.createdAt,
      updatedAt: current.updatedAt ?? stripeRow.createdAt,
    });
  }

  const rows = Array.from(mergedByKey.values()).sort((a, b) => {
    const left = a.updatedAt ?? a.createdAt ?? "";
    const right = b.updatedAt ?? b.createdAt ?? "";
    return right.localeCompare(left);
  });

  const summary: CoverageSummary = {
    dbCount: dbRows.length,
    stripeCount: stripeRows.length,
    mergedCount: rows.length,
    bothCount: rows.filter((row) => row.source === "both").length,
    stripeOnlyCount: rows.filter((row) => row.source === "stripe").length,
    dbOnlyCount: rows.filter((row) => row.source === "supabase").length,
    activeOrTrialingCount: rows.filter((row) => row.status === "active" || row.status === "trialing").length,
  };

  return { rows, summary };
};

const buildCoverage = async (mode: CoverageMode, currencyFilter: CurrencyFilter) => {
  const stripe = await loadStripeSnapshots(mode);
  const resolvedStripeRows = await resolveStripeRows(stripe.rows);
  const dbRowsAll = await loadDbSubscriptions();
  const stripeSubscriptionIds = new Set(resolvedStripeRows.map((row) => row.stripeSubscriptionId));

  const dbRows =
    mode === "all"
      ? dbRowsAll
      : dbRowsAll.filter((row) => {
          if (!row.stripe_subscription_id) {
            return true;
          }

          return stripeSubscriptionIds.has(row.stripe_subscription_id);
        });

  const merged = await mergeCoverage(dbRows, resolvedStripeRows, mode);
  const normalizedRows = merged.rows.map((row) => ({
    ...row,
    currency: normalizeCurrency(row.currency),
  }));

  const summaryByCurrency = normalizedRows.reduce<Record<string, { total: number; both: number; stripeOnly: number; dbOnly: number; activeOrTrialing: number }>>(
    (acc, row) => {
      const currency = normalizeCurrency(row.currency);
      if (!acc[currency]) {
        acc[currency] = { total: 0, both: 0, stripeOnly: 0, dbOnly: 0, activeOrTrialing: 0 };
      }

      acc[currency].total += 1;
      if (row.source === "both") acc[currency].both += 1;
      if (row.source === "stripe") acc[currency].stripeOnly += 1;
      if (row.source === "supabase") acc[currency].dbOnly += 1;
      if (row.status === "active" || row.status === "trialing") acc[currency].activeOrTrialing += 1;
      return acc;
    },
    {}
  );

  const filteredRows =
    currencyFilter === "all"
      ? normalizedRows
      : normalizedRows.filter((row) => row.currency === currencyFilter);

  const filteredSummary: CoverageSummary = {
    ...merged.summary,
    mergedCount: filteredRows.length,
    bothCount: filteredRows.filter((row) => row.source === "both").length,
    stripeOnlyCount: filteredRows.filter((row) => row.source === "stripe").length,
    dbOnlyCount: filteredRows.filter((row) => row.source === "supabase").length,
    activeOrTrialingCount: filteredRows.filter((row) => row.status === "active" || row.status === "trialing").length,
  };

  return {
    rows: filteredRows,
    summary: filteredSummary,
    summaryByCurrency,
    warnings: stripe.warnings,
    resolvedStripeRows,
  };
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const mode = parseCoverageMode(request.nextUrl.searchParams.get("mode"));
    const currencyFilter = parseCurrencyFilter(request.nextUrl.searchParams.get("currency"));
    const coverage = await buildCoverage(mode, currencyFilter);

    return NextResponse.json({
      mode,
      currencyFilter,
      rows: coverage.rows,
      summary: coverage.summary,
      summaryByCurrency: coverage.summaryByCurrency,
      warnings: coverage.warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Subscription coverage could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { mode?: string; currency?: string };
    const mode = parseCoverageMode(body?.mode ?? null);
    const currencyFilter = parseCurrencyFilter(body?.currency ?? null);
    const coverageBefore = await buildCoverage(mode, currencyFilter);
    const syncResult = await syncStripeRowsToSupabase(coverageBefore.resolvedStripeRows);
    const coverageAfter = await buildCoverage(mode, currencyFilter);

    return NextResponse.json({
      mode,
      currencyFilter,
      rows: coverageAfter.rows,
      summary: coverageAfter.summary,
      summaryByCurrency: coverageAfter.summaryByCurrency,
      warnings: coverageAfter.warnings,
      sync: syncResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Subscription sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
