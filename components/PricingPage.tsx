"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CreditCard,
  Loader2,
  Lock,
  Mail,
  Rocket,
  Smartphone,
  Sparkles,
  Store,
  User,
  X,
} from "lucide-react";
import Footer from "@/components/Footer";
import { buildOAuthRedirectTo } from "@/lib/auth/oauth-client";
import { useI18n } from "@/lib/i18n/provider";
import { useCategoriesRepository } from "@/lib/repositories/categories";
import { supabase } from "@/lib/supabaseClient";
import type { SupportedLocale } from "@/lib/i18n/config";

type BillingPlan = "standard" | "pro" | "turbo";
type BillingInterval = "month" | "year";
type WizardStep = 1 | 2 | 3;
type AuthMode = "signin" | "signup";

type PublicPlanPricing = {
  plan: BillingPlan;
  monthlyCents: number;
  yearlyCents: number;
  yearlyDiscountPercent: number;
};

type PlanFeature = {
  text: string;
  upcoming?: boolean;
};

type PlanCopy = {
  title: string;
  cadence: string;
  description: string;
  features: PlanFeature[];
};

type PricingCopy = {
  badge: string;
  title: string;
  subtitle: string;
  monthly: string;
  yearly: string;
  yearlySaveLabel: string;
  mostPopular: string;
  perMonth: string;
  perYear: string;
  startPlan: string;
  planLabel: string;
  upcomingLabel: string;
  stepsTitle: string;
  stepsSubtitle: string;
  stepNames: { account: string; store: string; payment: string };
  close: string;
  next: string;
  back: string;
  authTitle: string;
  authSubtitle: string;
  authModeSignin: string;
  authModeSignup: string;
  authFullName: string;
  authEmail: string;
  authPassword: string;
  authPlaceholderName: string;
  authPlaceholderEmail: string;
  authPlaceholderPassword: string;
  authContinue: string;
  authInProgress: string;
  authGoogle: string;
  authGoogleInProgress: string;
  authOrDivider: string;
  authSignedInNotice: string;
  authInvalidEmail: string;
  authMissingName: string;
  authSessionMissing: string;
  authEmailConfirmRequired: string;
  storeTitle: string;
  storeSubtitle: string;
  storeName: string;
  storePhone: string;
  storeCategory: string;
  storePlaceholderName: string;
  storePlaceholderPhone: string;
  storeCreate: string;
  storeCreating: string;
  storeCreatedNotice: string;
  storePhoneRequired: string;
  storeDefaultCategory: string;
  storeDefaultName: string;
  paymentTitle: string;
  paymentSubtitle: string;
  paymentPlan: string;
  paymentInterval: string;
  paymentStore: string;
  paymentPrice: string;
  paymentCheckout: string;
  paymentProcessing: string;
  paymentHint: string;
  genericError: string;
  plans: Record<BillingPlan, PlanCopy>;
};

