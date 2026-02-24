"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

export default function PrivacyPolicyPage() {
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

        <h1 className="text-3xl font-black tracking-tight">{isEn ? "Privacy Policy" : "Gizlilik Politikası"}</h1>
        <p className="mt-3 text-sm text-slate-300">
          {isEn
            ? "This policy explains how Listflow collects, uses, and protects account and usage data."
            : "Bu politika, Listflow'un hesap ve kullanım verilerini nasıl topladığını, kullandığını ve koruduğunu açıklar."}
        </p>

        <section className="mt-8 space-y-6 text-sm leading-relaxed text-slate-300">
          <div>
            <h2 className="text-lg font-black text-white">{isEn ? "1. Data We Collect" : "1. Toplanan Veriler"}</h2>
            <p>
              {isEn
                ? "We may process profile information (name, email, phone), store setup data, subscription records, payment metadata, and automation logs."
                : "Profil bilgileri (ad, e-posta, telefon), mağaza kurulum verileri, abonelik kayıtları, ödeme metaverileri ve otomasyon logları işlenebilir."}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-black text-white">{isEn ? "2. Purpose of Processing" : "2. İşleme Amaçları"}</h2>
            <p>
              {isEn
                ? "Data is used to provide account access, billing, automation workflows, operational monitoring, and support."
                : "Veriler; hesap erişimi, faturalama, otomasyon iş akışları, operasyon izleme ve destek hizmetleri için kullanılır."}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-black text-white">{isEn ? "3. Data Sharing" : "3. Veri Paylaşımı"}</h2>
            <p>
              {isEn
                ? "Data may be shared with service providers strictly required for product operation (e.g., infrastructure, payment, automation providers)."
                : "Veriler, ürünün çalışması için zorunlu hizmet sağlayıcılarla (ör. altyapı, ödeme, otomasyon sağlayıcıları) sınırlı şekilde paylaşılabilir."}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-black text-white">{isEn ? "4. Security" : "4. Güvenlik"}</h2>
            <p>
              {isEn
                ? "We apply technical and organizational safeguards for access control, data integrity, and secure transport."
                : "Erişim kontrolü, veri bütünlüğü ve güvenli iletim için teknik ve organizasyonel önlemler uygulanır."}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-black text-white">{isEn ? "5. Contact" : "5. İletişim"}</h2>
            <p>
              {isEn
                ? "For privacy requests, contact: contact@listflow.pro"
                : "Gizlilik talepleri için: contact@listflow.pro"}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
