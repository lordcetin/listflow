"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type RevenuePoint = {
  monthKey: string;
  monthLabel: string;
  revenueCents: number;
  revenueAmount: number;
  transactionCount: number;
};

type RevenueTrendResponse = {
  months: number;
  mode?: "live" | "test" | "all";
  currencyFilter?: "all" | "usd" | "try";
  source?: string;
  warnings?: string[];
  currency: string;
  series: RevenuePoint[];
  seriesByCurrency?: Record<string, RevenuePoint[]>;
  totals: {
    totalVolumeCents: number;
    totalVolumeAmount: number;
    totalTransactions: number;
    currentMonthCents: number;
    currentMonthAmount: number;
    momPercent: number;
  };
  totalsByCurrency?: Record<string, {
    totalVolumeCents: number;
    totalVolumeAmount: number;
    totalTransactions: number;
    currentMonthCents: number;
    currentMonthAmount: number;
    momPercent: number;
  }>;
  error?: string;
};

type CoverageMode = "live" | "test";
type CurrencyFilter = "all" | "usd" | "try";

type SubscriptionCoverageRow = {
  source: "supabase" | "stripe" | "both";
  stripeMode: "live" | "test" | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  amountCents: number | null;
  currency: string | null;
  userId: string | null;
  userEmail: string | null;
  storeId: string | null;
  shopId: string | null;
  plan: string | null;
  interval: "month" | "year" | null;
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

type CoverageResponse = {
  mode: CoverageMode;
  currencyFilter?: CurrencyFilter;
  rows?: SubscriptionCoverageRow[];
  summary?: CoverageSummary;
  summaryByCurrency?: Record<string, { total: number; both: number; stripeOnly: number; dbOnly: number; activeOrTrialing: number }>;
  warnings?: string[];
  sync?: {
    scanned: number;
    upserted: number;
    failed: number;
    failures: Array<{ stripeSubscriptionId: string; reason: string }>;
  };
  error?: string;
};

const normalizeCurrency = (currency: string | null | undefined) => (currency ?? "usd").toLowerCase();

const formatMoney = (value: number, currency: string | null | undefined = "usd") => {
  const normalized = normalizeCurrency(currency);
  const isoCurrency = normalized === "try" ? "TRY" : "USD";
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: isoCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatMoneyFromCents = (cents: number | null | undefined, currency: string | null | undefined = "usd") => {
  if (typeof cents !== "number") {
    return "-";
  }

  return formatMoney(cents / 100, currency);
};

const formatMoneyTick = (value: number, currency: string | null | undefined = "usd") => {
  const normalized = normalizeCurrency(currency);
  const symbol = normalized === "try" ? "₺" : "$";
  const formatted = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
  return `${symbol}${formatted}`;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("tr-TR");
};

const getStatusVariant = (status: string | null | undefined) => {
  const normalized = (status ?? "").toLowerCase();

  if (normalized === "active" || normalized === "trialing" || normalized === "paid" || normalized === "succeeded") {
    return "success" as const;
  }

  if (normalized === "canceled" || normalized === "unpaid" || normalized === "incomplete_expired" || normalized === "failed") {
    return "destructive" as const;
  }

  if (normalized === "incomplete" || normalized === "past_due" || normalized === "pending") {
    return "warning" as const;
  }

  return "secondary" as const;
};

const getSourceVariant = (source: SubscriptionCoverageRow["source"]) => {
  if (source === "both") {
    return "success" as const;
  }

  if (source === "stripe") {
    return "warning" as const;
  }

  return "secondary" as const;
};

export default function AdminSubscriptionsPage() {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<RevenueTrendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendWarnings, setTrendWarnings] = useState<string[]>([]);

  const [coverageMode, setCoverageMode] = useState<CoverageMode>("live");
  const [currencyFilter, setCurrencyFilter] = useState<CurrencyFilter>("all");
  const [coverageRows, setCoverageRows] = useState<SubscriptionCoverageRow[]>([]);
  const [coverageSummary, setCoverageSummary] = useState<CoverageSummary | null>(null);
  const [coverageSummaryByCurrency, setCoverageSummaryByCurrency] = useState<
    Record<string, { total: number; both: number; stripeOnly: number; dbOnly: number; activeOrTrialing: number }>
  >({});
  const [coverageWarnings, setCoverageWarnings] = useState<string[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageSyncing, setCoverageSyncing] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverageInfo, setCoverageInfo] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadRevenueTrend = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/admin/analytics/revenue-trend?months=${months}&mode=${coverageMode}&currency=${currencyFilter}`,
          {
            cache: "no-store",
          }
        );
        const payload = (await response.json()) as RevenueTrendResponse;

        if (!response.ok) {
          throw new Error(payload.error || "Revenue trend yüklenemedi.");
        }

        if (mounted) {
          setData(payload);
          setTrendWarnings(payload.warnings ?? []);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Revenue trend yüklenemedi.");
          setData(null);
          setTrendWarnings([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadRevenueTrend();

    return () => {
      mounted = false;
    };
  }, [coverageMode, currencyFilter, months]);

  const loadCoverage = useCallback(async (mode: CoverageMode, currency: CurrencyFilter) => {
    setCoverageLoading(true);
    setCoverageError(null);

    try {
      const response = await fetch(`/api/admin/analytics/subscription-coverage?mode=${mode}&currency=${currency}`, {
          cache: "no-store",
        });
      const payload = (await response.json()) as CoverageResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Subscription coverage yüklenemedi.");
      }

      setCoverageRows(payload.rows ?? []);
      setCoverageSummary(payload.summary ?? null);
      setCoverageSummaryByCurrency(payload.summaryByCurrency ?? {});
      setCoverageWarnings(payload.warnings ?? []);
    } catch (err) {
      setCoverageError(err instanceof Error ? err.message : "Subscription coverage yüklenemedi.");
      setCoverageRows([]);
      setCoverageSummary(null);
      setCoverageSummaryByCurrency({});
      setCoverageWarnings([]);
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoverage(coverageMode, currencyFilter);
  }, [coverageMode, currencyFilter, loadCoverage]);

  const runCoverageSync = async () => {
    setCoverageSyncing(true);
    setCoverageError(null);
    setCoverageInfo(null);

    try {
      const response = await fetch("/api/admin/analytics/subscription-coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: coverageMode, currency: currencyFilter }),
      });
      const payload = (await response.json()) as CoverageResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Subscription sync başarısız.");
      }

      setCoverageRows(payload.rows ?? []);
      setCoverageSummary(payload.summary ?? null);
      setCoverageSummaryByCurrency(payload.summaryByCurrency ?? {});
      setCoverageWarnings(payload.warnings ?? []);

      const sync = payload.sync;
      setCoverageInfo(
        sync
          ? `Stripe tarama: ${sync.scanned}, Supabase upsert: ${sync.upserted}, hata: ${sync.failed}`
          : "Senkron tamamlandı."
      );
    } catch (err) {
      setCoverageError(err instanceof Error ? err.message : "Subscription sync başarısız.");
    } finally {
      setCoverageSyncing(false);
    }
  };

  const chartCurrency = useMemo(() => {
    if (currencyFilter !== "all") {
      return currencyFilter;
    }

    const availableCurrencies = Object.keys(data?.seriesByCurrency ?? {});
    if (availableCurrencies.includes("usd")) {
      return "usd";
    }
    if (availableCurrencies.includes("try")) {
      return "try";
    }

    return availableCurrencies[0] ?? "usd";
  }, [currencyFilter, data?.seriesByCurrency]);

  const chartRows = useMemo(() => {
    if (!data) {
      return [];
    }

    if (currencyFilter === "all") {
      return data.seriesByCurrency?.[chartCurrency] ?? data.series ?? [];
    }

    return data.series ?? [];
  }, [chartCurrency, currencyFilter, data]);

  const activeTotals = useMemo(() => {
    if (!data) {
      return null;
    }

    if (currencyFilter === "all") {
      return data.totalsByCurrency?.[chartCurrency] ?? data.totals;
    }

    return data.totals;
  }, [chartCurrency, currencyFilter, data]);

  const revenueColumns = useMemo<ColumnDef<RevenuePoint>[]>(
    () => [
      { accessorKey: "monthLabel", header: "Ay" },
      {
        accessorKey: "revenueAmount",
        header: "Gelir",
        cell: ({ row }) => <span>{formatMoney(row.original.revenueAmount, chartCurrency)}</span>,
      },
      { accessorKey: "transactionCount", header: "İşlem" },
    ],
    [chartCurrency]
  );

  const coverageColumns = useMemo<ColumnDef<SubscriptionCoverageRow>[]>(
    () => [
      {
        accessorKey: "amountCents",
        header: "Abonelik Ücreti",
        cell: ({ row }) => (
          <span className="text-xs font-black text-white">
            {formatMoneyFromCents(row.original.amountCents, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Durum",
        cell: ({ row }) => <Badge variant={getStatusVariant(row.original.status)}>{row.original.status || "-"}</Badge>,
      },
      {
        accessorKey: "source",
        header: "Kaynak",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Badge variant={getSourceVariant(row.original.source)}>{row.original.source}</Badge>
            <Badge variant="secondary">{row.original.stripeMode ?? "-"}</Badge>
          </div>
        ),
      },
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs font-black text-white">{row.original.plan || "-"}</p>
            <p className="text-xs text-slate-500">{row.original.interval || "-"}</p>
          </div>
        ),
      },
      {
        accessorKey: "userEmail",
        header: "Kullanıcı",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs text-slate-100 break-all">{row.original.userEmail || "-"}</p>
            <p className="text-xs text-slate-500 break-all">{row.original.userId || "-"}</p>
          </div>
        ),
      },
      {
        accessorKey: "storeId",
        header: "Mağaza",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs text-slate-200 break-all">{row.original.storeId || "-"}</p>
            <p className="text-xs text-slate-500 break-all">{row.original.shopId || "-"}</p>
          </div>
        ),
      },
      {
        accessorKey: "stripeSubscriptionId",
        header: "Stripe Subscription",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs text-slate-200 break-all">{row.original.stripeSubscriptionId || "-"}</p>
            <p className="text-xs text-slate-500 break-all">{row.original.stripeCustomerId || "-"}</p>
          </div>
        ),
      },
      {
        accessorKey: "currentPeriodEnd",
        header: "Dönem Sonu",
        cell: ({ row }) => <span className="text-xs">{formatDate(row.original.currentPeriodEnd)}</span>,
      },
      {
        accessorKey: "updatedAt",
        header: "Güncellendi",
        cell: ({ row }) => <span className="text-xs">{formatDate(row.original.updatedAt || row.original.createdAt)}</span>,
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <Card className="glass-card-pro rounded-[32px]">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-2">
              <Badge className="w-fit">Revenue Analytics</Badge>
              <CardTitle>Subscriptions Gelir Trendi</CardTitle>
              <CardDescription>Ödeme geçmişine göre aylık hacim, işlem adedi ve MoM trendi.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-36">
                <Select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value as CurrencyFilter)}>
                  <option value="all">All</option>
                  <option value="usd">USD</option>
                  <option value="try">TRY</option>
                </Select>
              </div>
              <div className="w-40">
                <Select value={String(months)} onChange={(event) => setMonths(Number(event.target.value))}>
                  <option value="6">Son 6 ay</option>
                  <option value="12">Son 12 ay</option>
                  <option value="18">Son 18 ay</option>
                  <option value="24">Son 24 ay</option>
                </Select>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Trend modu:</span>
            <Badge variant="secondary">{coverageMode === "live" ? "LIVE (gerçek ödeme)" : "TEST (test ödeme)"}</Badge>
            <span>Kaynak:</span>
            <Badge variant="secondary">{data?.source ?? "-"}</Badge>
            <span>Para birimi:</span>
            <Badge variant="secondary">{currencyFilter === "all" ? `ALL (${chartCurrency.toUpperCase()} chart)` : currencyFilter.toUpperCase()}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Analitik Yüklenemedi</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {trendWarnings.length ? (
            <Alert>
              <AlertTitle>Trend Uyarısı</AlertTitle>
              <AlertDescription>{trendWarnings.join(" | ")}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-80 w-full" />
            </div>
          ) : data && activeTotals ? (
            <>
              {currencyFilter === "all" && Object.keys(data.totalsByCurrency ?? {}).length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.entries(data.totalsByCurrency ?? {}).map(([currency, totals]) => (
                    <Card key={currency} className="rounded-2xl">
                      <CardHeader className="p-4">
                        <CardDescription>{currency.toUpperCase()} Toplam Hacim</CardDescription>
                        <CardTitle>{formatMoney(totals.totalVolumeAmount, currency)}</CardTitle>
                        <p className="text-xs text-slate-500">İşlem: {totals.totalTransactions}</p>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <Card className="rounded-2xl">
                  <CardHeader className="p-4">
                    <CardDescription>Toplam Hacim</CardDescription>
                    <CardTitle>{formatMoney(activeTotals.totalVolumeAmount, chartCurrency)}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="rounded-2xl">
                  <CardHeader className="p-4">
                    <CardDescription>Bu Ay Gelir</CardDescription>
                    <CardTitle>{formatMoney(activeTotals.currentMonthAmount, chartCurrency)}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="rounded-2xl">
                  <CardHeader className="p-4">
                    <CardDescription>Toplam İşlem</CardDescription>
                    <CardTitle>{activeTotals.totalTransactions}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="rounded-2xl">
                  <CardHeader className="p-4">
                    <CardDescription>MoM Değişim</CardDescription>
                    <CardTitle>{activeTotals.momPercent.toFixed(2)}%</CardTitle>
                  </CardHeader>
                </Card>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card className="rounded-2xl">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base">Aylık Gelir (Bar)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartRows}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                        <XAxis dataKey="monthLabel" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis
                          stroke="#94a3b8"
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                          tickFormatter={(value) => formatMoneyTick(Number(value), chartCurrency)}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#111218",
                            border: "1px solid rgba(148,163,184,0.2)",
                            borderRadius: 12,
                            color: "#fff",
                          }}
                          formatter={(value: number | string | undefined) => [
                            formatMoney(Number(value ?? 0), chartCurrency),
                            "Gelir",
                          ]}
                        />
                        <Bar dataKey="revenueAmount" name="Gelir" fill="#6366f1" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base">Trend Eğrisi (Line)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartRows}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                        <XAxis dataKey="monthLabel" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis
                          stroke="#94a3b8"
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                          tickFormatter={(value) => formatMoneyTick(Number(value), chartCurrency)}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#111218",
                            border: "1px solid rgba(148,163,184,0.2)",
                            borderRadius: 12,
                            color: "#fff",
                          }}
                          formatter={(value: number | string | undefined) => [
                            formatMoney(Number(value ?? 0), chartCurrency),
                            "Gelir",
                          ]}
                        />
                        <Line type="monotone" dataKey="revenueAmount" name="Gelir" stroke="#22d3ee" strokeWidth={3} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-2xl">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base">Aylık Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <DataTable
                    columns={revenueColumns}
                    data={chartRows}
                    searchPlaceholder="Ay bazlı gelir ara..."
                    pageSize={12}
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="text-sm text-slate-400">Veri bulunamadı.</div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card-pro rounded-[32px]">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-2">
              <Badge className="w-fit">Stripe + Supabase</Badge>
              <CardTitle>Abonelik Kapsamı ve Senkronizasyon</CardTitle>
              <CardDescription>
                Stripe geçmiş kayıtları ile Supabase abonelik tablosunu birleştirir, eksikleri tek tuşla Supabase&apos;e yazar.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={coverageMode} onChange={(event) => setCoverageMode(event.target.value as CoverageMode)}>
                <option value="live">Sadece Live</option>
                <option value="test">Sadece Test</option>
              </Select>
              <Select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value as CurrencyFilter)}>
                <option value="all">All</option>
                <option value="usd">USD</option>
                <option value="try">TRY</option>
              </Select>
              <Button
                variant="secondary"
                onClick={() => void loadCoverage(coverageMode, currencyFilter)}
                disabled={coverageLoading || coverageSyncing}
              >
                Yenile
              </Button>
              <Button onClick={runCoverageSync} disabled={coverageLoading || coverageSyncing}>
                {coverageSyncing ? "Senkron..." : "Stripe -> Supabase Senkronize Et"}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Aktif görünüm:</span>
            <Badge variant="secondary">{coverageMode === "live" ? "LIVE (gerçek ödeme)" : "TEST (test ödeme)"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {coverageError ? (
            <Alert variant="destructive">
              <AlertTitle>Abonelik Senkron Hatası</AlertTitle>
              <AlertDescription>{coverageError}</AlertDescription>
            </Alert>
          ) : null}

          {coverageInfo ? (
            <Alert variant="success">
              <AlertTitle>Senkron Sonucu</AlertTitle>
              <AlertDescription>{coverageInfo}</AlertDescription>
            </Alert>
          ) : null}

          {coverageWarnings.length ? (
            <Alert>
              <AlertTitle>Uyarı</AlertTitle>
              <AlertDescription>{coverageWarnings.join(" | ")}</AlertDescription>
            </Alert>
          ) : null}

          {coverageSummary ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">DB: {coverageSummary.dbCount}</Badge>
              <Badge variant="secondary">Stripe: {coverageSummary.stripeCount}</Badge>
              <Badge variant="success">Eşleşen: {coverageSummary.bothCount}</Badge>
              <Badge variant="warning">Stripe-only: {coverageSummary.stripeOnlyCount}</Badge>
              <Badge variant="secondary">DB-only: {coverageSummary.dbOnlyCount}</Badge>
              <Badge variant="default">Aktif/Trialing: {coverageSummary.activeOrTrialingCount}</Badge>
            </div>
          ) : null}

          {currencyFilter === "all" && Object.keys(coverageSummaryByCurrency).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(coverageSummaryByCurrency).map(([currency, summary]) => (
                <Badge key={currency} variant="secondary">
                  {currency.toUpperCase()}: {summary.total} (active/trialing {summary.activeOrTrialing})
                </Badge>
              ))}
            </div>
          ) : null}

          {coverageLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
          ) : (
            <DataTable
              columns={coverageColumns}
              data={coverageRows}
              searchPlaceholder="Abonelik, kullanıcı, mağaza, plan ara..."
              pageSize={12}
              statusFilterKey="status"
              dateFilterKey="updatedAt"
              dateFilterLabel="Güncelleme Aralığı"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
