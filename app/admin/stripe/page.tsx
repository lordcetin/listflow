"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type BillingPlan = "standard" | "pro" | "turbo";
type BillingInterval = "month" | "year";
type StripeMode = "live" | "test";

type StripeHealthEvent = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  processed_at: string;
};

type StripeHealthSource = "webhook_db" | "stripe_api";

type PlanPriceSnapshot = {
  plan: BillingPlan;
  interval: BillingInterval;
  priceId: string | null;
  productId: string | null;
  productName: string | null;
  amountCents: number | null;
  currency: string | null;
  active: boolean;
  created: number | null;
};

type PlanPricingSnapshot = {
  plan: BillingPlan;
  monthly: PlanPriceSnapshot;
  yearly: PlanPriceSnapshot;
  yearlyDiscountPercent: number;
};

type StripeCatalogProduct = {
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

type PlanEditorState = Record<BillingPlan, { month: string; year: string; productId: string }>;

type CatalogTableRow = {
  productId: string;
  productName: string;
  active: boolean;
  interval: BillingInterval;
  amountCents: number;
  currency: string;
  priceId: string;
};

const PLAN_LABELS: Record<BillingPlan, string> = {
  standard: "Standard",
  pro: "Pro",
  turbo: "Turbo",
};

const PLAN_ORDER: BillingPlan[] = ["standard", "pro", "turbo"];
const STRIPE_EVENT_TR: Record<string, string> = {
  "checkout.session.completed": "Ödeme Oturumu Tamamlandı",
  "checkout.session.expired": "Oturum Süresi Doldu",
  "checkout.session.async_payment_succeeded": "Asenkron Ödeme Başarılı",
  "checkout.session.async_payment_failed": "Asenkron Ödeme Başarısız",
  "customer.subscription.created": "Abonelik Oluşturuldu",
  "customer.subscription.updated": "Abonelik Güncellendi",
  "customer.subscription.deleted": "Abonelik İptal Edildi",
  "customer.subscription.paused": "Abonelik Duraklatıldı",
  "customer.subscription.resumed": "Abonelik Devam Ettirildi",
  "customer.subscription.trial_will_end": "Deneme Süresi Bitmek Üzere",
  "customer.subscription.pending_update_applied": "Bekleyen Abonelik Güncellemesi Uygulandı",
  "customer.subscription.pending_update_expired": "Bekleyen Abonelik Güncellemesi Süresi Doldu",
  "invoice.created": "Fatura Oluşturuldu",
  "invoice.finalized": "Fatura Kesildi",
  "invoice.paid": "Fatura Ödendi",
  "invoice.payment_failed": "Fatura Ödemesi Başarısız",
  "invoice.payment_action_required": "Fatura İçin Ek Doğrulama Gerekli",
  "invoice.upcoming": "Yaklaşan Fatura Oluştu",
  "invoice.voided": "Fatura İptal Edildi",
  "invoice.marked_uncollectible": "Fatura Tahsil Edilemez Olarak İşaretlendi",
  "payment_intent.created": "Ödeme Niyeti Oluşturuldu",
  "payment_intent.succeeded": "Ödeme Başarılı",
  "payment_intent.payment_failed": "Ödeme Başarısız",
  "charge.succeeded": "Tahsilat Başarılı",
  "charge.failed": "Tahsilat Başarısız",
  "charge.refunded": "Ödeme İade Edildi",
  "customer.created": "Müşteri Oluşturuldu",
  "customer.updated": "Müşteri Güncellendi",
};

const getEventLabel = (eventType: string) => STRIPE_EVENT_TR[eventType] ?? "Tanımsız Stripe Olayı";

const formatUsd = (amountCents: number | null | undefined) => {
  if (typeof amountCents !== "number") {
    return "-";
  }

  return `$${(amountCents / 100).toFixed(2)}`;
};

const toInputValue = (amountCents: number | null | undefined) => {
  if (typeof amountCents !== "number") {
    return "";
  }

  return (amountCents / 100).toFixed(2);
};

const toYearlyDiscountValue = (monthlyAmountText: string) => {
  const monthly = Number(monthlyAmountText);
  if (Number.isNaN(monthly) || monthly <= 0) {
    return "";
  }

  return (monthly * 12 * 0.75).toFixed(2);
};

export default function AdminStripePage() {
  const [plans, setPlans] = useState<PlanPricingSnapshot[]>([]);
  const [catalog, setCatalog] = useState<StripeCatalogProduct[]>([]);
  const [events, setEvents] = useState<StripeHealthEvent[]>([]);
  const [selectedMode, setSelectedMode] = useState<StripeMode>("test");
  const [activeMode, setActiveMode] = useState<StripeMode | null>(null);
  const [eventSource, setEventSource] = useState<StripeHealthSource>("webhook_db");
  const [planEditor, setPlanEditor] = useState<PlanEditorState>({
    standard: { month: "", year: "", productId: "" },
    pro: { month: "", year: "", productId: "" },
    turbo: { month: "", year: "", productId: "" },
  });
  const [loading, setLoading] = useState(false);
  const [savingPlan, setSavingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const copy = async (value?: string | null) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setInfo("Panoya kopyalandı.");
  };

  const loadData = useCallback(async (mode: StripeMode) => {
    setLoading(true);
    setError(null);

    try {
      const modeQuery = `?mode=${mode}`;
      const [catalogResponse, healthResponse] = await Promise.all([
        fetch(`/api/admin/stripe/catalog${modeQuery}`, { cache: "no-store" }),
        fetch(`/api/admin/stripe/health${modeQuery}`, { cache: "no-store" }),
      ]);

      const catalogPayload = (await catalogResponse.json()) as {
        plans?: PlanPricingSnapshot[];
        catalog?: StripeCatalogProduct[];
        error?: string;
      };
      const healthPayload = (await healthResponse.json()) as {
        mode?: StripeMode;
        events?: StripeHealthEvent[];
        source?: StripeHealthSource;
        error?: string;
      };

      if (!catalogResponse.ok) {
        throw new Error(catalogPayload.error || "Stripe katalogu yüklenemedi.");
      }

      if (!healthResponse.ok) {
        throw new Error(healthPayload.error || "Stripe event logları yüklenemedi.");
      }

      const nextPlans = catalogPayload.plans ?? [];
      const nextCatalog = catalogPayload.catalog ?? [];
      const nextEvents = healthPayload.events ?? [];
      const nextActiveMode = healthPayload.mode ?? null;
      const nextSource = healthPayload.source ?? "webhook_db";

      setPlans(nextPlans);
      setCatalog(nextCatalog);
      setEvents(nextEvents);
      setActiveMode(nextActiveMode);
      setEventSource(nextSource);

      const buildEditor = (plan: BillingPlan) => {
        const row = nextPlans.find((item) => item.plan === plan);
        return {
          month: toInputValue(row?.monthly.amountCents),
          year: toInputValue(row?.yearly.amountCents) || toYearlyDiscountValue(toInputValue(row?.monthly.amountCents)),
          productId: row?.monthly.productId || row?.yearly.productId || "",
        };
      };

      setPlanEditor({
        standard: buildEditor("standard"),
        pro: buildEditor("pro"),
        turbo: buildEditor("turbo"),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stripe yönetim verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(selectedMode);
  }, [loadData, selectedMode]);

  const planMap = useMemo(() => {
    const next = new Map<BillingPlan, PlanPricingSnapshot>();
    for (const plan of plans) {
      next.set(plan.plan, plan);
    }
    return next;
  }, [plans]);

  const setPlanField = (plan: BillingPlan, key: "month" | "year" | "productId", value: string) => {
    setPlanEditor((prev) => ({
      ...prev,
      [plan]: {
        ...prev[plan],
        [key]: value,
      },
    }));
  };

  const applyYearlyDiscount = (plan: BillingPlan) => {
    setPlanEditor((prev) => ({
      ...prev,
      [plan]: {
        ...prev[plan],
        year: toYearlyDiscountValue(prev[plan].month),
      },
    }));
  };

  const updatePlanPrice = useCallback(async (plan: BillingPlan, interval: BillingInterval) => {
    const rawAmount = interval === "month" ? planEditor[plan].month : planEditor[plan].year;
    const amount = Number(rawAmount);

    if (Number.isNaN(amount) || amount <= 0) {
      setError(`${PLAN_LABELS[plan]} ${interval === "month" ? "aylık" : "yıllık"} fiyatı geçersiz.`);
      return false;
    }

    setSavingPlan(`${plan}-${interval}`);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch("/api/admin/stripe/plan-price", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: selectedMode,
          plan,
          interval,
          amount,
          currency: "usd",
          productId: planEditor[plan].productId || undefined,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        plan?: PlanPricingSnapshot;
        productId?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Stripe plan fiyatı güncellenemedi.");
      }

      const updatedPlan = payload.plan;

      if (updatedPlan) {
        setPlans((prev) => {
          const next = prev.filter((item) => item.plan !== plan);
          next.push(updatedPlan);
          next.sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));
          return next;
        });
      }

      if (payload.productId) {
        setPlanField(plan, "productId", payload.productId);
      }

      setInfo(`${PLAN_LABELS[plan]} ${interval === "month" ? "aylık" : "yıllık"} fiyatı güncellendi.`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stripe plan fiyatı güncellenemedi.");
      return false;
    } finally {
      setSavingPlan(null);
    }
  }, [planEditor, selectedMode]);

  const updateBothIntervals = useCallback(async (plan: BillingPlan) => {
    const monthOk = await updatePlanPrice(plan, "month");
    if (!monthOk) return;
    const yearOk = await updatePlanPrice(plan, "year");
    if (!yearOk) return;
    await loadData(selectedMode);
  }, [loadData, selectedMode, updatePlanPrice]);

  const catalogRows = useMemo<CatalogTableRow[]>(() => {
    const rows: CatalogTableRow[] = [];

    for (const product of catalog) {
      for (const price of product.prices) {
        rows.push({
          productId: product.productId,
          productName: product.name,
          active: product.active,
          interval: price.interval,
          amountCents: price.amountCents,
          currency: price.currency,
          priceId: price.priceId,
        });
      }
    }

    return rows;
  }, [catalog]);

  const catalogColumns = useMemo<ColumnDef<CatalogTableRow>[]>(
    () => [
      {
        accessorKey: "productName",
        header: "Ürün",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="font-black text-white">{row.original.productName}</p>
            <p className="text-xs text-slate-500 break-all">{row.original.productId}</p>
          </div>
        ),
      },
      {
        accessorKey: "interval",
        header: "Periyot",
        cell: ({ row }) => <Badge variant="secondary">{row.original.interval === "month" ? "Aylık" : "Yıllık"}</Badge>,
      },
      {
        accessorKey: "amountCents",
        header: "Tutar",
        cell: ({ row }) => <span>{formatUsd(row.original.amountCents)}</span>,
      },
      {
        accessorKey: "priceId",
        header: "Price ID",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs break-all">{row.original.priceId}</p>
            <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void copy(row.original.priceId)}>
              Kopyala
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const eventColumns = useMemo<ColumnDef<StripeHealthEvent>[]>(
    () => [
      {
        accessorKey: "event_type",
        header: "Olay",
        cell: ({ row }) => <span>{getEventLabel(row.original.event_type)}</span>,
      },
      {
        accessorKey: "stripe_event_id",
        header: "Stripe Event ID",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs break-all">{row.original.stripe_event_id}</p>
            <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void copy(row.original.stripe_event_id)}>
              Kopyala
            </Button>
          </div>
        ),
      },
      {
        accessorKey: "processed_at",
        header: "İşlenme",
        cell: ({ row }) => <span>{new Date(row.original.processed_at).toLocaleString("tr-TR")}</span>,
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <Card className="glass-card-pro rounded-[32px]">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="space-y-2">
              <Badge className="w-fit">Stripe Admin</Badge>
              <CardTitle>Stripe Abonelik Yönetimi</CardTitle>
              <CardDescription>
                Mode bazlı plan fiyatları, product/price katalogu ve event logları.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={selectedMode} onChange={(event) => setSelectedMode(event.target.value as StripeMode)}>
                <option value="live">Live Bölümü</option>
                <option value="test">Test Bölümü</option>
              </Select>
              <Button variant="secondary" className="cursor-pointer" onClick={() => void loadData(selectedMode)} disabled={loading}>
                Yenile
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Aktif checkout/webhook mode:</span>
            <Badge variant="secondary">{activeMode ?? "-"}</Badge>
            <span>Event kaynağı:</span>
            <Badge variant="secondary">{eventSource === "webhook_db" ? "Webhook DB" : "Stripe API"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Hata</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {info ? (
            <Alert variant="success">
              <AlertTitle>Bilgi</AlertTitle>
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs defaultValue="pricing" className="space-y-4">
            <TabsList>
              <TabsTrigger value="pricing">Plan Pricing</TabsTrigger>
              <TabsTrigger value="catalog">Katalog</TabsTrigger>
              <TabsTrigger value="events">Event Logları</TabsTrigger>
            </TabsList>

            <TabsContent value="pricing" className="space-y-3">
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {PLAN_ORDER.map((plan) => {
                  const snapshot = planMap.get(plan);
                  const monthlyPriceId = snapshot?.monthly.priceId ?? null;
                  const yearlyPriceId = snapshot?.yearly.priceId ?? null;
                  const productId = planEditor[plan].productId || snapshot?.monthly.productId || snapshot?.yearly.productId || "";
                  const yearlyDiscountPercent = snapshot?.yearlyDiscountPercent ?? 25;
                  const monthlySaving = savingPlan === `${plan}-month`;
                  const yearlySaving = savingPlan === `${plan}-year`;

                  return (
                    <Card key={plan} className="rounded-2xl">
                      <CardHeader className="p-4 pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-base">{PLAN_LABELS[plan]}</CardTitle>
                          <Badge variant="secondary">Yıllık İndirim %{yearlyDiscountPercent}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-4">
                        <div className="space-y-2">
                          <p className="text-xs font-black uppercase tracking-widest text-slate-300">Product ID</p>
                          <Input
                            value={planEditor[plan].productId}
                            onChange={(event) => setPlanField(plan, "productId", event.target.value)}
                            placeholder="prod_..."
                          />
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-500 break-all">{productId || "-"}</p>
                            <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void copy(productId)}>
                              Kopyala
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-black uppercase tracking-widest text-slate-300">Aylık Fiyat (USD)</p>
                          <Input value={planEditor[plan].month} onChange={(event) => setPlanField(plan, "month", event.target.value)} />
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-500 break-all">{monthlyPriceId || "-"}</p>
                            <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void copy(monthlyPriceId)}>
                              Kopyala
                            </Button>
                          </div>
                          <Button
                            variant="outline"
                            className="cursor-pointer w-full"
                            onClick={() => void updatePlanPrice(plan, "month")}
                            disabled={savingPlan !== null}
                          >
                            {monthlySaving ? "Kaydediliyor..." : "Aylık Kaydet"}
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-black uppercase tracking-widest text-slate-300">Yıllık Fiyat (USD)</p>
                          <Input value={planEditor[plan].year} onChange={(event) => setPlanField(plan, "year", event.target.value)} />
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-500 break-all">{yearlyPriceId || "-"}</p>
                            <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void copy(yearlyPriceId)}>
                              Kopyala
                            </Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              className="cursor-pointer flex-1"
                              onClick={() => void updatePlanPrice(plan, "year")}
                              disabled={savingPlan !== null}
                            >
                              {yearlySaving ? "Kaydediliyor..." : "Yıllık Kaydet"}
                            </Button>
                            <Button
                              variant="secondary"
                              className="cursor-pointer"
                              onClick={() => applyYearlyDiscount(plan)}
                              disabled={savingPlan !== null}
                            >
                              %25
                            </Button>
                          </div>
                        </div>

                        <Button className="cursor-pointer w-full" onClick={() => void updateBothIntervals(plan)} disabled={savingPlan !== null}>
                          Aylık + Yıllık Kaydet
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="catalog" className="space-y-3">
              <DataTable columns={catalogColumns} data={catalogRows} searchPlaceholder="Ürün, price id ara..." pageSize={10} />
            </TabsContent>

            <TabsContent value="events" className="space-y-3">
              <DataTable
                columns={eventColumns}
                data={events}
                searchPlaceholder="Event ara..."
                pageSize={10}
                dateFilterKey="processed_at"
                dateFilterLabel="İşlenme Tarihi"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
