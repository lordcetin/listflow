type StripeMode = "live" | "test";

const isLiveSecretKey = (value: string) => value.startsWith("sk_live_") || value.startsWith("rk_live_");
const isTestSecretKey = (value: string) => value.startsWith("sk_test_") || value.startsWith("rk_test_");

const readRequiredServerEnv = (key: string) => {
  const value = process.env[key];

  if (!value || !value.trim()) {
    throw new Error(`Missing required server environment variable: ${key}`);
  }

  return value;
};

const readOptionalServerEnv = (key: string) => {
  const value = process.env[key];

  if (!value || !value.trim()) {
    return null;
  }

  return value;
};

const readStripeMode = (): StripeMode => {
  const raw = readOptionalServerEnv("STRIPE_MODE");

  if (!raw) {
    return "live";
  }

  const normalized = raw.toLowerCase();
  if (normalized === "live" || normalized === "test") {
    return normalized;
  }

  throw new Error(`Invalid STRIPE_MODE value: ${raw}. Expected "live" or "test".`);
};

const readStripeModeRequired = (
  stripeMode: StripeMode,
  keys: {
    live: string[];
    test: string[];
  },
  label: string
) => {
  const candidates = stripeMode === "test" ? keys.test : keys.live;

  for (const key of candidates) {
    const value = readOptionalServerEnv(key);
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing required server environment variable: ${label} (mode=${stripeMode})`);
};

const readStripeModeOptional = (
  stripeMode: StripeMode,
  keys: {
    live: string[];
    test: string[];
  }
) => {
  const candidates = stripeMode === "test" ? keys.test : keys.live;

  for (const key of candidates) {
    const value = readOptionalServerEnv(key);
    if (value) {
      return value;
    }
  }

  return null;
};

const resolveStripeMode = () => readStripeMode();

const resolveStripeSecretKey = (stripeMode: StripeMode) => {
  const stripeSecretKey = readStripeModeRequired(
    stripeMode,
    {
      live: ["STRIPE_SECRET_KEY_LIVE", "STRIPE_SECRET_KEY"],
      test: ["STRIPE_SECRET_KEY_TEST", "STRIPE_TEST_SECRET", "STRIPE_SECRET_KEY"],
    },
    "STRIPE_SECRET_KEY[_LIVE|_TEST] / STRIPE_TEST_SECRET"
  );

  if (stripeMode === "live" && isTestSecretKey(stripeSecretKey)) {
    throw new Error("Invalid Stripe configuration: STRIPE_MODE=live but resolved secret key is test.");
  }

  if (stripeMode === "test" && isLiveSecretKey(stripeSecretKey)) {
    throw new Error("Invalid Stripe configuration: STRIPE_MODE=test but resolved secret key is live.");
  }

  return stripeSecretKey;
};

export const serverEnv = {
  NEXT_PUBLIC_SUPABASE_URL: readRequiredServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: readRequiredServerEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: readRequiredServerEnv("SUPABASE_SERVICE_ROLE_KEY"),
  CRON_SECRET: readRequiredServerEnv("CRON_SECRET"),
  CRON_JOB_ORG_API_KEY: readOptionalServerEnv("CRON_JOB_ORG_API_KEY"),
  CRON_JOB_ORG_JOB_ID: readOptionalServerEnv("CRON_JOB_ORG_JOB_ID"),
  CRON_SCHEDULER_BASE_URL: readOptionalServerEnv("CRON_SCHEDULER_BASE_URL"),
  get STRIPE_MODE() {
    return resolveStripeMode();
  },
  get STRIPE_SECRET_KEY() {
    const stripeMode = resolveStripeMode();
    return resolveStripeSecretKey(stripeMode);
  },
  get STRIPE_WEBHOOK_SECRET() {
    const stripeMode = resolveStripeMode();
    return readStripeModeRequired(
      stripeMode,
      {
        live: ["STRIPE_WEBHOOK_SECRET_LIVE", "STRIPE_WEBHOOK_SECRET"],
        test: ["STRIPE_WEBHOOK_SECRET_TEST", "STRIPE_WEBHOOK_SECRET"],
      },
      "STRIPE_WEBHOOK_SECRET[_LIVE|_TEST]"
    );
  },
  get STRIPE_PRICE_STANDARD() {
    const stripeMode = resolveStripeMode();
    return readStripeModeRequired(
      stripeMode,
      {
        live: ["STRIPE_PRICE_STANDARD_LIVE", "STRIPE_PRICE_STANDARD"],
        test: ["STRIPE_PRICE_STANDARD_TEST", "STRIPE_PRICE_STANDARD"],
      },
      "STRIPE_PRICE_STANDARD[_LIVE|_TEST]"
    );
  },
  get STRIPE_PRICE_PRO() {
    const stripeMode = resolveStripeMode();
    return readStripeModeRequired(
      stripeMode,
      {
        live: ["STRIPE_PRICE_PRO_LIVE", "STRIPE_PRICE_PRO"],
        test: ["STRIPE_PRICE_PRO_TEST", "STRIPE_PRICE_PRO"],
      },
      "STRIPE_PRICE_PRO[_LIVE|_TEST]"
    );
  },
  get STRIPE_PRICE_TURBO() {
    const stripeMode = resolveStripeMode();
    return readStripeModeRequired(
      stripeMode,
      {
        live: ["STRIPE_PRICE_TURBO_LIVE", "STRIPE_PRICE_TURBO"],
        test: ["STRIPE_PRICE_TURBO_TEST", "STRIPE_PRICE_TURBO"],
      },
      "STRIPE_PRICE_TURBO[_LIVE|_TEST]"
    );
  },
  get STRIPE_PRICE_STANDARD_YEARLY() {
    const stripeMode = resolveStripeMode();
    return readStripeModeOptional(stripeMode, {
      live: ["STRIPE_PRICE_STANDARD_YEARLY_LIVE", "STRIPE_PRICE_STANDARD_YEARLY"],
      test: ["STRIPE_PRICE_STANDARD_YEARLY_TEST", "STRIPE_PRICE_STANDARD_YEARLY"],
    });
  },
  get STRIPE_PRICE_PRO_YEARLY() {
    const stripeMode = resolveStripeMode();
    return readStripeModeOptional(stripeMode, {
      live: ["STRIPE_PRICE_PRO_YEARLY_LIVE", "STRIPE_PRICE_PRO_YEARLY"],
      test: ["STRIPE_PRICE_PRO_YEARLY_TEST", "STRIPE_PRICE_PRO_YEARLY"],
    });
  },
  get STRIPE_PRICE_TURBO_YEARLY() {
    const stripeMode = resolveStripeMode();
    return readStripeModeOptional(stripeMode, {
      live: ["STRIPE_PRICE_TURBO_YEARLY_LIVE", "STRIPE_PRICE_TURBO_YEARLY"],
      test: ["STRIPE_PRICE_TURBO_YEARLY_TEST", "STRIPE_PRICE_TURBO_YEARLY"],
    });
  },
  APP_URL: readRequiredServerEnv("APP_URL"),
} as const;
