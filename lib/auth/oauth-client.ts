import { clientEnv } from "@/lib/env/client";

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const withLeadingSlash = (value: string) => (value.startsWith("/") ? value : `/${value}`);

const resolveBrowserOrigin = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const origin = window.location.origin?.trim();
  if (!origin) {
    return null;
  }

  return stripTrailingSlash(origin);
};

export const resolveOAuthBaseUrl = () => {
  const configured = clientEnv.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    return stripTrailingSlash(configured);
  }

  return resolveBrowserOrigin();
};

export const buildOAuthRedirectTo = (path: string) => {
  const baseUrl = resolveOAuthBaseUrl();
  if (!baseUrl) {
    throw new Error("OAuth redirect base URL could not be resolved.");
  }

  return `${baseUrl}${withLeadingSlash(path)}`;
};
