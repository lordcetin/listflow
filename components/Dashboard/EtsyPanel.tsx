"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../../store";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "../../lib/supabaseClient";
import {
  Store,
  Plus,
  Info,
  CheckCircle2,
  MessageCircle,
  Clock,
  Smartphone,
  Loader2,
  CreditCard,
  Package,
  Cog,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useCategoriesRepository } from "@/lib/repositories/categories";
import type { Shop } from "@/types";

type BillingPlan = "standard" | "pro" | "turbo";
type BillingInterval = "month" | "year";

type PublicPlanPricing = {
  plan: BillingPlan;
  monthlyCents: number;
  yearlyCents: number;
  yearlyDiscountPercent: number;
};

type StoreOverviewRow = {
  id: string;
  storeName: string;
  category: string | null;
  status: string | null;
  priceCents: number;
  orderCount: number;
  hasActiveSubscription: boolean;
  hasActiveAutomationWebhook?: boolean;
  plan: string | null;
  subscriptionStatus: string | null;
  automationIntervalHours: number | null;
  automationLastRunAt: string | null;
  lastSuccessfulAutomationAt?: string | null;
  nextAutomationAt: string | null;
  automationState?: "waiting" | "due" | "processing" | "retrying" | "error";
  canDelete: boolean;
  deleteBlockedReason: "active_subscription" | "automation_running" | null;
};

type StoreOverviewResponse = {
  rows?: StoreOverviewRow[];
  error?: string;
};

type StoreActionMessage = {
  type: "success" | "error";
  text: string;
};

const DEFAULT_CRISP_WEBSITE_ID = "90902ea5-80af-4468-8f9d-d9a808ed1137";

