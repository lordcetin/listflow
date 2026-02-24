"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Rocket, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';

type VerifyState = 'loading' | 'ready' | 'error';

const PaymentSuccess: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<VerifyState>('loading');

  const sessionId = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    return new URLSearchParams(window.location.search).get('session_id');
  }, []);

  useEffect(() => {
    let mounted = true;

    const verify = async () => {
      if (!sessionId) {
        if (mounted) {
          setState('error');
        }
        return;
      }

      for (let i = 0; i < 8; i += 1) {
        const response = await fetch('/api/billing/verify-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });

        const payload = await response.json();

        if (response.ok && payload?.isActive) {
          if (mounted) {
            setState('ready');
          }
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      if (mounted) {
        setState('error');
      }
    };

    void verify();

    return () => {
      mounted = false;
    };
  }, [sessionId]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0a0c] p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full p-10 rounded-[48px] glass-card-pro border border-emerald-500/20 text-center shadow-2xl"
      >
        <div className="w-24 h-24 bg-emerald-500/10 rounded-[32px] flex items-center justify-center mx-auto mb-8 border border-emerald-500/20 shadow-[0_0_40px_rgba(16,185,129,0.1)]">
          {state === 'loading' && <Loader2 className="w-12 h-12 text-emerald-400 animate-spin" />}
          {state === 'ready' && <CheckCircle2 className="w-12 h-12 text-emerald-400" />}
          {state === 'error' && <AlertCircle className="w-12 h-12 text-red-400" />}
        </div>

        {state === 'ready' && <h1 className="text-3xl font-black text-white tracking-tight mb-4">{t('payment.title')}</h1>}
        {state === 'loading' && <h1 className="text-3xl font-black text-white tracking-tight mb-4">{t('payment.waitingSync')}</h1>}
        {state === 'error' && <h1 className="text-3xl font-black text-white tracking-tight mb-4">{t('payment.syncFailed')}</h1>}

        <p className="text-slate-400 font-medium mb-10 leading-relaxed">
          {state === 'ready' ? t('payment.subtitle') : t('payment.waitingSync')}
        </p>

        <div className="space-y-4">
          <button
            onClick={() => {
              window.location.href = '/';
            }}
            className="w-full py-5 rounded-2xl bg-indigo-600 text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-indigo-500/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 cursor-pointer"
          >
            {t('payment.backToPanel')} <ArrowRight className="w-5 h-5" />
          </button>

          <div className="flex items-center justify-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
            <Rocket className="w-3 h-3 text-indigo-400" /> listflow.pro Premium
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default PaymentSuccess;
