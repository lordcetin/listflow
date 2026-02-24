"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AnimatePresence } from "framer-motion";
import LandingPage from "@/components/LandingPage";
import AuthPage from "@/components/AuthPage";
import Dashboard from "@/components/Dashboard/Dashboard";
import Footer from "@/components/Footer";
import CrispChat from "@/components/CrispChat";
import { useI18n } from "@/lib/i18n/provider";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabaseClient";
import { useStore } from "@/store";
import { View } from "@/types";

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

export default function Home() {
  const { currentView, setView } = useStore();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          throw new Error("CONFIG_ERROR");
        }

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        await syncServerSession(session);

        if (session) {
          setView(View.DASHBOARD);
        } else if (useStore.getState().currentView === View.DASHBOARD) {
          setView(View.AUTH);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

        if (message === "CONFIG_ERROR") {
          setInitError(t("app.configError"));
        } else if (message === "Failed to fetch" || message.toLowerCase().includes("fetch")) {
          setInitError(t("app.networkError"));
        } else {
          setInitError(message);
        }
      } finally {
        setLoading(false);
      }
    };

    void initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await syncServerSession(session);

      if (session) {
        setView(View.DASHBOARD);
      } else if (useStore.getState().currentView === View.DASHBOARD) {
        setView(View.AUTH);
      }
    });

    return () => subscription.unsubscribe();
  }, [setView, t]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0c]">
        <div className="flex flex-col items-center gap-6">
          <div className="w-12 h-12 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin shadow-[0_0_15px_rgba(99,102,241,0.2)]"></div>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">{t("app.loadingLabel")}</p>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0c] p-6 text-white text-center">
        <div className="max-w-md w-full p-10 rounded-[40px] glass-card-pro border border-red-500/20 shadow-2xl">
          <h2 className="text-xl font-black mb-4 text-red-400">{t("app.startupErrorTitle")}</h2>
          <p className="text-slate-400 text-sm mb-8 leading-relaxed font-medium">{initError}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-4 rounded-2xl bg-white text-black font-black text-xs uppercase tracking-widest hover:scale-[1.02] transition-all cursor-pointer"
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }


  return (
    <>
    <div className="min-h-screen bg-[#0a0a0c]">
      <AnimatePresence mode="wait">
        {currentView === View.LANDING && <LandingPage key="landing" />}
        {currentView === View.AUTH && <AuthPage key="auth" />}
        {currentView === View.DASHBOARD && <Dashboard key="dashboard" />}
      </AnimatePresence>
      {currentView === View.DASHBOARD ? <CrispChat /> : null}

      {currentView !== View.DASHBOARD && <Footer />}
    </div>
    </>
  );
}
