"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Globe2,
  Layers,
  Package,
  Rocket,
  Menu,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "../store";
import { View } from "../types";
import { useI18n } from "@/lib/i18n/provider";

type FeatureCard = {
  icon: LucideIcon;
  title: string;
  desc: string;
  badge: string;
};

type LandingCopy = {
  heroPointA: string;
  heroPointB: string;
  trustTitle: string;
  trustItems: string[];
  metricCards: Array<{ value: string; label: string }>;
  featureTitle: string;
  featureSubtitle: string;
  howTitle: string;
  howSubtitle: string;
  howSteps: Array<{ title: string; desc: string }>;
  plansTitle: string;
  plansSubtitle: string;
  plans: Array<{
    name: string;
    cadence: string;
    detail: string;
    highlights: string[];
  }>;
  finalTitle: string;
  finalSubtitle: string;
  finalPrimaryCta: string;
  finalSecondaryCta: string;
  cardControlTitle: string;
  cardControlSubtitle: string;
  cardRows: Array<{ store: string; status: string; eta: string }>;
};

const coreFeatureIcons: LucideIcon[] = [Layers, Braces, Package, Globe2];
const extraFeatureIcons: LucideIcon[] = [ShieldCheck, Workflow];

const LandingPage: React.FC = () => {
  const { setView } = useStore();
  const { t, messages, locale } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const copy: LandingCopy =
    locale === "en"
      ? {
          heroPointA: "Webhook-authoritative subscription sync",
          heroPointB: "2h / 4h / 8h automation cadence by plan",
          trustTitle: "Growth-focused teams rely on Listflow",
          trustItems: ["Etsy Labs", "Pixel Warehouse", "North Atlas", "Studio Nomad", "Flow Commerce"],
          metricCards: [
            { value: "99.9%", label: "Job Reliability" },
            { value: "<120s", label: "Webhook Visibility" },
            { value: "3x", label: "Faster Store Activation" },
            { value: "24/7", label: "Operational Monitoring" },
          ],
          featureTitle: "Built for serious SaaS operations",
          featureSubtitle: "Not a template panel. A production-grade automation control center.",
          howTitle: "How your production loop works",
          howSubtitle: "From category choice to predictable recurring output in 3 operational blocks.",
          howSteps: [
            {
              title: "1. Configure",
              desc: "Pick categories, map your store, and define your product scope with cost-aware controls.",
            },
            {
              title: "2. Orchestrate",
              desc: "Automation runs by plan cadence while Stripe webhooks keep billing truth synced to your database.",
            },
            {
              title: "3. Scale",
              desc: "Monitor jobs, retry failures, and expand into new channels without changing your core workflow.",
            },
          ],
          plansTitle: "Cadence-first pricing model",
          plansSubtitle: "Choose your automation frequency and unlock upcoming marketplace channels.",
          plans: [
            {
              name: "Starter",
              cadence: "Every 8 hours",
              detail: "Best for stable launch rhythm",
              highlights: ["Single-store focus", "Pinterest (coming soon)", "Meta Business (coming soon)"],
            },
            {
              name: "Pro",
              cadence: "Every 4 hours",
              detail: "Most popular for growth",
              highlights: ["Multi-store flow", "eBay (coming soon)", "Priority queue"],
            },
            {
              name: "Turbo",
              cadence: "Every 2 hours",
              detail: "High-throughput operations",
              highlights: ["Unlimited expansion", "Amazon (coming soon)", "Advanced orchestration"],
            },
          ],
          finalTitle: "Move from manual hustle to measurable automation",
          finalSubtitle:
            "Create your account, connect your first store, and start monetizing with a workflow that looks and behaves like a real product company.",
          finalPrimaryCta: "Open Pricing",
          finalSecondaryCta: "Start Account",
          cardControlTitle: "Automation Control Center",
          cardControlSubtitle: "Live queue snapshot",
          cardRows: [
            { store: "NordicPrintLab", status: "Active", eta: "next: 01h 12m" },
            { store: "FrameMintCo", status: "Queued", eta: "next: 03h 55m" },
            { store: "CraftFlowStudio", status: "Running", eta: "next: 00h 42m" },
          ],
        }
      : {
          heroPointA: "Webhook doğrulamalı abonelik senkronu",
          heroPointB: "Plana göre 2s / 4s / 8s otomasyon ritmi",
          trustTitle: "Büyüme odaklı ekipler Listflow ile çalışıyor",
          trustItems: ["Etsy Labs", "Pixel Warehouse", "North Atlas", "Studio Nomad", "Flow Commerce"],
          metricCards: [
            { value: "%99.9", label: "Job Güvenilirliği" },
            { value: "<120sn", label: "Webhook Görünürlüğü" },
            { value: "3x", label: "Daha Hızlı Mağaza Aktivasyonu" },
            { value: "7/24", label: "Operasyon Takibi" },
          ],
          featureTitle: "Gerçek SaaS operasyonları için tasarlandı",
          featureSubtitle: "Template panel değil. Üretim odaklı otomasyon komuta merkezi.",
          howTitle: "Üretim döngünüz nasıl çalışır?",
          howSubtitle: "Kategori seçiminden düzenli çıktıya 3 operasyon bloğunda ilerleyin.",
          howSteps: [
            {
              title: "1. Kurgula",
              desc: "Kategori seç, mağazanı eşleştir, maliyet odaklı ürün kapsamını belirle.",
            },
            {
              title: "2. Çalıştır",
              desc: "Otomasyon plan ritminde çalışırken Stripe webhookları ödeme durumunu veritabanına senkronlar.",
            },
            {
              title: "3. Ölçekle",
              desc: "Job geçmişini izle, hatalı koşuları tekrar dene ve yeni kanallara akışı bozmadan genişle.",
            },
          ],
          plansTitle: "Ritme odaklı fiyatlandırma modeli",
          plansSubtitle: "Otomasyon sıklığını seç, yeni pazaryeri kanallarını aç.",
          plans: [
            {
              name: "Starter",
              cadence: "8 saatte bir",
              detail: "Dengeli başlangıç ritmi",
              highlights: ["Tek mağaza odak", "Pinterest (yakında)", "Meta Business (yakında)"],
            },
            {
              name: "Pro",
              cadence: "4 saatte bir",
              detail: "Büyüme için en popüler",
              highlights: ["Çoklu mağaza akışı", "eBay (yakında)", "Öncelikli kuyruk"],
            },
            {
              name: "Turbo",
              cadence: "2 saatte bir",
              detail: "Yüksek hacimli operasyon",
              highlights: ["Sınırsız genişleme", "Amazon (yakında)", "Gelişmiş orkestrasyon"],
            },
          ],
          finalTitle: "Manuel yorgunluktan ölçülebilir otomasyona geç",
          finalSubtitle:
            "Hesabını aç, ilk mağazanı bağla ve gerçek bir ürün şirketi gibi çalışan operasyonla gelir üretmeye başla.",
          finalPrimaryCta: "Fiyatlandırmayı Aç",
          finalSecondaryCta: "Hesap Aç",
          cardControlTitle: "Otomasyon Kontrol Merkezi",
          cardControlSubtitle: "Canlı kuyruk görünümü",
          cardRows: [
            { store: "NordicPrintLab", status: "Aktif", eta: "sıradaki: 01s 12dk" },
            { store: "FrameMintCo", status: "Kuyrukta", eta: "sıradaki: 03s 55dk" },
            { store: "CraftFlowStudio", status: "Çalışıyor", eta: "sıradaki: 00s 42dk" },
          ],
        };

  const landingCoreFeatures = messages.landing.features.map((feature, index) => ({
    icon: coreFeatureIcons[index] ?? Layers,
    title: feature.title,
    desc: feature.desc,
    badge: locale === "en" ? "Core" : "Temel",
  }));

  const extraFeatures: FeatureCard[] =
    locale === "en"
      ? [
          {
            icon: extraFeatureIcons[0] ?? ShieldCheck,
            title: "Billing Integrity",
            desc: "Webhook-first Stripe sync with replay-safe event handling and resilient state updates.",
            badge: "Secure",
          },
          {
            icon: extraFeatureIcons[1] ?? Workflow,
            title: "Automation Engine",
            desc: "Plan-based scheduling, observable job logs, retries, and operational controls in one place.",
            badge: "Ops",
          },
        ]
      : [
          {
            icon: extraFeatureIcons[0] ?? ShieldCheck,
            title: "Ödeme Bütünlüğü",
            desc: "Webhook öncelikli Stripe senkronu ile tekrar oynatmaya dayanıklı ve güvenli durum güncellemeleri.",
            badge: "Güvenli",
          },
          {
            icon: extraFeatureIcons[1] ?? Workflow,
            title: "Otomasyon Motoru",
            desc: "Plan bazlı zamanlama, gözlemlenebilir job logları, retry ve operasyon kontrolleri tek panelde.",
            badge: "Operasyon",
          },
        ];

  const allFeatures: FeatureCard[] = [...landingCoreFeatures, ...extraFeatures];

  return (
    <div className="relative overflow-hidden bg-[#07080d] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-[-180px] h-[420px] w-[420px] rounded-full bg-indigo-500/25 blur-[140px]" />
        <div className="absolute right-[-180px] top-16 h-[360px] w-[360px] rounded-full bg-cyan-500/15 blur-[130px]" />
        <div className="absolute bottom-[-220px] left-1/2 h-[420px] w-[520px] -translate-x-1/2 rounded-full bg-fuchsia-500/10 blur-[160px]" />
      </div>

      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-[#07080d]/72 px-6 py-5 backdrop-blur-2xl md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="flex h-11 w-11 group-hover:rotate-12 group-hover:scale-110 group-hover:shadow-2xl group-hover:shadow-indigo-500 transition-all items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-600 shadow-[0_0_25px_rgba(79,70,229,0.35)]">
              <Rocket className="h-5 w-5 text-white" />
            </div>
            <p className="text-xl font-black tracking-tight">
              listflow<span className="text-indigo-400">.pro</span>
            </p>
          </div>

          <div className="hidden items-center gap-10 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 lg:flex">
            <a href="#landing-features" className="transition-colors hover:text-indigo-300">
              {t("landing.navFeatures")}
            </a>
            <a href="#landing-catalog" className="transition-colors hover:text-indigo-300">
              {t("landing.navCatalog")}
            </a>
            <Link href="/pricing" className="transition-colors hover:text-indigo-300">
              {t("landing.navPricing")}
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white lg:hidden cursor-pointer"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-label="Menüyü aç"
            >
              {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setView(View.AUTH)}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white transition-all hover:border-indigo-400/35 hover:bg-indigo-500/10 md:px-6 md:py-3 md:text-[11px]"
            >
              {t("landing.login")}
            </button>
          </div>
        </div>
        {mobileNavOpen ? (
          <div className="mx-auto mt-4 max-w-7xl rounded-2xl border border-white/10 bg-[#0d1018] p-4 lg:hidden">
            <div className="flex flex-col gap-3 text-[11px] font-black uppercase tracking-[0.2em] text-slate-300">
              <a href="#landing-features" className="transition-colors hover:text-indigo-300" onClick={() => setMobileNavOpen(false)}>
                {t("landing.navFeatures")}
              </a>
              <a href="#landing-catalog" className="transition-colors hover:text-indigo-300" onClick={() => setMobileNavOpen(false)}>
                {t("landing.navCatalog")}
              </a>
              <Link href="/pricing" className="transition-colors hover:text-indigo-300" onClick={() => setMobileNavOpen(false)}>
                {t("landing.navPricing")}
              </Link>
            </div>
          </div>
        ) : null}
      </nav>

      <main className="relative z-10 px-6 pb-24 pt-32 md:px-8 md:pt-36">
        <section className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">
              <Sparkles className="h-4 w-4" />
              {t("landing.badge")}
            </div>

            <h1 className="text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl lg:text-7xl">
              {t("landing.titleLine1")}
              <br />
              <span className="text-indigo-400">{t("landing.titleAccent")}</span> {t("landing.titleLine2")}
            </h1>

            <p className="mt-7 max-w-2xl text-base font-semibold leading-relaxed text-slate-300 sm:text-lg">
              {t("landing.subtitle")}
            </p>

            <div className="mt-8 flex flex-col gap-3 text-sm font-semibold text-slate-300 sm:flex-row sm:items-center sm:gap-7">
              <div className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>{copy.heroPointA}</span>
              </div>
              <div className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-indigo-300" />
                <span>{copy.heroPointB}</span>
              </div>
            </div>

            <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <button
                onClick={() => setView(View.AUTH)}
                className="inline-flex items-center gap-2 rounded-2xl border border-indigo-400/50 bg-indigo-600 px-8 py-4 text-xs font-black uppercase tracking-[0.2em] text-white shadow-[0_0_35px_rgba(79,70,229,0.35)] transition-all hover:bg-indigo-500"
              >
                {t("landing.startNow")}
                <ChevronRight className="h-4 w-4" />
              </button>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-8 py-4 text-xs font-black uppercase tracking-[0.2em] text-white transition-all hover:border-indigo-400/40 hover:bg-white/10"
              >
                {t("landing.discover")}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="relative rounded-[34px] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">{copy.cardControlTitle}</p>
                <p className="mt-1 text-sm font-semibold text-slate-400">{copy.cardControlSubtitle}</p>
              </div>
              <div className="rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                Live
              </div>
            </div>

            <div className="space-y-3">
              {copy.cardRows.map((row) => (
                <div key={row.store} className="rounded-2xl border border-white/10 bg-[#0d1220]/70 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-white">{row.store}</p>
                    <span className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-indigo-300">
                      {row.status}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-slate-400">{row.eta}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-7 items-end gap-2">
              {[38, 52, 44, 60, 54, 70, 64].map((height, index) => (
                <motion.div
                  key={`${height}-${index}`}
                  initial={{ scaleY: 0.2, opacity: 0.25 }}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{ delay: 0.2 + index * 0.05, duration: 0.35 }}
                  className="origin-bottom rounded-md bg-gradient-to-t from-indigo-500/25 to-cyan-300/70"
                  style={{ height }}
                />
              ))}
            </div>
          </motion.div>
        </section>

        <section className="mx-auto mt-16 max-w-7xl">
          <p className="mb-5 text-center text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">{copy.trustTitle}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {copy.trustItems.map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-black uppercase tracking-[0.15em] text-slate-300"
              >
                {item}
              </span>
            ))}
          </div>
        </section>

        <section id="landing-catalog" className="mx-auto mt-12 grid max-w-7xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {copy.metricCards.map((metric) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
            >
              <p className="text-3xl font-black tracking-tight text-white">{metric.value}</p>
              <p className="mt-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{metric.label}</p>
            </motion.div>
          ))}
        </section>

        <section id="landing-features" className="mx-auto mt-24 max-w-7xl">
          <div className="mb-8 max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">{copy.featureTitle}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.featureSubtitle}</h2>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {allFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <motion.article
                  key={feature.title}
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  className="group rounded-[28px] border border-white/10 bg-white/5 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-indigo-400/35 hover:bg-indigo-500/10"
                >
                  <div className="mb-4 inline-flex rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-3">
                    <Icon className="h-5 w-5 text-indigo-300" />
                  </div>
                  <p className="mb-2 inline-flex rounded-full border border-white/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
                    {feature.badge}
                  </p>
                  <h3 className="text-xl font-black tracking-tight text-white">{feature.title}</h3>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-400">{feature.desc}</p>
                </motion.article>
              );
            })}
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-7xl">
          <div className="mb-8 max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">{copy.howTitle}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.howSubtitle}</h2>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {copy.howSteps.map((step) => (
              <motion.article
                key={step.title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                className="rounded-[28px] border border-white/10 bg-[#0f1422]/80 p-6"
              >
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-400/35 bg-indigo-500/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">
                  <Bot className="h-3.5 w-3.5" />
                  {step.title}
                </div>
                <p className="text-sm font-medium leading-relaxed text-slate-300">{step.desc}</p>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-7xl">
          <div className="mb-8 max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">{copy.plansTitle}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.plansSubtitle}</h2>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {copy.plans.map((plan, index) => (
              <motion.article
                key={plan.name}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                className={`rounded-[30px] border p-7 ${
                  index === 1
                    ? "border-indigo-400/45 bg-indigo-500/12 shadow-[0_0_35px_rgba(79,70,229,0.25)]"
                    : "border-white/10 bg-white/5"
                }`}
              >
                <div className="mb-3 inline-flex rounded-full border border-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                  {plan.name}
                </div>
                <p className="text-2xl font-black tracking-tight text-white">{plan.cadence}</p>
                <p className="mt-1 text-sm font-semibold text-slate-400">{plan.detail}</p>
                <div className="mt-5 space-y-2">
                  {plan.highlights.map((item) => (
                    <div key={item} className="flex items-center gap-2 text-sm font-medium text-slate-200">
                      <Zap className="h-4 w-4 text-indigo-300" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.35 }}
            className="rounded-[36px] border border-indigo-400/35 bg-gradient-to-r from-indigo-600/35 via-indigo-500/20 to-cyan-500/20 p-8 md:p-11"
          >
            <div className="max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200">listflow.pro</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.finalTitle}</h2>
              <p className="mt-4 text-sm font-semibold leading-relaxed text-slate-200 md:text-base">{copy.finalSubtitle}</p>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white px-7 py-4 text-xs font-black uppercase tracking-[0.2em] text-slate-900 transition-all hover:bg-slate-100"
              >
                {copy.finalPrimaryCta}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <button
                onClick={() => setView(View.AUTH)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-7 py-4 text-xs font-black uppercase tracking-[0.2em] text-white transition-all hover:bg-white/15"
              >
                {copy.finalSecondaryCta}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        </section>
      </main>
    </div>
  );
};

export default LandingPage;
