import type Stripe from "stripe";
import {
  PLAN_TO_MONTHLY_CENTS,
  YEARLY_DISCOUNT_PERCENT,
  getActiveStripeMode,
  getConfiguredPriceIdForMode,
  getStripeClientForMode,
  getYearlyCentsFromMonthly,
  type BillingInterval,
  type BillingPlan,
  type StripeMode,
} from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

const PLANS: BillingPlan[] = ["standard", "pro", "turbo"];
const INTERVALS: BillingInterval[] = ["month", "year"];
const STRIPE_PLAN_PRICE_TABLE = "stripe_plan_prices";

type StripePriceWithProduct = Stripe.Price & { product: string | Stripe.Product };
type PlanIntervalKey = `${BillingPlan}:${BillingInterval}`;
type DbPlanPriceRow = {
  plan: BillingPlan;
  interval: BillingInterval;
  mode: StripeMode;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  active: boolean | null;
  updated_at?: string | null;
};

export type PlanPriceSnapshot = {
  plan: BillingPlan;
  interval: BillingInterval;
  mode: StripeMode;
  priceId: string | null;
  productId: string | null;
  productName: string | null;
  amountCents: number | null;
  currency: string | null;
  active: boolean;
  created: number | null;
};

export type PlanPricingSnapshot = {
  plan: BillingPlan;
  mode: StripeMode;
  monthly: PlanPriceSnapshot;
  yearly: PlanPriceSnapshot;
  yearlyDiscountPercent: number;
};

export type StripeCatalogProduct = {
  productId: string;
  name: string;
  active: boolean;
  metadata: Record<string, string>;
  prices: Array<{
    priceId: string;
    interval: BillingInterval;
    amountCents: number;
    currency: string;
    active: boolean;
    created: number;
  }>;
};

type PlanOptions = {
  mode?: StripeMode;
};

const isPlan = (value: string | null | undefined): value is BillingPlan => {
  return value === "standard" || value === "pro" || value === "turbo";
};

const isInterval = (value: string | null | undefined): value is BillingInterval => {
  return value === "month" || value === "year";
};

const isMode = (value: string | null | undefined): value is StripeMode => {
  return value === "live" || value === "test";
};

const intervalKey = (plan: BillingPlan, interval: BillingInterval): PlanIntervalKey =>
  `${plan}:${interval}`;

const isMissingRelationError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  if (error.code === "42P01") {
    return true;
  }

  return (error.message ?? "").toLowerCase().includes("relation") && (error.message ?? "").toLowerCase().includes("does not exist");
};

const isMissingColumnError = (
  error: { message?: string; code?: string } | null | undefined,
  columnName: string
) => {
  if (!error) {
    return false;
  }

  return (error.message ?? "").toLowerCase().includes(columnName.toLowerCase()) &&
    (error.message ?? "").toLowerCase().includes("column");
};

const isMissingOnConflictConstraintError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  return (error.message ?? "").toLowerCase().includes("no unique or exclusion constraint matching");
};

