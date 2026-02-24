"use client";

import Link from "next/link";
import { Rocket, Instagram, Linkedin, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

const Footer = () => {
  const { t, locale, setLocale } = useI18n();

  return (
    <footer className="px-6 pb-8 pt-10 bg-[#0a0a0c] border-t border-indigo-500/10">
      <div className="max-w-7xl mx-auto glass-pro rounded-[32px] border border-white/5 p-8 md:p-10">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8 mb-8">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-2xl border border-indigo-400/30">
              <Rocket className="text-white w-5 h-5" />
            </div>
            <div>
              <p className="text-lg font-black tracking-tight text-white">listflow<span className="text-indigo-400">.pro</span></p>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t("footer.rights")}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLocale("tr")}
              className={`px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                locale === "tr"
                  ? "bg-indigo-600 text-white border-indigo-500/40"
                  : "bg-white/5 text-slate-400 border-white/10 hover:text-white"
              }`}
            >
              TR
            </button>
            <button
              type="button"
              onClick={() => setLocale("en")}
              className={`px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                locale === "en"
                  ? "bg-indigo-600 text-white border-indigo-500/40"
                  : "bg-white/5 text-slate-400 border-white/10 hover:text-white"
              }`}
            >
              EN
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
          <div>
            <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">{t("footer.contact")}</h3>
            <a href="mailto:contact@listflow.pro" className="text-sm font-bold text-slate-400 hover:text-white transition-colors">
              contact@listflow.pro
            </a>
          </div>

          <div>
            <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">{t("footer.sitemap")}</h3>
            <div className="flex flex-col gap-2 text-sm font-bold text-slate-400">
              <Link href="/" className="hover:text-white transition-colors">{t("footer.links.home")}</Link>
              <button
                type="button"
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="text-left hover:text-white transition-colors cursor-pointer"
              >
                {t("footer.links.auth")}
              </button>
              <button
                type="button"
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="text-left hover:text-white transition-color cursor-pointer"
              >
                {t("footer.links.dashboard")}
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">{t("footer.policies")}</h3>
            <div className="flex flex-col gap-2 text-sm font-bold text-slate-400">
              <Link href="/policies/privacy" className="hover:text-white transition-colors">
                {t("footer.links.privacy")}
              </Link>
              <Link href="/policies/terms" className="hover:text-white transition-colors">
                {t("footer.links.terms")}
              </Link>
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">{t("footer.follow")}</h3>
            <div className="flex items-center gap-3">
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-indigo-500/30 transition-all flex items-center justify-center"
              >
                <Instagram className="w-4 h-4" />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-indigo-500/30 transition-all flex items-center justify-center"
              >
                <Linkedin className="w-4 h-4" />
              </a>
              <a
                href="https://t.me"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-indigo-500/30 transition-all flex items-center justify-center"
              >
                <Send className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
