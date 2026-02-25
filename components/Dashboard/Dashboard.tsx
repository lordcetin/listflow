"use client";


import React, { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import CategoriesPanel from './CategoriesPanel';
import EtsyPanel from './EtsyPanel';
import OrdersPanel from './OrdersPanel';
import SettingsPanel from './SettingsPanel';
import { useStore } from '../../store';
import { DashboardSection } from '../../types';
import { supabase } from '../../lib/supabaseClient';
import { Menu, User } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';

type SubscriptionSummary = {
  plan: string | null;
  status: string | null;
};

type ProfileSummary = {
  full_name?: string | null;
};

const PLAN_PRIORITY = ["turbo", "pro", "standard"] as const;

const Dashboard: React.FC = () => {
  const { dashboardSection } = useStore();
  const { t } = useI18n();
  const [userName, setUserName] = useState<string>('...');
  const [planLabel, setPlanLabel] = useState<string>(t("dashboard.planLoading"));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    const resolvePlanLabel = (plan: string | null | undefined, status: string | null | undefined) => {
      const normalizedPlan = (plan ?? "").toLowerCase();
      const normalizedStatus = (status ?? "").toLowerCase();

      let label = t("dashboard.planFree");
      if (normalizedPlan === "standard") label = t("dashboard.planStandard");
      if (normalizedPlan === "pro") label = t("dashboard.planPro");
      if (normalizedPlan === "turbo") label = t("dashboard.planTurbo");

      if (normalizedStatus === "trialing") {
        return `${label} (${t("dashboard.planTrialSuffix")})`;
      }

      return label;
    };

    const fetchUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", user.id)
            .maybeSingle<ProfileSummary>();

          // Önce profiles.full_name, sonra metadata, sonra email fallback.
          const fullNameFromProfile = profile?.full_name?.trim();
          const fullNameFromMetadata =
            (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "") ||
            (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "");
          const emailPrefix = user.email?.split('@')[0];
          if (mounted) {
            setUserName(fullNameFromProfile || fullNameFromMetadata || emailPrefix || t("dashboard.userFallback"));
          }

          let selectedSubscription: SubscriptionSummary | null = null;

          for (const plan of PLAN_PRIORITY) {
            const { data } = await supabase
              .from("subscriptions")
              .select("plan, status")
              .eq("user_id", user.id)
              .eq("plan", plan)
              .in("status", ["active", "trialing"])
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle<SubscriptionSummary>();

            if (data) {
              selectedSubscription = data;
              break;
            }
          }

          if (mounted) {
            setPlanLabel(resolvePlanLabel(selectedSubscription?.plan, selectedSubscription?.status));
          }
          return;
        }

        if (mounted) {
          setUserName(t("dashboard.userFallback"));
          setPlanLabel(t("dashboard.planUnknown"));
        }
      } catch {
        if (mounted) {
          setUserName(t("dashboard.userFallback"));
          setPlanLabel(t("dashboard.planUnknown"));
        }
      }
    };
    fetchUser();

    return () => {
      mounted = false;
    };
  }, [t]);

  const renderContent = () => {
    switch (dashboardSection) {
      case DashboardSection.CATEGORIES: return <CategoriesPanel />;
      case DashboardSection.ETSY_AUTOMATION: return <EtsyPanel />;
      case DashboardSection.PINTEREST_AUTOMATION:
      case DashboardSection.META_AUTOMATION:
      case DashboardSection.EBAY_AUTOMATION:
      case DashboardSection.AMAZON_AUTOMATION:
        return (
          <div className="h-full w-full flex items-center justify-center">
            <div className="glass-card-pro border border-white/10 rounded-[32px] p-10 max-w-xl w-full text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300 mb-3">
                {t("dashboard.sections." + dashboardSection)}
              </p>
              <p className="text-slate-300 font-semibold">{t("common.comingSoon")}</p>
            </div>
          </div>
        );
      case DashboardSection.ORDERS: return <OrdersPanel />;
      case DashboardSection.SETTINGS: return <SettingsPanel />;
      default: return null;
    }
  };

  return (
    <>
    <div className="flex h-screen overflow-hidden bg-[#0a0a0c]">
      <Sidebar mobileOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 px-4 sm:px-6 lg:px-10 flex items-center justify-between glass-pro border-b border-indigo-500/10 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 lg:hidden cursor-pointer"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Menüyü aç"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h2 className="text-sm sm:text-base lg:text-xl font-black tracking-tight text-white uppercase">
              {t(`dashboard.sections.${dashboardSection}`)}
            </h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 pl-2 group">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-black text-white leading-none mb-1">{userName}</p>
                <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">
                  {`${t("dashboard.planPrefix")}: ${planLabel}`}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center border border-indigo-500/20 overflow-hidden">
                <User className="text-white w-6 h-6" />
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-hidden">
          {renderContent()}
        </main>
      </div>
    </div>
    </>
  );
};

export default Dashboard;
