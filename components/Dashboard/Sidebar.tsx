"use client";


import React from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../../store';
import { DashboardSection, View } from '../../types';
import { supabase } from '../../lib/supabaseClient';
import { useI18n } from '@/lib/i18n/provider';
import { 
  Layers, 
  Store, 
  Sparkles,
  Globe2,
  Workflow,
  ShieldCheck,
  Package, 
  Settings, 
  LogOut, 
  Rocket
} from 'lucide-react';

type SidebarProps = {
  mobileOpen?: boolean;
  onClose?: () => void;
};

const Sidebar: React.FC<SidebarProps> = ({ mobileOpen = false, onClose }) => {
  const { dashboardSection, setDashboardSection, setView } = useStore();
  const { t } = useI18n();

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    await fetch("/api/auth/session", { method: "DELETE" });
    if (error) {
      console.error("Çıkış yapılırken hata:", error.message);
    }
    onClose?.();
    setView(View.AUTH);
  };

  const menuItems = [
    { id: DashboardSection.CATEGORIES, label: t("sidebar.categories"), icon: Layers },
    { id: DashboardSection.ETSY_AUTOMATION, label: t("sidebar.etsyAutomation"), icon: Store },
    { id: DashboardSection.PINTEREST_AUTOMATION, label: t("sidebar.pinterestAutomation"), icon: Sparkles, comingSoon: true },
    { id: DashboardSection.META_AUTOMATION, label: t("sidebar.metaAutomation"), icon: Globe2, comingSoon: true },
    { id: DashboardSection.EBAY_AUTOMATION, label: t("sidebar.ebayAutomation"), icon: Workflow, comingSoon: true },
    { id: DashboardSection.AMAZON_AUTOMATION, label: t("sidebar.amazonAutomation"), icon: ShieldCheck, comingSoon: true },
    { id: DashboardSection.ORDERS, label: t("sidebar.orders"), icon: Package },
  ];

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Menüyü kapat"
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-59 px-3 h-full flex flex-col sidebar-bg shrink-0 transform transition-transform duration-300 lg:relative lg:z-20 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
      {/* Brand Logo Section */}
      <div
        className="flex items-center gap-4 px-2 py-6 mb-10 group cursor-pointer"
        onClick={() => {
          onClose?.();
          setView(View.LANDING);
        }}
      >
        <div className="w-10 h-10 bg-indigo-600 rounded-[12px] flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:rotate-6 transition-all border border-indigo-400/30">
          <Rocket className="text-white w-5 h-5" />
        </div>
        <div>
          <span className="text-lg font-black tracking-tight text-white block leading-none">listflow<span className="text-indigo-400">.pro</span></span>
          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-1.5 block">{t("sidebar.premiumSuite")}</span>
        </div>
      </div>

      <nav className="flex-1 space-y-2">
        {menuItems.map((item) => {
          const isActive = dashboardSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setDashboardSection(item.id);
                onClose?.();
              }}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-[18px] transition-all duration-300 relative group cursor-pointer group/coming ${
                isActive 
                  ? 'bg-indigo-600/15 border border-indigo-500/40 text-white' 
                  : 'hover:bg-white/5 text-slate-400 hover:text-white'
              }`}
            >
              <item.icon className={`w-4.5 h-4.5 transition-transform ${isActive ? 'scale-110 text-indigo-400' : 'group-hover:scale-110'}`} />
              <span className="font-bold text-[14px] tracking-tight">{item.label}</span>
              {item.comingSoon && (
                <span className="ml-auto shrink-0 rounded-full border border-amber-500/30 bg-amber-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-900 absolute -right-6 group-hover/coming:opacity-100 opacity-0 transition-all duration-300 z-50">
                  {t("common.comingSoon")}
                </span>
              )}
              {isActive && (
                <motion.div 
                  layoutId="activeSideIndicator"
                  className="absolute right-0 w-1 h-5 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Section */}
      <div className="mt-auto space-y-2 pt-6 border-t border-indigo-500/10">
        <button
          onClick={() => {
            setDashboardSection(DashboardSection.SETTINGS);
            onClose?.();
          }}
          className={`w-full flex items-center gap-4 px-5 py-4 rounded-[18px] transition-all cursor-pointer ${
            dashboardSection === DashboardSection.SETTINGS 
              ? 'bg-indigo-600/15 border border-indigo-500/40 text-white' 
              : 'hover:bg-white/5 text-slate-500 hover:text-white font-bold'
          }`}
        >
          <Settings className="w-4.5 h-4.5" />
          <span className="font-bold text-[14px]">{t("sidebar.settings")}</span>
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-4 px-5 py-4 rounded-[18px] hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all group font-bold cursor-pointer"
        >
          <LogOut className="w-4.5 h-4.5 group-hover:-translate-x-1 transition-transform" />
          <span className="text-[14px]">{t("sidebar.logout")}</span>
        </button>
      </div>
      </div>
    </>
  );
};

export default Sidebar;