const readDbPlanRows = async (mode: StripeMode): Promise<DbPlanPriceRow[]> => {
  const withMode = await supabaseAdmin
    .from(STRIPE_PLAN_PRICE_TABLE)
    .select("plan, interval, stripe_mode, stripe_product_id, stripe_price_id, amount_cents, currency, active, updated_at")
    .eq("active", true)
    .eq("stripe_mode", mode);

  if (withMode.error && isMissingRelationError(withMode.error)) {
    return [];
  }

  let rowsData: Array<{
    plan?: string | null;
    interval?: string | null;
    stripe_mode?: string | null;
    stripe_product_id?: string | null;
    stripe_price_id?: string | null;
    amount_cents?: number | null;
    currency?: string | null;
    active?: boolean | null;
    updated_at?: string | null;
  }> | null = (withMode.data as Array<{
    plan?: string | null;
    interval?: string | null;
    stripe_mode?: string | null;
    stripe_product_id?: string | null;
    stripe_price_id?: string | null;
    amount_cents?: number | null;
    currency?: string | null;
    active?: boolean | null;
    updated_at?: string | null;
  }> | null);
  let rowsError: { message: string } | null = withMode.error;
  let modeColumnAvailable = true;

  if (withMode.error && isMissingColumnError(withMode.error, "stripe_mode")) {
    modeColumnAvailable = false;
    const fallback = await supabaseAdmin
      .from(STRIPE_PLAN_PRICE_TABLE)
      .select("plan, interval, stripe_product_id, stripe_price_id, amount_cents, currency, active, updated_at")
      .eq("active", true);

    rowsData = fallback.data as Array<{
      plan?: string | null;
      interval?: string | null;
      stripe_mode?: string | null;
      stripe_product_id?: string | null;
      stripe_price_id?: string | null;
      amount_cents?: number | null;
      currency?: string | null;
      active?: boolean | null;
      updated_at?: string | null;
    }> | null;
    rowsError = fallback.error;
  }

  if (rowsError) {
    throw new Error(rowsError.message);
  }

  const rows = rowsData ?? [];

  return rows
    .filter((row) => isPlan(row.plan) && isInterval(row.interval))
    .map((row) => ({
      plan: row.plan as BillingPlan,
      interval: row.interval as BillingInterval,
      mode: modeColumnAvailable && isMode(row.stripe_mode) ? row.stripe_mode : "live",
      stripe_product_id: row.stripe_product_id ?? null,
      stripe_price_id: row.stripe_price_id ?? null,
      amount_cents: row.amount_cents ?? null,
      currency: row.currency ?? "usd",
      active: row.active ?? true,
      updated_at: row.updated_at ?? null,
    }))
    .filter((row) => row.mode === mode);
};

const upsertDbPlanRow = async (payload: {
  plan: BillingPlan;
  interval: BillingInterval;
  mode: StripeMode;
  stripeProductId: string;
  stripePriceId: string;
  amountCents: number;
  currency: string;
}) => {
  const withMode = await supabaseAdmin.from(STRIPE_PLAN_PRICE_TABLE).upsert(
    {
      plan: payload.plan,
      interval: payload.interval,
      stripe_mode: payload.mode,
      stripe_product_id: payload.stripeProductId,
      stripe_price_id: payload.stripePriceId,
      amount_cents: payload.amountCents,
      currency: payload.currency,
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "plan,interval,stripe_mode" }
  );

  if (!withMode.error) {
    return;
  }

  if (isMissingRelationError(withMode.error)) {
    throw new Error(
      "Missing table public.stripe_plan_prices. Please create it in Supabase SQL Editor before updating plan prices."
    );
  }

  if (
    !isMissingColumnError(withMode.error, "stripe_mode") &&
    !isMissingOnConflictConstraintError(withMode.error)
  ) {
    throw new Error(withMode.error.message);
  }

  const fallback = await supabaseAdmin.from(STRIPE_PLAN_PRICE_TABLE).upsert(
    {
      plan: payload.plan,
      interval: payload.interval,
      stripe_product_id: payload.stripeProductId,
      stripe_price_id: payload.stripePriceId,
      amount_cents: payload.amountCents,
      currency: payload.currency,
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "plan,interval" }
  );

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }
};

const toPlanLabel = (plan: BillingPlan) => {
  if (plan === "standard") return "Standard";
  if (plan === "pro") return "Pro";
  return "Turbo";
};

const getConfiguredPriceId = (plan: BillingPlan, interval: BillingInterval, mode: StripeMode) => {
  return getConfiguredPriceIdForMode(plan, interval, mode);
};

const emptyEntry = (plan: BillingPlan, interval: BillingInterval, mode: StripeMode): PlanPriceSnapshot => ({
  plan,
  interval,
  mode,
  priceId: null,
  productId: null,
  productName: null,
  amountCents: null,
  currency: null,
  active: false,
  created: null,
});

