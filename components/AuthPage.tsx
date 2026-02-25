"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store';
import { View } from '../types';
import { supabase } from '../lib/supabaseClient';
import { Rocket, Mail, Lock, ArrowLeft, User, AlertCircle, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { buildOAuthRedirectTo } from '@/lib/auth/oauth-client';

const AuthPage: React.FC = () => {
  const { setView } = useStore();
  const { t, locale } = useI18n();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  const validateEmail = (value: string) => {
    return String(value)
      .toLowerCase()
      .match(/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/);
  };

  const bootstrapProfile = async (accessToken: string, name?: string) => {
    await fetch('/api/auth/bootstrap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        fullName: name,
        locale,
      }),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) {
      return;
    }

    setError(null);
    const cleanEmail = email.trim();
    const cleanFullName = fullName.trim();

    if (!validateEmail(cleanEmail)) {
      setError({ message: t('auth.validationEmail'), type: 'error' });
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signInError) {
          throw signInError;
        }

        if (data.session?.access_token) {
          await bootstrapProfile(data.session.access_token);
          setView(View.DASHBOARD);
        }
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: cleanFullName,
              display_name: cleanFullName,
            },
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        if (data.session?.access_token) {
          await bootstrapProfile(data.session.access_token, cleanFullName);
          setView(View.DASHBOARD);
          return;
        }

        setError({
          message: t('auth.signupSuccess'),
          type: 'success',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('auth.genericError');
      const formatted = message.toLowerCase().includes('rate limit') ? t('auth.rateLimit') : message;
      setError({ message: formatted, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleOAuth = async () => {
    setLoading(true);
    setError(null);

    try {
      const redirectTo = buildOAuthRedirectTo('/auth/callback');
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });

      if (oauthError) {
        throw oauthError;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('auth.genericError');
      setError({ message, type: 'error' });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12 relative overflow-hidden bg-[#0a0a0c]">
      <button
        onClick={() => setView(View.LANDING)}
        className="absolute top-4 left-4 sm:top-8 sm:left-8 p-3 rounded-full glass hover:bg-white/10 transition-all text-slate-500 hover:text-white z-50 border border-white/5 cursor-pointer"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md p-6 sm:p-10 rounded-[32px] sm:rounded-[40px] glass-card-pro shadow-2xl relative z-10"
      >
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-2xl border border-indigo-400/30">
            <Rocket className="text-white w-8 h-8" />
          </div>
          <h2 className="text-3xl font-black tracking-tight mb-2 text-white">
            {isLogin ? t('auth.welcome') : t('auth.createAccount')}
          </h2>
        </div>

        {error && (
          <div
            className={`mb-6 p-4 rounded-2xl border text-sm flex items-start gap-3 ${
              error.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error.message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {!isLogin && (
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">{t('auth.name')}</label>
              <div className="relative">
                <User className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Mert Demir"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">{t('auth.email')}</label>
            <div className="relative">
              <Mail className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="ornek@mail.com"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">{t('auth.password')}</label>
            <div className="relative">
              <Lock className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-black text-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-3 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : isLogin ? (
              t('auth.submitLogin')
            ) : (
              t('auth.submitSignup')
            )}
          </button>

          <button
            type="button"
            onClick={handleGoogleOAuth}
            disabled={loading}
            className="w-full py-4 rounded-2xl glass border border-white/10 text-white font-black text-sm uppercase tracking-widest hover:bg-white/5 transition-all disabled:opacity-50 cursor-pointer"
          >
            {t('auth.google')}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button onClick={() => setIsLogin(!isLogin)} className="text-slate-500 hover:text-indigo-400 text-sm font-bold uppercase tracking-wider cursor-pointer">
            {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default AuthPage;