const COPY: Record<SupportedLocale, PricingCopy> = {
  tr: {
    badge: "Üretime Hazır SaaS Planları",
    title: "Listflow'u ürün gibi konumlandır, 3 adımda satışa başla",
    subtitle:
      "Planını seç, hesabını oluştur, mağazanı ekle ve Stripe ile hemen ödemeye geç.",
    monthly: "Aylık",
    yearly: "Yıllık",
    yearlySaveLabel: "yıllık tasarruf",
    mostPopular: "Most Popular",
    perMonth: "/ay",
    perYear: "/yıl",
    startPlan: "Bu planla başla",
    planLabel: "Plan",
    upcomingLabel: "Yakında",
    stepsTitle: "3 adımda hızlı aktivasyon",
    stepsSubtitle: "Hesap -> Mağaza -> Ödeme",
    stepNames: {
      account: "Hesap",
      store: "Mağaza",
      payment: "Ödeme",
    },
    close: "Kapat",
    next: "Devam Et",
    back: "Geri",
    authTitle: "Hesabını oluştur veya giriş yap",
    authSubtitle: "Aktivasyon akışını başlatmak için önce oturumunu doğrulayalım.",
    authModeSignin: "Giriş",
    authModeSignup: "Kayıt",
    authFullName: "Ad Soyad",
    authEmail: "E-posta",
    authPassword: "Şifre",
    authPlaceholderName: "Örn: Mert Demir",
    authPlaceholderEmail: "ornek@mail.com",
    authPlaceholderPassword: "••••••••",
    authContinue: "Hesabı doğrula",
    authInProgress: "Doğrulanıyor...",
    authGoogle: "Google ile devam et",
    authGoogleInProgress: "Google yönlendirmesi...",
    authOrDivider: "veya",
    authSignedInNotice: "Oturum açık bulundu. Hesap adımı otomatik tamamlandı.",
    authInvalidEmail: "Geçerli bir e-posta adresi girin.",
    authMissingName: "Kayıt için ad soyad zorunludur.",
    authSessionMissing: "Oturum oluşturulamadı. Lütfen tekrar deneyin.",
    authEmailConfirmRequired:
      "E-posta doğrulaması gerekli görünüyor. Lütfen gelen kutunuzu doğrulayıp tekrar giriş yapın.",
    storeTitle: "Mağaza bilgilerini tamamla",
    storeSubtitle: "Bu mağaza seçtiğin planla Stripe aboneliğine bağlanacak.",
    storeName: "Mağaza Adı",
    storePhone: "Telefon",
    storeCategory: "Kategori",
    storePlaceholderName: "Örn: WoodDesignTR",
    storePlaceholderPhone: "+90 5xx xxx xx xx",
    storeCreate: "Mağaza oluştur",
    storeCreating: "Oluşturuluyor...",
    storeCreatedNotice: "Mağaza oluşturuldu. Son adım: ödeme.",
    storePhoneRequired: "Telefon alanı zorunludur.",
    storeDefaultCategory: "Genel",
    storeDefaultName: "Mağazam",
    paymentTitle: "Ödemeye geç",
    paymentSubtitle: "Stripe Checkout ile aboneliğini başlat.",
    paymentPlan: "Seçilen Plan",
    paymentInterval: "Faturalama",
    paymentStore: "Mağaza",
    paymentPrice: "Toplam",
    paymentCheckout: "Stripe ile öde",
    paymentProcessing: "Ödeme yönlendiriliyor...",
    paymentHint: "Ödeme tamamlandığında abonelik webhook ile otomatik senkronlanır.",
    genericError: "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
    plans: {
      standard: {
        title: "Starter",
        cadence: "8 saatte bir otomasyon",
        description: "Yeni mağazayı güvenli ritimle büyütmek isteyenler için.",
        features: [
          { text: "8 saatte bir ürün oluşturma/yükleme" },
          { text: "Etsy başlık + etiket optimizasyonu" },
          { text: "Tek mağaza için akıllı katalog yönetimi" },
          { text: "Temel sipariş ve ödeme görünürlüğü" },
          { text: "Pinterest otomasyonu", upcoming: true },
          { text: "Meta Business otomasyonu", upcoming: true },
        ],
      },
      pro: {
        title: "Pro",
        cadence: "4 saatte bir otomasyon",
        description: "Daha hızlı büyüme ve daha fazla operasyon kontrolü.",
        features: [
          { text: "4 saatte bir ürün oluşturma/yükleme" },
          { text: "3 mağazaya kadar paralel yönetim" },
          { text: "Varyant bazlı ürün kurgusu" },
          { text: "Öncelikli üretim kuyruğu" },
          { text: "Pinterest otomasyonu", upcoming: true },
          { text: "Meta Business otomasyonu", upcoming: true },
          { text: "eBay otomasyonu", upcoming: true },
        ],
      },
      turbo: {
        title: "Turbo",
        cadence: "2 saatte bir otomasyon",
        description: "Yüksek hacimli ekipler ve agresif büyüme için.",
        features: [
          { text: "2 saatte bir ürün oluşturma/yükleme" },
          { text: "Sınırsız mağaza/kategori akışı" },
          { text: "Toplu katalog + ürün güncelleme" },
          { text: "Öncelikli destek ve ekip erişimi" },
          { text: "Pinterest + Meta + eBay + Amazon", upcoming: true },
          { text: "Gelişmiş pazaryeri orkestrasyonu", upcoming: true },
        ],
      },
    },
  },
  en: {
    badge: "Production-Ready SaaS Plans",
    title: "Position Listflow as a product and launch in 3 steps",
    subtitle:
      "Pick your plan, create your account, create your store, and pay with Stripe.",
    monthly: "Monthly",
    yearly: "Yearly",
    yearlySaveLabel: "yearly savings",
    mostPopular: "Most Popular",
    perMonth: "/month",
    perYear: "/year",
    startPlan: "Start with this plan",
    planLabel: "Plan",
    upcomingLabel: "Coming Soon",
    stepsTitle: "Fast activation in 3 steps",
    stepsSubtitle: "Account -> Store -> Payment",
    stepNames: {
      account: "Account",
      store: "Store",
      payment: "Payment",
    },
    close: "Close",
    next: "Continue",
    back: "Back",
    authTitle: "Create your account or sign in",
    authSubtitle: "Let's verify your session before starting activation.",
    authModeSignin: "Sign In",
    authModeSignup: "Sign Up",
    authFullName: "Full Name",
    authEmail: "Email",
    authPassword: "Password",
    authPlaceholderName: "Ex: Alex Carter",
    authPlaceholderEmail: "example@mail.com",
    authPlaceholderPassword: "••••••••",
    authContinue: "Verify account",
    authInProgress: "Verifying...",
    authGoogle: "Continue with Google",
    authGoogleInProgress: "Redirecting to Google...",
    authOrDivider: "or",
    authSignedInNotice: "Active session found. Account step completed automatically.",
    authInvalidEmail: "Enter a valid email address.",
    authMissingName: "Full name is required for sign-up.",
    authSessionMissing: "Session could not be created. Please try again.",
    authEmailConfirmRequired:
      "Email verification seems required. Confirm your email and then sign in again.",
    storeTitle: "Complete store details",
    storeSubtitle: "This store will be linked to the selected Stripe subscription plan.",
    storeName: "Store Name",
    storePhone: "Phone",
    storeCategory: "Category",
    storePlaceholderName: "Ex: WoodDesignUS",
    storePlaceholderPhone: "+1 (555) ...",
    storeCreate: "Create store",
    storeCreating: "Creating...",
    storeCreatedNotice: "Store created. Final step: payment.",
    storePhoneRequired: "Phone is required.",
    storeDefaultCategory: "General",
    storeDefaultName: "My Store",
    paymentTitle: "Continue to payment",
    paymentSubtitle: "Start your subscription through Stripe Checkout.",
    paymentPlan: "Selected Plan",
    paymentInterval: "Billing",
    paymentStore: "Store",
    paymentPrice: "Total",
    paymentCheckout: "Pay with Stripe",
    paymentProcessing: "Redirecting to payment...",
    paymentHint: "After payment, subscription status is synced automatically by webhook.",
    genericError: "Operation could not be completed. Please try again.",
    plans: {
      standard: {
        title: "Starter",
        cadence: "Automation every 8 hours",
        description: "For new stores that want reliable growth cadence.",
        features: [
          { text: "Automatic product generation/upload every 8h" },
          { text: "Etsy title + tag optimization" },
          { text: "Smart catalog management for one store" },
          { text: "Basic order and payment visibility" },
          { text: "Pinterest automation", upcoming: true },
          { text: "Meta Business automation", upcoming: true },
        ],
      },
      pro: {
        title: "Pro",
        cadence: "Automation every 4 hours",
        description: "Faster growth and stronger operational control.",
        features: [
          { text: "Automatic product generation/upload every 4h" },
          { text: "Manage up to 3 stores in parallel" },
          { text: "Variant-focused product flow" },
          { text: "Priority production queue" },
          { text: "Pinterest automation", upcoming: true },
          { text: "Meta Business automation", upcoming: true },
          { text: "eBay automation", upcoming: true },
        ],
      },
      turbo: {
        title: "Turbo",
        cadence: "Automation every 2 hours",
        description: "For high-volume teams and aggressive scale.",
        features: [
          { text: "Automatic product generation/upload every 2h" },
          { text: "Unlimited store/category streams" },
          { text: "Bulk catalog + product updates" },
          { text: "Priority support and team access" },
          { text: "Pinterest + Meta + eBay + Amazon", upcoming: true },
          { text: "Advanced marketplace orchestration", upcoming: true },
        ],
      },
    },
  },
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isBillingPlan = (value: string | null | undefined): value is BillingPlan =>
  value === "standard" || value === "pro" || value === "turbo";
const isBillingInterval = (value: string | null | undefined): value is BillingInterval =>
  value === "month" || value === "year";

const syncServerSession = async (session: Session | null) => {
  if (session?.access_token) {
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      }),
    });
    return;
  }

  await fetch("/api/auth/session", { method: "DELETE" });
};

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
};

