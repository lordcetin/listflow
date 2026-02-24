"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, type SupportedLocale } from "@/lib/i18n/config";
import { trMessages } from "@/lib/i18n/messages/tr";
import { enMessages } from "@/lib/i18n/messages/en";

type Dictionary = typeof trMessages;

type I18nContextValue = {
  locale: SupportedLocale;
  messages: Dictionary;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string) => string;
};

const dictionaries: Record<SupportedLocale, Dictionary> = {
  tr: trMessages,
  en: enMessages,
};

const I18nContext = createContext<I18nContextValue | null>(null);

const resolveKey = (messages: Dictionary, key: string): unknown => {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null || !(part in acc)) {
      return undefined;
    }

    return (acc as Record<string, unknown>)[part];
  }, messages);
};

export const I18nProvider = ({
  locale,
  children,
}: {
  locale: SupportedLocale;
  children: React.ReactNode;
}) => {
  const value = useMemo<I18nContextValue>(() => {
    const selectedLocale = locale ?? DEFAULT_LOCALE;
    const messages = dictionaries[selectedLocale] ?? dictionaries[DEFAULT_LOCALE];

    return {
      locale: selectedLocale,
      messages,
      setLocale: (nextLocale) => {
        document.cookie = `${LOCALE_COOKIE}=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`;
        window.location.reload();
      },
      t: (key) => {
        const result = resolveKey(messages, key);

        if (typeof result === "string") {
          return result;
        }

        return key;
      },
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return context;
};