const extractProduct = (price: StripePriceWithProduct) => {
  if (typeof price.product === "string") {
    return {
      productId: price.product,
      productName: null,
      productMetadata: {} as Record<string, string>,
    };
  }

  return {
    productId: price.product.id,
    productName: price.product.name,
    productMetadata: price.product.metadata ?? {},
  };
};

const toEntry = (
  price: StripePriceWithProduct,
  plan: BillingPlan,
  interval: BillingInterval,
  mode: StripeMode
): PlanPriceSnapshot => {
  const product = extractProduct(price);

  return {
    plan,
    interval,
    mode,
    priceId: price.id,
    productId: product.productId,
    productName: product.productName,
    amountCents: price.unit_amount ?? null,
    currency: price.currency ?? null,
    active: Boolean(price.active),
    created: price.created ?? null,
  };
};

const retrievePriceById = async (stripeClient: Stripe, priceId: string | null | undefined) => {
  if (!priceId) {
    return null;
  }

  try {
    const price = (await stripeClient.prices.retrieve(priceId, {
      expand: ["product"],
    })) as StripePriceWithProduct;

    if (!price.recurring || !isInterval(price.recurring.interval)) {
      return null;
    }

    return price;
  } catch {
    return null;
  }
};

const resolvePlanFromPrice = (price: StripePriceWithProduct, mode: StripeMode): BillingPlan | null => {
  if (isPlan(price.metadata?.plan)) {
    return price.metadata.plan;
  }

  const product = extractProduct(price);

  if (isPlan(product.productMetadata?.plan)) {
    return product.productMetadata.plan;
  }

  for (const plan of PLANS) {
    const configuredMonthly = getConfiguredPriceId(plan, "month", mode);
    const configuredYearly = getConfiguredPriceId(plan, "year", mode);
    if (price.id === configuredMonthly || price.id === configuredYearly) {
      return plan;
    }
  }

  return null;
};

const resolveIntervalFromPrice = (price: StripePriceWithProduct, mode: StripeMode): BillingInterval | null => {
  if (price.recurring && isInterval(price.recurring.interval)) {
    return price.recurring.interval;
  }

  for (const plan of PLANS) {
    if (price.id === getConfiguredPriceId(plan, "month", mode)) {
      return "month";
    }

    if (price.id === getConfiguredPriceId(plan, "year", mode)) {
      return "year";
    }
  }

  return null;
};