const PricingPage = () => {
  const { locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = COPY[locale];
  const { categories } = useCategoriesRepository(locale);

  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [planPricing, setPlanPricing] = useState<Record<BillingPlan, { month: number; year: number; discount: number }>>({
    standard: { month: 2990, year: 26910, discount: 25 },
    pro: { month: 4990, year: 44910, discount: 25 },
    turbo: { month: 7990, year: 71910, discount: 25 },
  });

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardBooting, setWizardBooting] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>("pro");
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardInfo, setWizardInfo] = useState<string | null>(null);

  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const [storeName, setStoreName] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [storeCategoryId, setStoreCategoryId] = useState("");
  const [storeSubmitting, setStoreSubmitting] = useState(false);
  const [createdStoreId, setCreatedStoreId] = useState<string | null>(null);
  const [createdStoreName, setCreatedStoreName] = useState<string | null>(null);

  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadPlanPricing = async () => {
      try {
        const response = await fetch("/api/billing/plans", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { plans?: PublicPlanPricing[] };

        if (!response.ok || !payload.plans || !mounted) {
          return;
        }

        setPlanPricing((prev) => {
          const next = { ...prev };
          for (const row of payload.plans ?? []) {
            next[row.plan] = {
              month: row.monthlyCents,
              year: row.yearlyCents,
              discount: row.yearlyDiscountPercent,
            };
          }
          return next;
        });
      } catch {
        // Keep fallback pricing when endpoint is unavailable.
      }
    };

    void loadPlanPricing();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!storeCategoryId && categories[0]) {
      setStoreCategoryId(categories[0].id);
    }
  }, [categories, storeCategoryId]);

  useEffect(() => {
    const onboardingFlag = searchParams.get("onboarding");
    if (onboardingFlag !== "1") {
      return;
    }

    const planParam = searchParams.get("plan");
    const intervalParam = searchParams.get("interval");
    const paramsAfterBoot = new URLSearchParams(searchParams.toString());
    paramsAfterBoot.delete("onboarding");
    paramsAfterBoot.delete("plan");
    paramsAfterBoot.delete("interval");

    if (isBillingPlan(planParam)) {
      setSelectedPlan(planParam);
    }

    if (isBillingInterval(intervalParam)) {
      setBillingInterval(intervalParam);
    }

    setIsWizardOpen(true);
    setWizardBooting(true);
    setWizardError(null);
    setWizardInfo(null);

    let canceled = false;

    const bootFromOAuth = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.access_token) {
          await syncServerSession(session);
          if (!canceled) {
            setWizardStep(2);
            setWizardInfo(copy.authSignedInNotice);
          }
        } else if (!canceled) {
          setWizardStep(1);
          setWizardError(copy.authSessionMissing);
        }
      } catch {
        if (!canceled) {
          setWizardStep(1);
          setWizardError(copy.authSessionMissing);
        }
      } finally {
        if (!canceled) {
          setWizardBooting(false);
        }

        const nextQuery = paramsAfterBoot.toString();
        router.replace(nextQuery ? `/pricing?${nextQuery}` : "/pricing");
      }
    };

    void bootFromOAuth();

    return () => {
      canceled = true;
    };
  }, [copy.authSessionMissing, copy.authSignedInNotice, router, searchParams]);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale === "en" ? "en-US" : "tr-TR", {
        style: "currency",
        currency: "USD",
      }),
    [locale]
  );

  const priceFor = (plan: BillingPlan, interval: BillingInterval) => {
    return interval === "year" ? planPricing[plan].year : planPricing[plan].month;
  };

  const selectedPrice = priceFor(selectedPlan, billingInterval);
  const orderedPlans: BillingPlan[] = ["standard", "pro", "turbo"];

  const stepItems = [
    { step: 1 as WizardStep, label: copy.stepNames.account },
    { step: 2 as WizardStep, label: copy.stepNames.store },
    { step: 3 as WizardStep, label: copy.stepNames.payment },
  ];

  const closeWizard = () => {
    if (authSubmitting || googleSubmitting || storeSubmitting || checkoutSubmitting) {
      return;
    }
    setIsWizardOpen(false);
    setWizardError(null);
    setWizardInfo(null);
  };

  const handleOpenWizard = async (plan: BillingPlan) => {
    setSelectedPlan(plan);
    setWizardError(null);
    setWizardInfo(null);
    setCreatedStoreId(null);
    setCreatedStoreName(null);
    setStoreName("");
    setStorePhone("");
    setAccountPassword("");
    setIsWizardOpen(true);
    setWizardBooting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        await syncServerSession(session);
        setWizardStep(2);
        setWizardInfo(copy.authSignedInNotice);
      } else {
        setWizardStep(1);
      }
    } catch {
      setWizardStep(1);
    } finally {
      setWizardBooting(false);
    }
  };

  const bootstrapProfile = async (session: Session, fullName?: string) => {
    const response = await fetch("/api/auth/bootstrap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        fullName: fullName?.trim() || undefined,
        locale,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || copy.genericError);
    }
  };

  const handleAccountSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authSubmitting || googleSubmitting) {
      return;
    }

    setWizardError(null);
    setWizardInfo(null);

    const normalizedEmail = accountEmail.trim().toLowerCase();
    const normalizedName = accountName.trim();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setWizardError(copy.authInvalidEmail);
      return;
    }

    if (authMode === "signup" && !normalizedName) {
      setWizardError(copy.authMissingName);
      return;
    }

    setAuthSubmitting(true);

    try {
      let session: Session | null = null;

      if (authMode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: accountPassword,
        });

        if (error) {
          throw error;
        }

        session = data.session;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password: accountPassword,
          options: {
            data: {
              full_name: normalizedName,
              display_name: normalizedName,
            },
          },
        });

        if (error) {
          throw error;
        }

        if (!data.session) {
          throw new Error(copy.authEmailConfirmRequired);
        }

        session = data.session;
      }

      if (!session?.access_token) {
        throw new Error(copy.authSessionMissing);
      }

      await syncServerSession(session);
      await bootstrapProfile(session, authMode === "signup" ? normalizedName : undefined);

      setWizardStep(2);
    } catch (error) {
      setWizardError(toErrorMessage(error, copy.genericError));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleGoogleOAuth = async () => {
    if (authSubmitting || googleSubmitting) {
      return;
    }

    setWizardError(null);
    setWizardInfo(null);
    setGoogleSubmitting(true);

    try {
      const nextPath = `/pricing?onboarding=1&plan=${selectedPlan}&interval=${billingInterval}`;
      const redirectTo = buildOAuthRedirectTo(`/auth/callback?next=${encodeURIComponent(nextPath)}`);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      setWizardError(toErrorMessage(error, copy.genericError));
      setGoogleSubmitting(false);
    }
  };

  const handleCreateStore = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (storeSubmitting) {
      return;
    }

    setWizardError(null);
    setWizardInfo(null);
    setStoreSubmitting(true);

    try {
      const normalizedPhone = storePhone.trim();
      if (!normalizedPhone) {
        throw new Error(copy.storePhoneRequired);
      }

      const categoryName =
        categories.find((category) => category.id === storeCategoryId)?.name || copy.storeDefaultCategory;

      const normalizedStoreName = storeName.trim();
      const response = await fetch("/api/onboarding/store", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeName: normalizedStoreName || null,
          phone: normalizedPhone,
          category: categoryName,
          priceCents: selectedPrice,
          fallbackStoreNamePrefix: copy.storeDefaultName,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        storeName?: string;
        error?: string;
      };

      if (!response.ok || !payload.id) {
        throw new Error(payload.error || copy.genericError);
      }

      setCreatedStoreId(payload.id);
      setCreatedStoreName((payload.storeName ?? normalizedStoreName) || copy.storeDefaultName);
      setWizardStep(3);
      setWizardInfo(copy.storeCreatedNotice);
    } catch (error) {
      setWizardError(toErrorMessage(error, copy.genericError));
    } finally {
      setStoreSubmitting(false);
    }
  };

  const handleCheckout = async () => {
    if (checkoutSubmitting) {
      return;
    }

    setWizardError(null);
    setWizardInfo(null);

    if (!createdStoreId) {
      setWizardStep(2);
      setWizardError(copy.genericError);
      return;
    }

    setCheckoutSubmitting(true);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "subscription",
          plan: selectedPlan,
          interval: billingInterval,
          shopId: createdStoreId,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || copy.genericError);
      }

      window.location.href = payload.url;
    } catch (error) {
      setWizardError(toErrorMessage(error, copy.genericError));
      setCheckoutSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <nav className="sticky top-0 z-40 px-6 md:px-8 py-5 glass-pro border-b border-indigo-500/10">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            listflow.pro
          </Link>
          <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            {copy.stepsTitle}
          </div>
        </div>
      </nav>

      <main className="px-6 py-14 md:py-18">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10 md:mb-14">
            <p className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300 mb-6">
              <Rocket className="w-4 h-4" />
              {copy.badge}
            </p>
            <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-tight mb-4">{copy.title}</h1>
            <p className="max-w-3xl mx-auto text-sm md:text-lg text-slate-400 font-medium leading-relaxed">{copy.subtitle}</p>
          </div>

          <div className="max-w-md mx-auto mb-10 p-2 rounded-2xl bg-white/5 border border-white/10 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setBillingInterval("month")}
              className={`rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                billingInterval === "month"
                  ? "bg-indigo-600 text-white border border-indigo-500/50"
                  : "text-slate-400 border border-transparent hover:text-white"
              }`}
            >
              {copy.monthly}
            </button>
            <button
              type="button"
              onClick={() => setBillingInterval("year")}
              className={`rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                billingInterval === "year"
                  ? "bg-indigo-600 text-white border border-indigo-500/50"
                  : "text-slate-400 border border-transparent hover:text-white"
              }`}
            >
              {copy.yearly}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-7">
            {orderedPlans.map((plan) => {
              const planCopy = copy.plans[plan];
              const isPopular = plan === "pro";
              const cents = priceFor(plan, billingInterval);
              const discount = planPricing[plan].discount;

              return (
                <motion.article
                  key={plan}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className={`relative rounded-[34px] border p-7 md:p-8 flex flex-col ${
                    isPopular
                      ? "border-indigo-500/60 bg-indigo-500/10 shadow-[0_0_45px_rgba(79,70,229,0.25)] md:-translate-y-2"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  {isPopular ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-indigo-400/60 bg-indigo-600 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-white">
                      {copy.mostPopular}
                    </span>
                  ) : null}

                  <div className="mb-5">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-300 mb-2">{planCopy.title}</div>
                    <p className="text-sm text-slate-300 font-semibold">{planCopy.cadence}</p>
                    <p className="text-xs text-slate-500 mt-2">{planCopy.description}</p>
                  </div>

                  <div className="mb-6">
                    <div className="text-4xl font-black tracking-tight">{currencyFormatter.format(cents / 100)}</div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mt-1">
                      {billingInterval === "year" ? copy.perYear : copy.perMonth}
                    </div>
                    {billingInterval === "year" ? (
                      <div className="mt-2 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                        %{discount} {copy.yearlySaveLabel}
                      </div>
                    ) : null}
                  </div>

                  <ul className="space-y-2.5 mb-7">
                    {planCopy.features.map((feature) => (
                      <li key={feature.text} className="flex items-start gap-2.5 text-sm">
                        <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-indigo-400/35 bg-indigo-500/10 text-indigo-300">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-slate-200 leading-snug">
                          {feature.text}
                          {feature.upcoming ? (
                            <span className="ml-2 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-amber-300">
                              {copy.upcomingLabel}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={() => void handleOpenWizard(plan)}
                    className={`mt-auto w-full rounded-2xl px-5 py-4 text-sm font-black uppercase tracking-[0.2em] transition-all cursor-pointer flex items-center justify-center gap-2 ${
                      isPopular
                        ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-xl shadow-indigo-500/30"
                        : "bg-white text-black hover:opacity-90"
                    }`}
                  >
                    {copy.startPlan}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </motion.article>
              );
            })}
          </div>
        </div>
      </main>

      <Footer />

      <AnimatePresence>
        {isWizardOpen ? (
          <div className="fixed inset-0 z-[140] flex items-center justify-center p-3 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeWizard}
              className="absolute inset-0 bg-black/85 backdrop-blur-xl"
            />

            <motion.section
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              className="relative z-[141] h-[94vh] w-full max-w-6xl rounded-[38px] border border-white/10 bg-[#0d1016] shadow-2xl flex flex-col overflow-hidden"
            >
              <header className="shrink-0 border-b border-white/10 px-5 sm:px-7 py-4 sm:py-5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300 mb-2">{copy.stepsTitle}</p>
                    <h2 className="text-xl md:text-2xl font-black">{copy.stepsSubtitle}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={closeWizard}
                    className="h-9 w-9 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-indigo-500/40 transition-all flex items-center justify-center cursor-pointer"
                    aria-label={copy.close}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {stepItems.map((item) => {
                    const isCurrent = wizardStep === item.step;
                    const isCompleted = wizardStep > item.step;
                    return (
                      <div
                        key={item.step}
                        className={`rounded-xl border px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest ${
                          isCompleted
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            : isCurrent
                              ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200"
                              : "border-white/10 bg-white/5 text-slate-500"
                        }`}
                      >
                        {item.label}
                      </div>
                    );
                  })}
                </div>
              </header>

              <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 sm:py-6">
                {wizardError ? (
                  <div className="mb-4 rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {wizardError}
                  </div>
                ) : null}
                {wizardInfo ? (
                  <div className="mb-4 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                    {wizardInfo}
                  </div>
                ) : null}

                {wizardBooting ? (
                  <div className="h-full min-h-[300px] flex items-center justify-center">
                    <div className="flex items-center gap-3 text-slate-300">
                      <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                      <span className="text-sm font-semibold">{copy.authInProgress}</span>
                    </div>
                  </div>
                ) : null}

                {!wizardBooting && wizardStep === 1 ? (
                  <div className="max-w-2xl mx-auto">
                    <h3 className="text-2xl font-black mb-2">{copy.authTitle}</h3>
                    <p className="text-slate-400 mb-6">{copy.authSubtitle}</p>

                    <div className="grid grid-cols-2 gap-2 p-2 rounded-2xl border border-white/10 bg-white/5 mb-6">
                      <button
                        type="button"
                        onClick={() => setAuthMode("signin")}
                        className={`rounded-xl py-3 text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                          authMode === "signin"
                            ? "bg-indigo-600 text-white"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        {copy.authModeSignin}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuthMode("signup")}
                        className={`rounded-xl py-3 text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                          authMode === "signup"
                            ? "bg-indigo-600 text-white"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        {copy.authModeSignup}
                      </button>
                    </div>

                    <form onSubmit={handleAccountSubmit} className="space-y-4">
                      {authMode === "signup" ? (
                        <label className="block">
                          <span className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">{copy.authFullName}</span>
                          <div className="relative">
                            <User className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                            <input
                              type="text"
                              value={accountName}
                              onChange={(event) => setAccountName(event.target.value)}
                              placeholder={copy.authPlaceholderName}
                              className="w-full rounded-2xl border border-white/10 bg-white/5 pl-12 pr-4 py-3.5 text-white outline-none focus:ring-2 focus:ring-indigo-500"
                              required
                            />
                          </div>
                        </label>
                      ) : null}

                      <label className="block">
                        <span className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">{copy.authEmail}</span>
                        <div className="relative">
                          <Mail className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                          <input
                            type="email"
                            value={accountEmail}
                            onChange={(event) => setAccountEmail(event.target.value)}
                            placeholder={copy.authPlaceholderEmail}
                            className="w-full rounded-2xl border border-white/10 bg-white/5 pl-12 pr-4 py-3.5 text-white outline-none focus:ring-2 focus:ring-indigo-500"
                            required
                          />
                        </div>
                      </label>

                      <label className="block">
                        <span className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">{copy.authPassword}</span>
                        <div className="relative">
                          <Lock className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                          <input
                            type="password"
                            value={accountPassword}
                            onChange={(event) => setAccountPassword(event.target.value)}
                            placeholder={copy.authPlaceholderPassword}
                            className="w-full rounded-2xl border border-white/10 bg-white/5 pl-12 pr-4 py-3.5 text-white outline-none focus:ring-2 focus:ring-indigo-500"
                            required
                          />
                        </div>
                      </label>

                      <button
                        type="submit"
                        disabled={authSubmitting || googleSubmitting}
                        className="w-full rounded-2xl bg-indigo-600 py-4 text-sm font-black uppercase tracking-[0.2em] text-white hover:bg-indigo-500 transition-all disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
                      >
                        {authSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {authSubmitting ? copy.authInProgress : copy.authContinue}
                      </button>

                      <div className="relative py-2">
                        <div className="h-px w-full bg-white/10" />
                        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0d1016] px-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                          {copy.authOrDivider}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleGoogleOAuth()}
                        disabled={authSubmitting || googleSubmitting}
                        className="w-full rounded-2xl border border-white/15 bg-white/5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white hover:bg-white/10 transition-all disabled:opacity-60 cursor-pointer flex items-center justify-center gap-3"
                      >
                        <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
                          <path
                            fill="#EA4335"
                            d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.8-6-6.2s2.7-6.2 6-6.2c1.9 0 3.2.8 3.9 1.5l2.7-2.6C17.1 2.9 14.8 2 12 2 6.9 2 2.8 6.4 2.8 11.8S6.9 21.6 12 21.6c6.9 0 9.1-4.9 9.1-7.4 0-.5-.1-.9-.2-1.3H12z"
                          />
                        </svg>
                        {googleSubmitting ? copy.authGoogleInProgress : copy.authGoogle}
                      </button>
                    </form>
                  </div>
                ) : null}

                {!wizardBooting && wizardStep === 2 ? (
                  <div className="max-w-2xl mx-auto">
                    <h3 className="text-2xl font-black mb-2">{copy.storeTitle}</h3>
                    <p className="text-slate-400 mb-6">{copy.storeSubtitle}</p>

                    <form onSubmit={handleCreateStore} className="space-y-4">
                      <label className="block">
                        <span className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">{copy.storeName}</span>
                        <div className="relative">
                          <Store className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                          <input
                            type="text"
                            value={storeName}
                            onChange={(event) => setStoreName(event.target.value)}
                            placeholder={copy.storePlaceholderName}
                            className="w-full rounded-2xl border border-white/10 bg-white/5 pl-12 pr-4 py-3.5 text-white outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </label>

                      <label className="block">
                        <span className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">{copy.storePhone}</span>
                        <div className="relative">
                          <Smartphone className="absolute left-4 top-3.5 h-5 w-5 text-slate-500" />
                          <input
                            type="tel"
                            value={storePhone}
                            onChange={(event) => setStorePhone(event.target.value)}
                            placeholder={copy.storePlaceholderPhone}
                            className="w-full rounded-2xl border border-white/10 bg-white/5 pl-12 pr-4 py-3.5 text-white outline-none focus:ring-2 focus:ring-indigo-500"
                            required
                          />
                        </div>
                      </label>

                      <label className="block">
                        <span className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">{copy.storeCategory}</span>
                        <select
                          value={storeCategoryId}
                          onChange={(event) => setStoreCategoryId(event.target.value)}
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {categories.length ? (
                            categories.map((category) => (
                              <option key={category.id} value={category.id} className="bg-[#0d1016]">
                                {category.name}
                              </option>
                            ))
                          ) : (
                            <option value="" className="bg-[#0d1016]">
                              {copy.storeDefaultCategory}
                            </option>
                          )}
                        </select>
                      </label>

                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setWizardStep(1)}
                          className="rounded-2xl border border-white/10 bg-white/5 py-3.5 text-xs font-black uppercase tracking-widest text-slate-300 hover:text-white transition-all cursor-pointer"
                        >
                          {copy.back}
                        </button>
                        <button
                          type="submit"
                          disabled={storeSubmitting}
                          className="rounded-2xl bg-indigo-600 py-3.5 text-xs font-black uppercase tracking-widest text-white hover:bg-indigo-500 transition-all disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
                        >
                          {storeSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          {storeSubmitting ? copy.storeCreating : copy.storeCreate}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}

                {!wizardBooting && wizardStep === 3 ? (
                  <div className="max-w-2xl mx-auto">
                    <h3 className="text-2xl font-black mb-2">{copy.paymentTitle}</h3>
                    <p className="text-slate-400 mb-6">{copy.paymentSubtitle}</p>

                    <div className="space-y-3 mb-6">
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{copy.paymentPlan}</span>
                        <span className="text-sm font-bold text-white">{copy.plans[selectedPlan].title}</span>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{copy.paymentInterval}</span>
                        <span className="text-sm font-bold text-white">
                          {billingInterval === "year" ? copy.yearly : copy.monthly}
                        </span>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{copy.paymentStore}</span>
                        <span className="text-sm font-bold text-white">{createdStoreName ?? "-"}</span>
                      </div>
                      <div className="rounded-2xl border border-indigo-500/35 bg-indigo-500/10 px-4 py-3 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-indigo-300">{copy.paymentPrice}</span>
                        <span className="text-lg font-black text-white">{currencyFormatter.format(selectedPrice / 100)}</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 mb-6">{copy.paymentHint}</p>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setWizardStep(2)}
                        className="rounded-2xl border border-white/10 bg-white/5 py-3.5 text-xs font-black uppercase tracking-widest text-slate-300 hover:text-white transition-all cursor-pointer"
                      >
                        {copy.back}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCheckout()}
                        disabled={checkoutSubmitting}
                        className="rounded-2xl bg-emerald-600 py-3.5 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-500 transition-all disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
                      >
                        {checkoutSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                        {checkoutSubmitting ? copy.paymentProcessing : copy.paymentCheckout}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.section>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export default PricingPage;