const EtsyPanel: React.FC = () => {
  const { shops, setShops } = useStore();
  const { t, locale } = useI18n();
  const { categories } = useCategoriesRepository(locale);
  const [showConnect, setShowConnect] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedShopForPlan, setSelectedShopForPlan] = useState<{ id: string; name: string } | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [planPricing, setPlanPricing] = useState<Record<BillingPlan, { month: number; year: number; discount: number }>>({
    standard: { month: 2990, year: 26910, discount: 25 },
    pro: { month: 4990, year: 44910, discount: 25 },
    turbo: { month: 7990, year: 71910, discount: 25 },
  });
  const [phone, setPhone] = useState("");
  const [shopName, setShopName] = useState("");
  const [selectedCat, setSelectedCat] = useState("");
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [storeActionMessage, setStoreActionMessage] = useState<StoreActionMessage | null>(null);
  const [hoveredTimerStoreId, setHoveredTimerStoreId] = useState<string | null>(null);
  const [pinnedTimerStoreId, setPinnedTimerStoreId] = useState<string | null>(null);
  const [deleteTargetShop, setDeleteTargetShop] = useState<Shop | null>(null);
  const [isDeletingStoreId, setIsDeletingStoreId] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState<number>(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedCat && categories[0]) {
      setSelectedCat(categories[0].id);
    }
  }, [categories, selectedCat]);

  const plans = useMemo(
    () => [
      {
        id: "standard" as BillingPlan,
        name: locale === "en" ? "Standard" : "Standart",
        cadence: locale === "en" ? "Every 8 Hours" : "8 Saat",
        description: locale === "en" ? "Product upload every 8 hours" : "8 saatte bir ürün yükleme",
      },
      {
        id: "pro" as BillingPlan,
        name: "Pro",
        cadence: locale === "en" ? "Every 4 Hours" : "4 Saat",
        description: locale === "en" ? "Product upload every 4 hours" : "4 saatte bir ürün yükleme",
      },
      {
        id: "turbo" as BillingPlan,
        name: "Turbo",
        cadence: locale === "en" ? "Every 2 Hours" : "2 Saat",
        description: locale === "en" ? "Product upload every 2 hours" : "2 saatte bir ürün yükleme",
      },
    ],
    [locale]
  );

  const moneyLabel = (priceCents: number) => {
    return `$${(priceCents / 100).toFixed(2)}`;
  };

  const planLabel = (plan: string | null | undefined) => {
    const normalized = (plan ?? "").toLowerCase();

    if (normalized === "standard") return t("dashboard.planStandard");
    if (normalized === "pro") return t("dashboard.planPro");
    if (normalized === "turbo") return t("dashboard.planTurbo");

    return t("dashboard.planUnknown");
  };

  const mapOverviewRowToShop = useCallback(
    (row: StoreOverviewRow): Shop => ({
      id: row.id,
      name: row.storeName,
      category: row.category || (locale === "en" ? "General" : "Genel"),
      subscription: moneyLabel(row.priceCents),
      isPaid: row.hasActiveSubscription || ["active", "trialing"].includes((row.status ?? "").toLowerCase()),
      hasActiveAutomationWebhook: row.hasActiveAutomationWebhook ?? false,
      orderCount: row.orderCount ?? 0,
      url: "",
      plan: row.plan,
      subscriptionStatus: row.subscriptionStatus,
      automationIntervalHours: row.automationIntervalHours,
      automationLastRunAt: row.automationLastRunAt,
      lastSuccessfulAutomationAt: row.lastSuccessfulAutomationAt ?? row.automationLastRunAt ?? null,
      nextAutomationAt: row.nextAutomationAt,
      automationState: row.automationState ?? "waiting",
      canDelete: row.canDelete,
      deleteBlockedReason: row.deleteBlockedReason,
    }),
    [locale]
  );

  const syncServerSession = useCallback(async () => {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error || !session?.access_token) {
      return false;
    }

    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      }),
    });

    return response.ok;
  }, []);

  const requestStoresOverview = useCallback(async () => {
    const response = await fetch("/api/stores/overview", {
      cache: "no-store",
      credentials: "include",
    });

    const payload = (await response.json().catch(() => ({}))) as StoreOverviewResponse;
    return { response, payload };
  }, []);

  const loadStoresOverview = useCallback(async () => {
    let { response, payload } = await requestStoresOverview();

    if (response.status === 401) {
      const synced = await syncServerSession();

      if (synced) {
        ({ response, payload } = await requestStoresOverview());
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(locale === "en" ? "Session expired. Please sign in again." : "Oturum süresi doldu. Lütfen tekrar giriş yapın.");
      }

      throw new Error(payload.error || (locale === "en" ? "Stores could not be loaded" : "Mağazalar yüklenemedi"));
    }

    const rows = payload.rows ?? [];
    setShops(rows.map(mapOverviewRowToShop));
  }, [locale, mapOverviewRowToShop, requestStoresOverview, setShops, syncServerSession]);

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        await loadStoresOverview();
      } catch {
        if (mounted) {
          setShops([]);
        }
      }
    };

    void boot();

    return () => {
      mounted = false;
    };
  }, [loadStoresOverview, setShops]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadStoresOverview().catch(() => undefined);
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadStoresOverview]);

  useEffect(() => {
    let mounted = true;

    const loadPlanPricing = async () => {
      try {
        const response = await fetch("/api/billing/plans", { cache: "no-store" });
        const payload = (await response.json()) as { plans?: PublicPlanPricing[] };
        const pricingRows = payload.plans;

        if (!response.ok || !pricingRows || !mounted) {
          return;
        }

        setPlanPricing((prev) => {
          const next = { ...prev };

          for (const plan of pricingRows) {
            next[plan.plan] = {
              month: plan.monthlyCents,
              year: plan.yearlyCents,
              discount: plan.yearlyDiscountPercent,
            };
          }

          return next;
        });
      } catch {
        // no-op: fallback defaults are kept
      }
    };

    void loadPlanPricing();

    return () => {
      mounted = false;
    };
  }, []);

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    setStoreActionMessage(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Oturum bulunamadı.");
      }

      const sessionSync = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        }),
      });
      if (!sessionSync.ok) {
        throw new Error("Oturum senkronize edilemedi.");
      }

      const normalizedPhone = phone.trim();

      if (!normalizedPhone) {
        throw new Error("Telefon numarası zorunlu.");
      }

      const categoryName = categories.find((category) => category.id === selectedCat)?.name || "Genel";
      const response = await fetch("/api/onboarding/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName: shopName.trim() || null,
          phone: normalizedPhone,
          category: categoryName,
          priceCents: 2990,
          fallbackStoreNamePrefix: locale === "en" ? "My Store" : "Mağazam",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; id?: string };

      if (!response.ok || !payload.id) {
        throw new Error(payload.error || "Mağaza eklenemedi");
      }

      await loadStoresOverview();

      setShowConnect(false);
      setPhone("");
      setShopName("");
      setSelectedCat(categories[0]?.id ?? "");
      setStoreActionMessage({
        type: "success",
        text: locale === "en" ? "Store added successfully." : "Mağaza başarıyla eklendi.",
      });
    } catch (error) {
      setStoreActionMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Mağaza eklenemedi",
      });
    }
  };

  const handleOpenPlanSelection = (shop: { id: string; name: string }) => {
    setSelectedShopForPlan(shop);
    setShowPlanModal(true);
  };

  const handleActivate = async (planId: BillingPlan) => {
    if (!selectedShopForPlan) {
      return;
    }

    setIsProcessing(selectedShopForPlan.id);
    setShowPlanModal(false);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "subscription",
          plan: planId,
          interval: billingInterval,
          shopId: selectedShopForPlan.id,
        }),
      });

      const data = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !data.url) {
        throw new Error(data.error || "Stripe ödeme linki alınamadı.");
      }

      window.location.href = data.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ödeme başlatılamadı.";
      alert(message);
      setIsProcessing(null);
    }
  };

  const crispWebsiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID ?? DEFAULT_CRISP_WEBSITE_ID;

  const openCrispChatbox = () => {
    const crispWindow = window as Window & {
      $crisp?: Array<unknown> & { push: (item: unknown) => number };
    };

    if (!crispWindow.$crisp || typeof crispWindow.$crisp.push !== "function") {
      return false;
    }

    crispWindow.$crisp.push(["do", "chat:show"]);
    crispWindow.$crisp.push(["do", "chat:open"]);
    return true;
  };

  const ensureCrispScript = () => {
    const crispWindow = window as Window & {
      $crisp?: Array<unknown>;
      CRISP_WEBSITE_ID?: string;
    };

    if (!crispWindow.$crisp) {
      crispWindow.$crisp = [];
    }

    if (!crispWindow.CRISP_WEBSITE_ID) {
      crispWindow.CRISP_WEBSITE_ID = crispWebsiteId;
    }

    if (document.getElementById("crisp-chat-script")) {
      return;
    }

    const script = document.createElement("script");
    script.id = "crisp-chat-script";
    script.src = "https://client.crisp.chat/l.js";
    script.async = true;
    document.head.appendChild(script);
  };

  const handleOpenSupport = () => {
    setStoreActionMessage(null);

    if (openCrispChatbox()) {
      return;
    }

    ensureCrispScript();

    let attempts = 0;
    const maxAttempts = 20;
    const poll = window.setInterval(() => {
      attempts += 1;

      if (openCrispChatbox()) {
        window.clearInterval(poll);
        return;
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(poll);
        setStoreActionMessage({
          type: "error",
          text:
            locale === "en"
              ? "Support chat is still loading. Please try again in a few seconds."
              : "Destek sohbeti hala yükleniyor. Lütfen birkaç saniye sonra tekrar deneyin.",
        });
      }
    }, 150);
  };

  const getRemainingSeconds = (shop: Shop) => {
    const intervalHours = shop.automationIntervalHours;
    if (!intervalHours || intervalHours <= 0) {
      return null;
    }

    const nextAutomationAtMs = shop.nextAutomationAt ? new Date(shop.nextAutomationAt).getTime() : Number.NaN;
    if (!Number.isFinite(nextAutomationAtMs)) {
      return null;
    }

    const diffSeconds = Math.ceil((nextAutomationAtMs - nowTs) / 1000);
    return Math.max(0, diffSeconds);
  };

  const formatRemaining = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}${t("etsy.countdownHoursShort")} ${minutes}${t("etsy.countdownMinutesShort")} ${seconds}${t("etsy.countdownSecondsShort")}`;
    }

    return `${minutes}${t("etsy.countdownMinutesShort")} ${seconds}${t("etsy.countdownSecondsShort")}`;
  };

  const getAutomationText = (shop: Shop) => {
    if (!shop.plan || !shop.isPaid) {
      return t("etsy.automationNoPlan");
    }

    const remainingSeconds = getRemainingSeconds(shop);

    if (remainingSeconds === null) {
      return t("etsy.automationUnavailable");
    }

    return `${t("etsy.nextUploadIn")}: ${formatRemaining(remainingSeconds)}`;
  };

  const getDeleteBlockedMessage = (reason: Shop["deleteBlockedReason"]) => {
    if (reason === "active_subscription") {
      return t("etsy.deleteBlockedSubscription");
    }

    if (reason === "automation_running") {
      return t("etsy.deleteBlockedAutomation");
    }

    return t("etsy.deleteStoreWarning");
  };

  const handleDeleteIntent = (shop: Shop) => {
    setStoreActionMessage(null);

    if (!shop.canDelete) {
      setStoreActionMessage({
        type: "error",
        text: getDeleteBlockedMessage(shop.deleteBlockedReason ?? null),
      });
      return;
    }

    setDeleteTargetShop(shop);
  };

  const handleConfirmDeleteStore = async () => {
    if (!deleteTargetShop) {
      return;
    }

    setIsDeletingStoreId(deleteTargetShop.id);

    try {
      const response = await fetch(`/api/stores/${deleteTargetShop.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        reason?: Shop["deleteBlockedReason"];
      };

      if (!response.ok) {
        if (response.status === 409) {
          const blockedReason = payload.reason ?? null;
          setStoreActionMessage({
            type: "error",
            text: getDeleteBlockedMessage(blockedReason),
          });
          setDeleteTargetShop(null);
          return;
        }

        throw new Error(payload.error || t("etsy.deleteStoreWarning"));
      }

      setStoreActionMessage({
        type: "success",
        text: t("etsy.deleteStoreSuccess"),
      });

      setDeleteTargetShop(null);
      await loadStoresOverview();
    } catch (error) {
      setStoreActionMessage({
        type: "error",
        text: error instanceof Error ? error.message : t("etsy.deleteStoreWarning"),
      });
    } finally {
      setIsDeletingStoreId(null);
    }
  };

  return (
    <div className="w-full container px-5 mx-auto py-2 h-full overflow-y-auto custom-scrollbar">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black mb-1 tracking-tight text-white">{t("etsy.title")}</h1>
          <p className="text-slate-500 text-sm font-medium">{t("etsy.subtitle")}</p>
        </div>
        <button
          onClick={() => setShowConnect(true)}
          className="px-8 py-4 rounded-2xl bg-indigo-600 text-white font-black flex items-center gap-3 hover:shadow-[0_0_30px_rgba(79,70,229,0.3)] active:scale-95 transition-all text-sm uppercase tracking-widest cursor-pointer"
        >
          <Plus className="w-5 h-5" /> {t("etsy.addStore")}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        <button
          onClick={handleOpenSupport}
          className="glass-card-pro p-4 rounded-[20px] border border-white/5 relative overflow-hidden group flex items-center gap-3 text-left hover:border-emerald-500/30 transition-all cursor-pointer"
        >
          <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center border border-emerald-500/20 shrink-0">
            <MessageCircle className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mb-0.5">{t("etsy.support")}</h3>
            <div className="text-sm font-black text-emerald-400">{t("etsy.supportValue")}</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300 mt-1">{t("etsy.supportWhatsappCta")}</div>
          </div>
        </button>

        <div className="glass-card-pro p-4 rounded-[20px] border border-white/5 relative overflow-hidden group flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-500/10 rounded-lg flex items-center justify-center border border-indigo-500/20 shrink-0">
            <Package className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mb-0.5">{t("etsy.orders")}</h3>
            <div className="text-sm font-black text-white">
              {shops.reduce((acc, shop) => acc + shop.orderCount, 0)} {t("etsy.totalShipment")}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 mb-10">
        <div className="px-4 mb-4">
          <h2 className="text-[10px] font-black text-indigo-400/60 uppercase tracking-[0.3em]">{t("etsy.storesTitle")}</h2>
        </div>

        {storeActionMessage && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              storeActionMessage.type === "error"
                ? "border-red-500/30 bg-red-500/10 text-red-200"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            {storeActionMessage.text}
          </div>
        )}

        {shops.length === 0 ? (
          <div className="py-20 glass-pro rounded-[40px] text-center border border-dashed border-indigo-500/20">
            <Store className="w-16 h-16 text-indigo-500/20 mx-auto mb-6" />
            <p className="text-slate-500 font-black text-sm uppercase tracking-widest">{t("etsy.emptyStores")}</p>
          </div>
        ) : (
          shops.map((shop, index) => {
            const showTimer = hoveredTimerStoreId === shop.id || pinnedTimerStoreId === shop.id;
            const automationText = getAutomationText(shop);

            return (
              <motion.div
                key={shop.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="relative overflow-visible p-6 rounded-[32px] glass-card-pro border border-white/5 flex flex-col lg:flex-row items-center justify-between gap-6 group hover:border-indigo-500/30 transition-all duration-500"
              >
                {shop.isPaid && shop.hasActiveAutomationWebhook && (
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredTimerStoreId(shop.id)}
                    onMouseLeave={() => setHoveredTimerStoreId((prev) => (prev === shop.id ? null : prev))}
                    onClick={() => setPinnedTimerStoreId((prev) => (prev === shop.id ? null : shop.id))}
                    className="absolute left-3 top-3 h-6 w-6 rounded-full border border-indigo-400/40 bg-indigo-500/15 text-indigo-300 flex items-center justify-center hover:bg-indigo-500/25 transition-all cursor-pointer"
                    title={automationText}
                  >
                    <Cog className="w-3.5 h-3.5 animate-spin" />
                  </button>
                )}

                {shop.isPaid && shop.hasActiveAutomationWebhook && showTimer && (
                  <div className="absolute left-3 top-10 z-10 min-w-[190px] rounded-xl border border-indigo-500/30 bg-[#0e1016] px-3 py-2 text-[10px] font-black uppercase tracking-widest text-indigo-200 shadow-2xl">
                    <p className="text-indigo-300/80 mb-1">{t("etsy.automationActiveBadge")}</p>
                    <p className="text-white/90 normal-case tracking-normal text-xs">{automationText}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleDeleteIntent(shop)}
                  className={`absolute -right-3 -top-3 h-8 w-8 rounded-full border flex items-center justify-center transition-all cursor-pointer shadow-xl backdrop-blur-sm ${
                    shop.canDelete
                      ? "border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                      : "border-slate-600/40 bg-slate-500/10 text-slate-400 hover:bg-slate-500/20"
                  }`}
                  title={shop.canDelete ? t("etsy.deleteStore") : getDeleteBlockedMessage(shop.deleteBlockedReason ?? null)}
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-6 flex-1">
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-500 ${
                      shop.isPaid
                        ? "bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]"
                        : "bg-indigo-600/10 border-indigo-500/20"
                    }`}
                  >
                    <Store className={`w-8 h-8 ${shop.isPaid ? "text-emerald-400" : "text-indigo-400"}`} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-white flex items-center gap-3">{shop.name}</h3>
                    <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded-md border border-white/5">
                        {shop.category}
                      </span>
                      <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{shop.subscription}</span>
                      {shop.plan && (
                        <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                          {planLabel(shop.plan)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-8">
                  <div className="text-center">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("etsy.orders")}</p>
                    <p className="text-lg font-black text-white">{shop.orderCount}</p>
                  </div>

                  <div className="h-10 w-[1px] bg-white/5 hidden lg:block" />

                  <div className="flex items-center gap-3">
                    {shop.isPaid ? (
                      <div className="flex flex-col items-end">
                        <div className="px-6 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-black uppercase tracking-widest flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" /> {t("etsy.paymentDone")}
                        </div>
                        <p className="text-[9px] font-bold text-slate-400 mt-2 uppercase tracking-widest flex items-center gap-2">
                          <Clock className="w-3 h-3 text-indigo-400 animate-pulse" /> {t("etsy.waitingCall")}
                        </p>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleOpenPlanSelection({ id: shop.id, name: shop.name })}
                        disabled={isProcessing === shop.id}
                        className="px-8 py-3 rounded-2xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest shadow-xl shadow-indigo-500/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                      >
                        {isProcessing === shop.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <CreditCard className="w-4 h-4" /> {t("etsy.activatePay")}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      <AnimatePresence>
        {deleteTargetShop && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => isDeletingStoreId === null && setDeleteTargetShop(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-lg p-8 rounded-[32px] glass-card-pro border border-white/10 shadow-2xl"
            >
              <h3 className="text-2xl font-black text-white mb-2">{t("etsy.deleteStoreConfirmTitle")}</h3>
              <p className="text-slate-300 text-sm mb-3">{t("etsy.deleteStoreConfirmText")}</p>
              <p className="text-slate-500 text-xs font-bold mb-6">{t("etsy.deleteStoreWarning")}</p>

              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white mb-6">
                {deleteTargetShop.name}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTargetShop(null)}
                  disabled={isDeletingStoreId === deleteTargetShop.id}
                  className="flex-1 py-3 rounded-xl glass-pro border border-white/10 text-slate-300 font-black text-xs uppercase tracking-widest hover:text-white transition-all cursor-pointer disabled:opacity-60"
                >
                  {t("etsy.cancel")}
                </button>
                <button
                  onClick={() => void handleConfirmDeleteStore()}
                  disabled={isDeletingStoreId === deleteTargetShop.id}
                  className="flex-1 py-3 rounded-xl bg-red-600/90 text-white font-black text-xs uppercase tracking-widest hover:bg-red-500 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isDeletingStoreId === deleteTargetShop.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {t("etsy.deleteStoreApprove")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPlanModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPlanModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-2xl p-8 rounded-[40px] glass-card-pro border border-white/10 shadow-2xl"
            >
              <div className="text-center mb-8">
                <h2 className="text-2xl font-black text-white tracking-tight mb-2">{t("etsy.selectPlan")}</h2>
                <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">
                  {selectedShopForPlan?.name} için yükleme sıklığı belirleyin
                </p>
              </div>

              <div className="flex items-center gap-3 mb-6">
                <button
                  onClick={() => setBillingInterval("month")}
                  className={`flex-1 py-3 rounded-2xl border font-black text-[11px] uppercase tracking-widest transition-all cursor-pointer ${
                    billingInterval === "month"
                      ? "bg-indigo-600 text-white border-indigo-500/50"
                      : "bg-white/5 text-slate-400 border-white/10 hover:text-white"
                  }`}
                >
                  {t("etsy.billingMonthly")}
                </button>
                <button
                  onClick={() => setBillingInterval("year")}
                  className={`flex-1 py-3 rounded-2xl border font-black text-[11px] uppercase tracking-widest transition-all cursor-pointer ${
                    billingInterval === "year"
                      ? "bg-indigo-600 text-white border-indigo-500/50"
                      : "bg-white/5 text-slate-400 border-white/10 hover:text-white"
                  }`}
                >
                  {t("etsy.billingYearly")} (%{planPricing.standard.discount})
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                {plans.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => handleActivate(plan.id)}
                    className="p-6 rounded-3xl bg-white/5 border border-white/5 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all text-left group cursor-pointer"
                  >
                    <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">{plan.name}</div>
                    <div className="text-3xl font-black text-white mb-1">
                      ${((billingInterval === "year" ? planPricing[plan.id].year : planPricing[plan.id].month) / 100).toFixed(2)}
                    </div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                      / {billingInterval === "year" ? t("etsy.billingYearly") : t("etsy.billingMonthly")}
                    </div>
                    {billingInterval === "year" ? (
                      <div className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-3">
                        %{planPricing[plan.id].discount} {t("etsy.yearlyDiscount")}
                      </div>
                    ) : (
                      <div className="h-4 mb-3" />
                    )}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[11px] text-slate-300 font-medium">
                        <Clock className="w-3 h-3 text-indigo-400" /> {plan.cadence}
                      </div>
                      <div className="text-[10px] text-slate-500 leading-tight">{plan.description}</div>
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowPlanModal(false)}
                className="w-full py-4 rounded-2xl glass-pro border border-white/5 font-black text-xs uppercase tracking-widest text-slate-400 hover:text-white transition-all cursor-pointer"
              >
                {t("etsy.cancel")}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showConnect && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConnect(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.9 }}
              className="relative w-full max-w-xl p-10 rounded-[48px] glass-card-pro border border-white/10 shadow-2xl"
            >
              <div className="text-center mb-10">
                <div className="w-20 h-20 bg-indigo-600 rounded-[28px] flex items-center justify-center mx-auto mb-6 shadow-2xl border border-indigo-400/30">
                  <Store className="text-white w-10 h-10" />
                </div>
                <h2 className="text-3xl font-black text-white tracking-tight mb-2">Mağaza Kaydı</h2>
                <p className="text-slate-500 font-bold">Kaydı tamamlayın, uzman ekibimiz sizi arasın.</p>
              </div>

              <form onSubmit={handleConnect} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Mağaza Adı</label>
                    <input
                      type="text"
                      required
                      value={shopName}
                      onChange={(event) => setShopName(event.target.value)}
                      placeholder="Örn: WoodDesignTR"
                      className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Telefon No</label>
                    <div className="relative">
                      <Smartphone className="absolute left-4 top-4.5 w-4 h-4 text-slate-500" />
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                        placeholder="+90 5xx..."
                        className="w-full pl-12 pr-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Kategori Seçimi</label>
                  <select
                    value={selectedCat}
                    onChange={(event) => setSelectedCat(event.target.value)}
                    className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium appearance-none"
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id} className="bg-[#0a0a0c]">
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-6 rounded-[28px] bg-indigo-500/5 border border-indigo-500/10">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-slate-400 leading-relaxed font-bold">
                      Ödeme yapıldıktan sonra sistemimiz sizi bilgilendirecek ve ekibimiz
                      <span className="text-white"> mağazanız için otomasyonu devreye alacak.</span>
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowConnect(false)}
                    className="flex-1 py-4 rounded-2xl glass-pro border border-white/5 font-black text-xs uppercase tracking-widest text-slate-400 hover:text-white transition-all cursor-pointer"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-4 rounded-2xl bg-indigo-600 text-white font-black text-xs uppercase tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                  >
                    Mağazayı Ekle
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EtsyPanel;
