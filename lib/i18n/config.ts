export const DEFAULT_LOCALE = "tr" as const;

export const SUPPORTED_LOCALES = ["tr", "en"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_COOKIE = "lang" as const;

export const isSupportedLocale = (value: string | null | undefined): value is SupportedLocale => {
  if (!value) {
    return false;
  }

  return SUPPORTED_LOCALES.includes(value as SupportedLocale);
};
