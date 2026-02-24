"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

export default function TermsPage() {
  const { locale } = useI18n();
  const isEn = locale === "en";

  return (
    <main className="min-h-screen bg-[#0a0a0c] px-6 py-12 text-white md:px-10">
      <div className="mx-auto max-w-4xl rounded-[32px] border border-white/10 bg-white/5 p-6 md:p-10">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          listflow.pro
        </Link>

        <h1 className="text-3xl font-black tracking-tight">{isEn ? "Terms of Service" : "Kullanım Şartları"}</h1>
        <p className="mt-3 text-sm text-slate-300">
          {isEn
            ? "These terms govern your use of the Listflow platform and related services."
            : "Bu şartlar, Listflow platformu ve ilgili hizmetlerin kullanımını düzenler."}
        </p>

        <section className="mt-8 space-y-6 text-sm leading-relaxed text-slate-300">
          <div>
            <h2 className="text-lg font-black text-white">{isEn ? "1. Service Scope" : "1. Hizmet Kapsamı"}</h2>
            <p>
              {isEn
                ? "Listflow provides automation and management tools for connected stores. Features may evolve over time."
                : "Listflow, bağlı mağazalar için otomasyon ve yönetim araçları sunar. Özellikler zaman içinde güncellenebilir."}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-black text-white">{isEn ? "2. Account Responsibility" : "2. Hesap Sorumluluğu"}</h2>
            <p>
              {isEn
                ? "Users are responsible for account security, credential protection, and actions taken through their account."
                : "Kullanıcılar hesap güvenliğinden, kimlik bilgilerinin korunmasından ve hesap üzerinden yapılan işlemlerden sorumludur."}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-black text-white">{isEn ? "3. Billing and Subscription" : "3. Faturalama ve Abonelik"}</h2>
            <p>
              {isEn
                ? "Subscription and payment operations are processed through integrated billing providers. Plan changes and cancellations follow active billing rules."
                : "Abonelik ve ödeme işlemleri entegre faturalama sağlayıcıları üzerinden yürütülür. Plan değişikliği ve iptal süreçleri aktif faturalama kurallarına tabidir."}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-black text-white">{isEn ? "4. Acceptable Use" : "4. Kabul Edilebilir Kullanım"}</h2>
            <p>
              {isEn
                ? "The platform may not be used for illegal, abusive, or harmful activity. Misuse may result in access restrictions."
                : "Platform; yasa dışı, kötüye kullanım veya zararlı faaliyetler için kullanılamaz. Kötüye kullanım durumunda erişim kısıtlanabilir."}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-black text-white">{isEn ? "5. Support Contact" : "5. Destek İletişimi"}</h2>
            <p>
              {isEn
                ? "For service and contract questions: contact@listflow.pro"
                : "Hizmet ve sözleşme soruları için: contact@listflow.pro"}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
