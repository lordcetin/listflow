"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CreditCard, Loader2, Save, ShieldCheck, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n/provider";

type ProfilePayload = {
  userId: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  role: string | null;
  createdAt: string | null;
};

type SubscriptionPayload = {
  id: string;
  plan: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
  isActive: boolean;
};

type SettingsResponse = {
  profile?: ProfilePayload;
  subscriptions?: SubscriptionPayload[];
  hasActiveSubscription?: boolean;
  error?: string;
};

type ProfileUpdateResponse = {
  profile?: ProfilePayload;
  success?: boolean;
  error?: string;
};

type SubscriptionPortalResponse = {
  url?: string;
  error?: string;
};

type DeleteAccountResponse = {
  success?: boolean;
  error?: string;
};

const SettingsPanel: React.FC = () => {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subscriptions, setSubscriptions] = useState<SubscriptionPayload[]>([]);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isOpeningSubscriptionPortal, setIsOpeningSubscriptionPortal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);

  const planLabel = useCallback(
    (plan: string | null | undefined) => {
      const normalized = (plan ?? "").toLowerCase();
      if (normalized === "standard") return t("dashboard.planStandard");
      if (normalized === "pro") return t("dashboard.planPro");
      if (normalized === "turbo") return t("dashboard.planTurbo");
      return t("settings.planUnknown");
    },
    [t]
  );

  const statusLabel = useCallback(
    (status: string | null | undefined) => {
      const normalized = (status ?? "").toLowerCase();

      if (normalized === "active") return t("settings.statusActive");
      if (normalized === "trialing") return t("settings.statusTrialing");
      if (normalized === "canceled") return t("settings.statusCanceled");
      if (normalized === "past_due") return t("settings.statusPastDue");
      if (normalized === "incomplete") return t("settings.statusIncomplete");
      if (normalized === "incomplete_expired") return t("settings.statusIncompleteExpired");
      if (normalized === "unpaid") return t("settings.statusUnpaid");

      return status ?? t("settings.statusUnknown");
    },
    [t]
  );

  const formatDate = useCallback(
    (value: string | null | undefined) => {
      if (!value) {
        return t("settings.notAvailable");
      }

      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return t("settings.notAvailable");
      }

      return parsed.toLocaleDateString(locale === "en" ? "en-US" : "tr-TR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    },
    [locale, t]
  );

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadingError(null);

    try {
      const response = await fetch("/api/settings/profile", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as SettingsResponse;

      if (!response.ok) {
        throw new Error(payload.error || t("settings.loadFailed"));
      }

      setFullName(payload.profile?.fullName ?? "");
      setEmail(payload.profile?.email ?? "");
      setPhone(payload.profile?.phone ?? "");
      setSubscriptions(payload.subscriptions ?? []);
      setHasActiveSubscription(Boolean(payload.hasActiveSubscription));
    } catch (error) {
      setLoadingError(error instanceof Error ? error.message : t("settings.loadFailed"));
      setSubscriptions([]);
      setHasActiveSubscription(false);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSavingProfile(true);
    setInfoMessage(null);

    try {
      const response = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName,
          email,
          phone,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as ProfileUpdateResponse;
      if (!response.ok) {
        throw new Error(payload.error || t("settings.saveFailed"));
      }

      setFullName(payload.profile?.fullName ?? fullName);
      setEmail(payload.profile?.email ?? email);
      setPhone(payload.profile?.phone ?? phone);
      setInfoMessage(t("settings.saveSuccess"));
    } catch (error) {
      setInfoMessage(error instanceof Error ? error.message : t("settings.saveFailed"));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleOpenSubscriptionPortal = async () => {
    setIsOpeningSubscriptionPortal(true);
    setInfoMessage(null);

    try {
      const response = await fetch("/api/settings/subscription/portal", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as SubscriptionPortalResponse;

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || t("settings.cancelSubscriptionsFailed"));
      }

      window.location.href = payload.url;
    } catch (error) {
      setInfoMessage(error instanceof Error ? error.message : t("settings.cancelSubscriptionsFailed"));
    } finally {
      setIsOpeningSubscriptionPortal(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    setInfoMessage(null);

    try {
      const response = await fetch("/api/settings/account", {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as DeleteAccountResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || t("settings.deleteAccountFailed"));
      }

      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (error) {
      setInfoMessage(error instanceof Error ? error.message : t("settings.deleteAccountFailed"));
      setIsDeletingAccount(false);
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto custom-scrollbar pr-2">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">{t("settings.title")}</h1>
        <p className="text-zinc-500 text-sm font-medium">{t("settings.subtitle")}</p>
      </div>

      {loading ? (
        <div className="p-16 glass rounded-[32px] text-center border-2 border-dashed border-zinc-200 dark:border-white/10">
          <p className="text-zinc-400 font-medium">{t("common.loading")}...</p>
        </div>
      ) : null}

      {!loading && loadingError ? (
        <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm mb-6">
          {loadingError}
        </div>
      ) : null}

      {!loading && infoMessage ? (
        <div className="p-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-200 text-sm mb-6">
          {infoMessage}
        </div>
      ) : null}

      {!loading && !loadingError ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-8">
          <section className="rounded-[28px] glass-card border border-zinc-200 dark:border-white/10 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                <UserRound className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-xl font-black">{t("settings.profileTitle")}</h2>
                <p className="text-xs text-zinc-400">{t("settings.profileDescription")}</p>
              </div>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                  {t("settings.fullName")}
                </label>
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  type="text"
                  className="mt-2 w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                  {t("settings.email")}
                </label>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  className="mt-2 w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                  {t("settings.phone")}
                </label>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  type="tel"
                  className="mt-2 w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={isSavingProfile}
                className="w-full py-3.5 rounded-2xl bg-indigo-600 text-white font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-500/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {isSavingProfile ? `${t("common.loading")}...` : t("settings.saveProfile")}
              </button>
            </form>
          </section>

          <section className="rounded-[28px] glass-card border border-zinc-200 dark:border-white/10 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-xl font-black">{t("settings.subscriptionTitle")}</h2>
                <p className="text-xs text-zinc-400">{t("settings.subscriptionDescription")}</p>
              </div>
            </div>

            <div className="space-y-3 mb-5">
              {subscriptions.length === 0 ? (
                <div className="p-4 rounded-2xl border border-dashed border-zinc-300/60 dark:border-white/10 text-zinc-400 text-sm">
                  {t("settings.noSubscriptions")}
                </div>
              ) : (
                subscriptions.map((subscription) => (
                  <div key={subscription.id} className="p-4 rounded-2xl border border-zinc-300/60 dark:border-white/10 bg-white/40 dark:bg-white/5">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="font-black text-sm">{planLabel(subscription.plan)}</p>
                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
                        {statusLabel(subscription.status)}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400">
                      {t("settings.renewalDate")}: {formatDate(subscription.currentPeriodEnd)}
                    </p>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleOpenSubscriptionPortal()}
              disabled={!hasActiveSubscription || isOpeningSubscriptionPortal}
              className="w-full py-3.5 rounded-2xl border border-amber-500/30 text-amber-200 bg-amber-500/10 font-black text-xs uppercase tracking-widest hover:bg-amber-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isOpeningSubscriptionPortal ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("common.loading")}...
                </span>
              ) : (
                t("settings.cancelSubscriptions")
              )}
            </button>
          </section>

          <section className="rounded-[28px] glass-card border border-zinc-200 dark:border-white/10 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-cyan-300" />
              </div>
              <div>
                <h2 className="text-xl font-black">{t("settings.securityTitle")}</h2>
                <p className="text-xs text-zinc-400">{t("settings.securityDescription")}</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 flex items-center justify-between gap-4">
              <div>
                <p className="font-black text-sm">{t("settings.twoFaTitle")}</p>
                <p className="text-xs text-zinc-300 mt-1">{t("settings.twoFaDescription")}</p>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border border-cyan-300/30 bg-cyan-500/20 text-cyan-200">
                {t("common.comingSoon")}
              </span>
            </div>
          </section>

          <section className="rounded-[28px] glass-card border border-red-500/30 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-300" />
              </div>
              <div>
                <h2 className="text-xl font-black">{t("settings.dangerTitle")}</h2>
                <p className="text-xs text-zinc-400">{t("settings.dangerDescription")}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowDeleteAccountModal(true)}
              className="w-full py-3.5 rounded-2xl bg-red-950/60 text-white/50 hover:text-white font-black text-xs uppercase tracking-widest hover:bg-red-500 transition-all cursor-pointer"
            >
              {t("settings.deleteAccount")}
            </button>
          </section>
        </div>
      ) : null}

      <AnimatePresence>
        {showDeleteAccountModal ? (
          <div className="fixed inset-0 z-[130] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeletingAccount && setShowDeleteAccountModal(false)}
              className="absolute inset-0 bg-black/85 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-lg p-8 rounded-[32px] border border-red-500/30 bg-[#120b0b] shadow-2xl"
            >
              <h3 className="text-2xl font-black text-white mb-2">{t("settings.deleteAccountConfirmTitle")}</h3>
              <p className="text-red-100 text-sm mb-3">{t("settings.deleteAccountConfirmText")}</p>
              <p className="text-red-200/70 text-xs font-bold mb-6">{t("settings.deleteAccountWarning")}</p>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteAccountModal(false)}
                  disabled={isDeletingAccount}
                  className="flex-1 py-3 rounded-xl glass-pro border border-white/10 text-slate-300 font-black text-xs uppercase tracking-widest hover:text-white transition-all cursor-pointer disabled:opacity-60"
                >
                  {t("settings.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteAccount()}
                  disabled={isDeletingAccount}
                  className="flex-1 py-3 rounded-xl bg-red-600/90 text-white font-black text-xs uppercase tracking-widest hover:bg-red-500 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isDeletingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {t("settings.deleteAccountApprove")}
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export default SettingsPanel;
