import { DEFAULT_LOCALE, LOCALE_COOKIE, type SupportedLocale, isSupportedLocale } from "@/lib/i18n/config";

const GEO_HEADERS = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "x-country-code",
  "x-geo-country",
] as const;

type CookieLike = {
  get: (name: string) => { value: string } | undefined;
};

type HeaderLike = {
  get: (name: string) => string | null;
};

const localeFromCountry = (country: string | null): SupportedLocale | null => {
  if (!country) {
    return null;
  }

  if (country.toUpperCase() === "TR") {
    return "tr";
  }

  return "en";
};

const localeFromAcceptLanguage = (acceptLanguage: string | null): SupportedLocale | null => {
  if (!acceptLanguage) {
    return null;
  }

  const lower = acceptLanguage.toLowerCase();

  if (lower.includes("tr")) {
    return "tr";
  }

  if (lower.includes("en")) {
    return "en";
  }

  return null;
};

export const detectLocale = (cookiesStore: CookieLike, headersStore: HeaderLike): SupportedLocale => {
  const cookieLocale = cookiesStore.get(LOCALE_COOKIE)?.value;

  if (isSupportedLocale(cookieLocale)) {
    return cookieLocale;
  }

  for (const geoHeader of GEO_HEADERS) {
    const locale = localeFromCountry(headersStore.get(geoHeader));

    if (locale) {
      return locale;
    }
  }

  const acceptLocale = localeFromAcceptLanguage(headersStore.get("accept-language"));

  if (acceptLocale) {
    return acceptLocale;
  }

  return DEFAULT_LOCALE;
};

export const normalizeLocale = (value: string | null | undefined): SupportedLocale => {
  if (isSupportedLocale(value)) {
    return value;
  }

  return DEFAULT_LOCALE;
};
