import Stripe from "stripe";
import { serverEnv } from "@/lib/env/server";

export type BillingPlan = "standard" | "pro" | "turbo";
export type BillingInterval = "month" | "year";
export type StripeMode = "live" | "test";

const PLAN_KEY_SUFFIX: Record<BillingPlan, string> = {
  standard: "STANDARD",
  pro: "PRO",
  turbo: "TURBO",
};

const isLiveSecretKey = (value: string) => value.startsWith("sk_live_") || value.startsWith("rk_live_");
const isTestSecretKey = (value: string) => value.startsWith("sk_test_") || value.startsWith("rk_test_");

const stripeClientCache = new Map<StripeMode, Stripe>();
const ACTIVE_STRIPE_MODE: StripeMode = serverEnv.STRIPE_MODE;

const readOptionalEnv = (key: string) => {
  const value = process.env[key];
  return value && value.trim() ? value : null;
};

const readRequiredEnv = (keys: string[], errorLabel: string) => {
  for (const key of keys) {
    const value = readOptionalEnv(key);
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing required Stripe environment variable: ${errorLabel}`);
};

const includeBaseKeyForMode = (mode: StripeMode) => {
  return ACTIVE_STRIPE_MODE === mode;
};

const assertSecretKeyMatchesMode = (mode: StripeMode, secretKey: string) => {
  if (mode === "live" && isTestSecretKey(secretKey)) {
    throw new Error("Invalid Stripe configuration: mode=live but resolved key is test.");
  }

  if (mode === "test" && isLiveSecretKey(secretKey)) {
    throw new Error("Invalid Stripe configuration: mode=test but resolved key is live.");
  }
};

const getSecretKeyForMode = (mode: StripeMode) => {
  if (mode === "live") {
    const secret = readRequiredEnv(
      includeBaseKeyForMode("live")
        ? ["STRIPE_SECRET_KEY_LIVE", "STRIPE_SECRET_KEY"]
        : ["STRIPE_SECRET_KEY_LIVE"],
      "STRIPE_SECRET_KEY_LIVE (or STRIPE_SECRET_KEY when STRIPE_MODE=live)"
    );

    assertSecretKeyMatchesMode(mode, secret);
    return secret;
  }

  const secret = readRequiredEnv(
    includeBaseKeyForMode("test")
      ? ["STRIPE_SECRET_KEY_TEST", "STRIPE_TEST_SECRET", "STRIPE_SECRET_KEY"]
      : ["STRIPE_SECRET_KEY_TEST", "STRIPE_TEST_SECRET"],
    "STRIPE_SECRET_KEY_TEST or STRIPE_TEST_SECRET (or STRIPE_SECRET_KEY when STRIPE_MODE=test)"
  );

  assertSecretKeyMatchesMode(mode, secret);
  return secret;
};

const getPriceIdForMode = (plan: BillingPlan, interval: BillingInterval, mode: StripeMode): string | null => {
  const planKey = PLAN_KEY_SUFFIX[plan];
  const intervalPart = interval === "year" ? "_YEARLY" : "";
  const scopedKey = `STRIPE_PRICE_${planKey}${intervalPart}_${mode.toUpperCase()}`;
  const scopedValue = readOptionalEnv(scopedKey);

  if (scopedValue) {
    return scopedValue;
  }

  if (includeBaseKeyForMode(mode)) {
    const baseKey = `STRIPE_PRICE_${planKey}${intervalPart}`;
    return readOptionalEnv(baseKey);
  }

  return null;
};

export const getStripeClientForMode = (mode: StripeMode = ACTIVE_STRIPE_MODE) => {
  const cached = stripeClientCache.get(mode);
  if (cached) {
    return cached;
  }

  const next = new Stripe(getSecretKeyForMode(mode));
  stripeClientCache.set(mode, next);
  return next;
};

export const resolveStripeMode = (value: string | null | undefined, fallback: StripeMode = ACTIVE_STRIPE_MODE): StripeMode => {
  if (value === "live" || value === "test") {
    return value;
  }

  return fallback;
};

export const getConfiguredPriceIdForMode = (
  plan: BillingPlan,
  interval: BillingInterval,
  mode: StripeMode = ACTIVE_STRIPE_MODE
) => {
  return getPriceIdForMode(plan, interval, mode);
};

export const PLAN_TO_PRICE = {
  standard: getConfiguredPriceIdForMode("standard", "month", ACTIVE_STRIPE_MODE),
  pro: getConfiguredPriceIdForMode("pro", "month", ACTIVE_STRIPE_MODE),
  turbo: getConfiguredPriceIdForMode("turbo", "month", ACTIVE_STRIPE_MODE),
} satisfies Record<BillingPlan, string | null>;

export const PLAN_TO_YEARLY_PRICE = {
  standard: getConfiguredPriceIdForMode("standard", "year", ACTIVE_STRIPE_MODE),
  pro: getConfiguredPriceIdForMode("pro", "year", ACTIVE_STRIPE_MODE),
  turbo: getConfiguredPriceIdForMode("turbo", "year", ACTIVE_STRIPE_MODE),
} satisfies Record<BillingPlan, string | null>;

export const YEARLY_DISCOUNT_PERCENT = 25;

export const PLAN_TO_MONTHLY_CENTS: Record<BillingPlan, number> = {
  standard: 2990,
  pro: 4990,
  turbo: 7990,
};

export const getYearlyCentsFromMonthly = (monthlyCents: number) => {
  return Math.round(monthlyCents * 12 * (1 - YEARLY_DISCOUNT_PERCENT / 100));
};

export const PLAN_TO_YEARLY_CENTS: Record<BillingPlan, number> = {
  standard: getYearlyCentsFromMonthly(PLAN_TO_MONTHLY_CENTS.standard),
  pro: getYearlyCentsFromMonthly(PLAN_TO_MONTHLY_CENTS.pro),
  turbo: getYearlyCentsFromMonthly(PLAN_TO_MONTHLY_CENTS.turbo),
};

export const getPlanCentsByInterval = (plan: BillingPlan, interval: BillingInterval) => {
  if (interval === "year") {
    return PLAN_TO_YEARLY_CENTS[plan];
  }

  return PLAN_TO_MONTHLY_CENTS[plan];
};

export const getActiveStripeMode = () => ACTIVE_STRIPE_MODE;