const listPricesForDiscovery = async (stripeClient: Stripe) => {
  const collected: StripePriceWithProduct[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (page < 5) {
    const response = await stripeClient.prices.list({
      limit: 100,
      starting_after: cursor,
      expand: ["data.product"],
    });

    const recurring = response.data.filter(
      (price) => Boolean(price.recurring) && isInterval(price.recurring?.interval)
    ) as StripePriceWithProduct[];

    collected.push(...recurring);

    if (!response.has_more || response.data.length === 0) {
      break;
    }

    cursor = response.data[response.data.length - 1]?.id;
    page += 1;
  }

  return collected;
};

const getOrCreatePlanProductId = async (
  stripeClient: Stripe,
  plan: BillingPlan,
  mode: StripeMode,
  fallbackProductId?: string | null
) => {
  if (fallbackProductId) {
    try {
      const existingById = await stripeClient.products.retrieve(fallbackProductId);
      if (!("deleted" in existingById && existingById.deleted)) {
        return existingById.id;
      }
    } catch {
      // ignore stale product id from other Stripe mode and continue discovery/create flow
    }
  }

  const products = await stripeClient.products.list({ limit: 100, active: true });
  const existing = products.data.find((product) => isPlan(product.metadata?.plan) && product.metadata.plan === plan);

  if (existing) {
    return existing.id;
  }

  const created = await stripeClient.products.create({
    name: `Listflow ${toPlanLabel(plan)}`,
    metadata: {
      plan,
      stripe_mode: mode,
      managed_by: "listflow_admin",
    },
  });

  return created.id;
};

const computeDiscountPercent = (monthlyCents: number | null, yearlyCents: number | null) => {
  if (!monthlyCents || !yearlyCents) {
    return YEARLY_DISCOUNT_PERCENT;
  }

  const yearlyBase = monthlyCents * 12;
  if (yearlyBase <= 0) {
    return YEARLY_DISCOUNT_PERCENT;
  }

  const ratio = yearlyCents / yearlyBase;
  const discount = Math.round((1 - ratio) * 100);
  return Math.max(0, discount);
};

export const getPlanPricingSnapshot = async (
  options: PlanOptions = {}
): Promise<PlanPricingSnapshot[]> => {
  const mode = options.mode ?? getActiveStripeMode();
  const stripeClient = getStripeClientForMode(mode);
  const dbRows = await readDbPlanRows(mode);
  const discoveredPrices = await listPricesForDiscovery(stripeClient);

  const resolvedMap: Record<BillingPlan, Record<BillingInterval, StripePriceWithProduct | null>> = {
    standard: { month: null, year: null },
    pro: { month: null, year: null },
    turbo: { month: null, year: null },
  };
  const dbFallbackMap: Record<BillingPlan, Record<BillingInterval, DbPlanPriceRow | null>> = {
    standard: { month: null, year: null },
    pro: { month: null, year: null },
    turbo: { month: null, year: null },
  };
  const dbLocked = new Set<PlanIntervalKey>();

  for (const row of dbRows) {
    dbFallbackMap[row.plan][row.interval] = row;

    if (!row.stripe_price_id) {
      continue;
    }

    const dbPrice = await retrievePriceById(stripeClient, row.stripe_price_id);
    if (dbPrice) {
      resolvedMap[row.plan][row.interval] = dbPrice;
      dbLocked.add(intervalKey(row.plan, row.interval));
    }
  }

  for (const plan of PLANS) {
    for (const interval of INTERVALS) {
      if (dbLocked.has(intervalKey(plan, interval))) {
        continue;
      }

      const configuredId = getConfiguredPriceId(plan, interval, mode);
      const configuredPrice = await retrievePriceById(stripeClient, configuredId);
      if (configuredPrice) {
        resolvedMap[plan][interval] = configuredPrice;
      }
    }
  }

  for (const price of discoveredPrices) {
    const plan = resolvePlanFromPrice(price, mode);
    const interval = resolveIntervalFromPrice(price, mode);

    if (!plan || !interval) {
      continue;
    }

    if (dbLocked.has(intervalKey(plan, interval))) {
      continue;
    }

    const current = resolvedMap[plan][interval];

    if (!current || (price.created ?? 0) > (current.created ?? 0)) {
      resolvedMap[plan][interval] = price;
    }
  }

  return PLANS.map((plan) => {
    const monthlyPrice = resolvedMap[plan].month;
    const yearlyPrice = resolvedMap[plan].year;

    const monthlyDbFallback = dbFallbackMap[plan].month;
    const yearlyDbFallback = dbFallbackMap[plan].year;

    const monthlyEntry = monthlyPrice
      ? toEntry(monthlyPrice, plan, "month", mode)
      : monthlyDbFallback
        ? {
            plan,
            interval: "month" as BillingInterval,
            mode,
            priceId: monthlyDbFallback.stripe_price_id,
            productId: monthlyDbFallback.stripe_product_id,
            productName: null,
            amountCents: monthlyDbFallback.amount_cents,
            currency: monthlyDbFallback.currency,
            active: monthlyDbFallback.active !== false,
            created: null,
          }
        : emptyEntry(plan, "month", mode);

    const yearlyEntry = yearlyPrice
      ? toEntry(yearlyPrice, plan, "year", mode)
      : yearlyDbFallback
        ? {
            plan,
            interval: "year" as BillingInterval,
            mode,
            priceId: yearlyDbFallback.stripe_price_id,
            productId: yearlyDbFallback.stripe_product_id,
            productName: null,
            amountCents: yearlyDbFallback.amount_cents,
            currency: yearlyDbFallback.currency,
            active: yearlyDbFallback.active !== false,
            created: null,
          }
        : emptyEntry(plan, "year", mode);

    return {
      plan,
      mode,
      monthly: monthlyEntry,
      yearly: yearlyEntry,
      yearlyDiscountPercent: computeDiscountPercent(monthlyEntry.amountCents, yearlyEntry.amountCents),
    };
  });
};

export const resolveCheckoutPriceId = async (
  plan: BillingPlan,
  interval: BillingInterval,
  options: PlanOptions = {}
) => {
  const mode = options.mode ?? getActiveStripeMode();
  const stripeClient = getStripeClientForMode(mode);
  const dbRows = await readDbPlanRows(mode);
  const dbMatch = dbRows.find((row) => row.plan === plan && row.interval === interval && row.stripe_price_id);

  if (dbMatch?.stripe_price_id) {
    const dbPrice = await retrievePriceById(stripeClient, dbMatch.stripe_price_id);
    if (dbPrice) {
      return dbMatch.stripe_price_id;
    }
  }

  const configured = getConfiguredPriceId(plan, interval, mode);
  if (configured) {
    const configuredPrice = await retrievePriceById(stripeClient, configured);
    if (configuredPrice) {
      return configured;
    }
  }

  const plans = await getPlanPricingSnapshot({ mode });
  const snapshot = plans.find((item) => item.plan === plan);

  if (!snapshot) {
    throw new Error("Plan pricing not found");
  }

  const selected = interval === "year" ? snapshot.yearly : snapshot.monthly;

  if (selected.priceId) {
    const selectedPrice = await retrievePriceById(stripeClient, selected.priceId);
    if (selectedPrice) {
      return selected.priceId;
    }
  }

  const monthlyConfigured = getConfiguredPriceId(plan, "month", mode);
  const monthlyPrice = await retrievePriceById(stripeClient, monthlyConfigured);
  const monthlyCents = monthlyPrice?.unit_amount ?? snapshot.monthly.amountCents ?? PLAN_TO_MONTHLY_CENTS[plan];
  const currency = monthlyPrice?.currency ?? snapshot.monthly.currency ?? "usd";
  const productId = await getOrCreatePlanProductId(
    stripeClient,
    plan,
    mode,
    snapshot.monthly.productId ?? snapshot.yearly.productId
  );

  if (interval === "month") {
    const createdMonthlyPrice = await stripeClient.prices.create({
      product: productId,
      unit_amount: monthlyCents,
      currency,
      recurring: { interval: "month" },
      metadata: {
        plan,
        stripe_mode: mode,
        billing_interval: "month",
        managed_by: "listflow_admin",
      },
    });

    await upsertDbPlanRow({
      plan,
      interval: "month",
      mode,
      stripeProductId: productId,
      stripePriceId: createdMonthlyPrice.id,
      amountCents: monthlyCents,
      currency,
    });

    return createdMonthlyPrice.id;
  }

  const yearlyCents = getYearlyCentsFromMonthly(monthlyCents);
  const yearlyPrice = await stripeClient.prices.create({
    product: productId,
    unit_amount: yearlyCents,
    currency,
    recurring: { interval: "year" },
    metadata: {
      plan,
      stripe_mode: mode,
      billing_interval: "year",
      discount_percent: String(YEARLY_DISCOUNT_PERCENT),
      managed_by: "listflow_admin",
    },
  });

  await upsertDbPlanRow({
    plan,
    interval: "year",
    mode,
    stripeProductId: productId,
    stripePriceId: yearlyPrice.id,
    amountCents: yearlyCents,
    currency,
  });

  return yearlyPrice.id;
};

export const upsertPlanPrice = async ({
  plan,
  interval,
  amount,
  currency = "usd",
  productId,
  deactivatePrevious = true,
  mode,
}: {
  plan: BillingPlan;
  interval: BillingInterval;
  amount: number;
  currency?: string;
  productId?: string;
  deactivatePrevious?: boolean;
  mode?: StripeMode;
}) => {
  const targetMode = mode ?? getActiveStripeMode();
  const stripeClient = getStripeClientForMode(targetMode);
  const amountCents = Math.round(amount * 100);

  if (amountCents <= 0) {
    throw new Error("amount must be greater than zero");
  }

  const snapshot = await getPlanPricingSnapshot({ mode: targetMode });
  const current = snapshot.find((item) => item.plan === plan);

  const targetProductId = await getOrCreatePlanProductId(
    stripeClient,
    plan,
    targetMode,
    productId ?? current?.monthly.productId ?? current?.yearly.productId
  );

  await stripeClient.products.update(targetProductId, {
    metadata: {
      plan,
      stripe_mode: targetMode,
      managed_by: "listflow_admin",
    },
  });

  const newPrice = await stripeClient.prices.create({
    product: targetProductId,
    unit_amount: amountCents,
    currency,
    recurring: { interval },
    metadata: {
      plan,
      stripe_mode: targetMode,
      billing_interval: interval,
      managed_by: "listflow_admin",
    },
  });

  const previousPriceId = interval === "year" ? current?.yearly.priceId : current?.monthly.priceId;

  if (deactivatePrevious && previousPriceId && previousPriceId !== newPrice.id) {
    try {
      await stripeClient.prices.update(previousPriceId, { active: false });
    } catch {
      // no-op: not blocking admin update if legacy price cannot be deactivated
    }
  }

  await upsertDbPlanRow({
    plan,
    interval,
    mode: targetMode,
    stripeProductId: targetProductId,
    stripePriceId: newPrice.id,
    amountCents,
    currency,
  });

  return {
    mode: targetMode,
    productId: targetProductId,
    priceId: newPrice.id,
    deactivatedPriceId: previousPriceId && previousPriceId !== newPrice.id ? previousPriceId : null,
  };
};

export const getSubscriptionCatalog = async (
  options: PlanOptions = {}
): Promise<StripeCatalogProduct[]> => {
  const mode = options.mode ?? getActiveStripeMode();
  const stripeClient = getStripeClientForMode(mode);
  const prices = await listPricesForDiscovery(stripeClient);
  const grouped = new Map<string, StripeCatalogProduct>();

  for (const price of prices) {
    const interval = resolveIntervalFromPrice(price, mode);
    if (!interval) {
      continue;
    }

    const product = extractProduct(price);

    if (!grouped.has(product.productId)) {
      grouped.set(product.productId, {
        productId: product.productId,
        name: product.productName ?? "Unnamed Product",
        active: true,
        metadata: product.productMetadata ?? {},
        prices: [],
      });
    }

    const bucket = grouped.get(product.productId);
    if (!bucket) {
      continue;
    }

    bucket.prices.push({
      priceId: price.id,
      interval,
      amountCents: price.unit_amount ?? 0,
      currency: price.currency ?? "usd",
      active: Boolean(price.active),
      created: price.created ?? 0,
    });
  }

  for (const product of grouped.values()) {
    product.prices.sort((a, b) => b.created - a.created);
  }

  return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));
};

export const getPublicPlanPricing = async (options: PlanOptions = {}) => {
  const snapshot = await getPlanPricingSnapshot(options);

  return snapshot.map((plan) => {
    const monthly = plan.monthly.amountCents ?? PLAN_TO_MONTHLY_CENTS[plan.plan];
    const yearly = plan.yearly.amountCents ?? getYearlyCentsFromMonthly(monthly);

    return {
      mode: plan.mode,
      plan: plan.plan,
      monthlyCents: monthly,
      yearlyCents: yearly,
      yearlyDiscountPercent: plan.yearlyDiscountPercent || YEARLY_DISCOUNT_PERCENT,
    };
  });
};
