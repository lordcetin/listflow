import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { getStripeClientForMode, type StripeMode } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RevenuePoint = {
  monthKey: string;
  monthLabel: string;
  revenueCents: number;
  transactionCount: number;
};

type RevenueMode = StripeMode | "all";
type CurrencyFilter = "all" | "usd" | "try";

type PaymentRow = {
  amount_cents: number | null;
  created_at: string | null;
  currency: string | null;
  status?: string | null;
  stripe_subscription_id?: string | null;
  stripe_invoice_id?: string | null;
};

type RevenueRecord = {
  id: string;
  amount_cents: number;
  created_at: string;
  currency: string;
  stripe_subscription_id: string | null;
  stripe_invoice_id: string | null;
  source: "payments" | `stripe_${StripeMode}`;
};

const isPaidLikeStatus = (status: string | null | undefined) => {
  const normalized = (status ?? "").toLowerCase();
  return normalized === "paid" || normalized === "succeeded" || normalized === "complete" || normalized === "completed";
};

const toMonthKey = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const toMonthLabel = (date: Date) => {
  return new Intl.DateTimeFormat("tr-TR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

const buildInitialSeries = (months: number, now = new Date()) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  start.setUTCMonth(start.getUTCMonth() - (months - 1));

  const points: RevenuePoint[] = [];

  for (let index = 0; index < months; index += 1) {
    const date = new Date(start);
    date.setUTCMonth(start.getUTCMonth() + index);

    points.push({
      monthKey: toMonthKey(date),
      monthLabel: toMonthLabel(date),
      revenueCents: 0,
      transactionCount: 0,
    });
  }

  return points;
};

const parseMonths = (value: string | null) => {
  if (!value) {
    return 12;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return 12;
  }

  return Math.min(Math.max(Math.round(parsed), 1), 24);
};

const parseRevenueMode = (value: string | null): RevenueMode => {
  if (value === "live" || value === "test" || value === "all") {
    return value;
  }

  return "all";
};

const parseCurrencyFilter = (value: string | null): CurrencyFilter => {
  if (value === "usd" || value === "try" || value === "all") {
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

const toStripeModes = (mode: RevenueMode): StripeMode[] => {
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

const resolveInvoiceSubscriptionId = (invoice: Stripe.Invoice) => {
  const byParent =
    typeof invoice.parent?.subscription_details?.subscription === "string"
      ? invoice.parent.subscription_details.subscription
      : null;

  if (byParent) {
    return byParent;
  }

  const legacy = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };

  return typeof legacy.subscription === "string" ? legacy.subscription : null;
};

const loadRecurringPaymentsFromDb = async (fromIso: string) => {
  const withInvoiceColumn = await supabaseAdmin
    .from("payments")
    .select("amount_cents, created_at, currency, status, stripe_subscription_id, stripe_invoice_id")
    .gte("created_at", fromIso)
    .order("created_at", { ascending: true });

  let rows = withInvoiceColumn.data as PaymentRow[] | null;
  let rowsError = withInvoiceColumn.error;

  if (withInvoiceColumn.error && isMissingColumnError(withInvoiceColumn.error, "stripe_invoice_id")) {
    const fallback = await supabaseAdmin
      .from("payments")
      .select("amount_cents, created_at, currency, status, stripe_subscription_id")
      .gte("created_at", fromIso)
      .order("created_at", { ascending: true });

    rows = (fallback.data ?? []) as PaymentRow[];
    rowsError = fallback.error;
  }

  if (rowsError) {
    if (isMissingRelationError(rowsError)) {
      return [] as RevenueRecord[];
    }

    throw new Error(rowsError.message);
  }

  const recurringPaid = (rows ?? []).filter(
    (row) =>
      Boolean(row.created_at) &&
      Boolean(row.stripe_subscription_id) &&
      Number(row.amount_cents ?? 0) > 0 &&
      isPaidLikeStatus(row.status)
  );

  return recurringPaid.map((row, index) => ({
    id: `payments:${row.stripe_invoice_id ?? row.stripe_subscription_id ?? index}`,
    amount_cents: Number(row.amount_cents ?? 0),
    created_at: row.created_at as string,
    currency: row.currency ?? "usd",
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    stripe_invoice_id: row.stripe_invoice_id ?? null,
    source: "payments" as const,
  }));
};

const loadRecurringPaymentsFromStripe = async (mode: RevenueMode, fromUnix: number) => {
  const warnings: string[] = [];
  const records: RevenueRecord[] = [];
  const targetModes = toStripeModes(mode);

  for (const targetMode of targetModes) {
    try {
      const stripe = getStripeClientForMode(targetMode);
      let cursor: string | undefined;

      for (let page = 0; page < 100; page += 1) {
        const response = await stripe.invoices.list({
          limit: 100,
          starting_after: cursor,
          created: { gte: fromUnix },
        });

        if (!response.data.length) {
          break;
        }

        for (const invoice of response.data) {
          const subscriptionId = resolveInvoiceSubscriptionId(invoice);
          const amount = Number(invoice.amount_paid || invoice.amount_due || 0);

          if (!subscriptionId || !invoice.created || amount <= 0) {
            continue;
          }

          if ((invoice.status ?? "").toLowerCase() !== "paid") {
            continue;
          }

          records.push({
            id: `stripe:${targetMode}:${invoice.id}`,
            amount_cents: amount,
            created_at: new Date(invoice.created * 1000).toISOString(),
            currency: invoice.currency ?? "usd",
            stripe_subscription_id: subscriptionId,
            stripe_invoice_id: invoice.id,
            source: `stripe_${targetMode}` as const,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe invoices could not be loaded";
      warnings.push(`${targetMode} mode okunamadı: ${message}`);
    }
  }

  return { records, warnings };
};

const aggregateSeries = (records: RevenueRecord[], months: number) => {
  const initialSeries = buildInitialSeries(months);
  const monthMap = new Map(initialSeries.map((point) => [point.monthKey, point]));
  let totalVolumeCents = 0;
  let totalTransactions = 0;
  let currency = "usd";

  for (const record of records) {
    const date = new Date(record.created_at);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const key = toMonthKey(date);
    const point = monthMap.get(key);
    if (!point) {
      continue;
    }

    point.revenueCents += record.amount_cents;
    point.transactionCount += 1;
    totalVolumeCents += record.amount_cents;
    totalTransactions += 1;
    currency = normalizeCurrency(record.currency) || currency;
  }

  const series = initialSeries;
  const last = series[series.length - 1];
  const previous = series[series.length - 2];
  const currentMonthCents = last?.revenueCents ?? 0;
  const previousMonthCents = previous?.revenueCents ?? 0;

  const momPercent =
    previousMonthCents <= 0
      ? currentMonthCents > 0
        ? 100
        : 0
      : Number((((currentMonthCents - previousMonthCents) / previousMonthCents) * 100).toFixed(2));

  return {
    currency,
    series: series.map((point) => ({
      monthKey: point.monthKey,
      monthLabel: point.monthLabel,
      revenueCents: point.revenueCents,
      revenueAmount: point.revenueCents / 100,
      transactionCount: point.transactionCount,
    })),
    totals: {
      totalVolumeCents,
      totalVolumeAmount: totalVolumeCents / 100,
      totalTransactions,
      currentMonthCents,
      currentMonthAmount: currentMonthCents / 100,
      momPercent,
    },
  };
};

const aggregateCurrencyBreakdown = (records: RevenueRecord[], months: number) => {
  const grouped = new Map<string, RevenueRecord[]>();

  for (const record of records) {
    const currency = normalizeCurrency(record.currency);
    const bucket = grouped.get(currency) ?? [];
    bucket.push({
      ...record,
      currency,
    });
    grouped.set(currency, bucket);
  }

  const seriesByCurrency: Record<string, ReturnType<typeof aggregateSeries>["series"]> = {};
  const totalsByCurrency: Record<string, ReturnType<typeof aggregateSeries>["totals"]> = {};

  for (const [currency, currencyRecords] of grouped.entries()) {
    const aggregate = aggregateSeries(currencyRecords, months);
    seriesByCurrency[currency] = aggregate.series;
    totalsByCurrency[currency] = aggregate.totals;
  }

  return { seriesByCurrency, totalsByCurrency };
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const months = parseMonths(request.nextUrl.searchParams.get("months"));
  const mode = parseRevenueMode(request.nextUrl.searchParams.get("mode"));
  const currencyFilter = parseCurrencyFilter(request.nextUrl.searchParams.get("currency"));
  const initialSeries = buildInitialSeries(months);
  const firstKey = initialSeries[0]?.monthKey;

  if (!firstKey) {
    return NextResponse.json({ error: "Invalid month range" }, { status: 400 });
  }

  const firstMonthDate = new Date(`${firstKey}-01T00:00:00.000Z`);
  const firstMonthUnix = Math.floor(firstMonthDate.getTime() / 1000);

  try {
    const dbRecords = await loadRecurringPaymentsFromDb(firstMonthDate.toISOString());
    const stripe = await loadRecurringPaymentsFromStripe(mode, firstMonthUnix);

    const dbInvoiceIds = new Set(
      dbRecords
        .map((record) => record.stripe_invoice_id)
        .filter((value): value is string => Boolean(value))
    );

    const mergedRecords = [
      ...dbRecords,
      ...stripe.records.filter((record) => !(record.stripe_invoice_id && dbInvoiceIds.has(record.stripe_invoice_id))),
    ];

    const currencyAwareRecords = mergedRecords.map((record) => ({
      ...record,
      currency: normalizeCurrency(record.currency),
    }));

    const filteredRecords =
      currencyFilter === "all"
        ? currencyAwareRecords
        : currencyAwareRecords.filter((record) => record.currency === currencyFilter);

    const aggregated = aggregateSeries(filteredRecords, months);
    const { seriesByCurrency, totalsByCurrency } = aggregateCurrencyBreakdown(currencyAwareRecords, months);
    const hasDb = dbRecords.length > 0;
    const hasStripe = stripe.records.length > 0;

    return NextResponse.json({
      months,
      mode,
      currencyFilter,
      source: hasDb && hasStripe ? "payments_plus_stripe" : hasDb ? "payments_recurring" : "stripe_invoices",
      warnings: stripe.warnings,
      ...aggregated,
      currency: currencyFilter === "all" ? "mixed" : currencyFilter,
      seriesByCurrency,
      totalsByCurrency,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Revenue trend could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
