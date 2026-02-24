import { supabaseAdmin } from "@/lib/supabase/admin";

type CatalogFallbackPayload = {
  catalogDescription: string | null;
  catalogYoutubeUrl: string | null;
};

const CATALOG_FALLBACK_METHOD = "PRODUCT_CATALOG";
const CATALOG_FALLBACK_URL_PREFIX = "catalog-product:";

const toRequestUrl = (productId: string) => `${CATALOG_FALLBACK_URL_PREFIX}${productId}`;

const isMissingSchemaError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  if (error.code === "42P01" || error.code === "42703") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("column") && message.includes("does not exist")) ||
    message.includes("could not find the table")
  );
};

const normalizeNullableString = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const parseFallbackBody = (value: unknown): CatalogFallbackPayload => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      catalogDescription: null,
      catalogYoutubeUrl: null,
    };
  }

  const row = value as Record<string, unknown>;

  return {
    catalogDescription: normalizeNullableString(row.catalog_description),
    catalogYoutubeUrl: normalizeNullableString(row.catalog_youtube_url),
  };
};

const toUniqueIds = (productIds: string[]) => Array.from(new Set(productIds.filter((id) => id && id.trim())));

const chunk = <T,>(rows: T[], size: number) => {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
};

export const loadCatalogFallbackMap = async (productIds: string[]) => {
  const ids = toUniqueIds(productIds);
  const map = new Map<string, CatalogFallbackPayload>();

  if (!ids.length) {
    return map;
  }

  for (const batch of chunk(ids, 100)) {
    const requestUrls = batch.map(toRequestUrl);
    const { data, error } = await supabaseAdmin
      .from("webhook_logs")
      .select("request_url, request_body, created_at")
      .eq("request_method", CATALOG_FALLBACK_METHOD)
      .in("request_url", requestUrls)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingSchemaError(error)) {
        return new Map<string, CatalogFallbackPayload>();
      }

      throw new Error(error.message);
    }

    for (const row of (data ?? []) as Array<{
      request_url?: string | null;
      request_body?: unknown;
    }>) {
      const requestUrl = row.request_url ?? "";
      if (!requestUrl.startsWith(CATALOG_FALLBACK_URL_PREFIX)) {
        continue;
      }

      const productId = requestUrl.slice(CATALOG_FALLBACK_URL_PREFIX.length).trim();
      if (!productId || map.has(productId)) {
        continue;
      }

      map.set(productId, parseFallbackBody(row.request_body));
    }
  }

  return map;
};

export const writeCatalogFallback = async (args: {
  productId: string;
  catalogDescription: string | null;
  catalogYoutubeUrl: string | null;
  createdBy: string;
}) => {
  const payload = {
    product_id: args.productId,
    catalog_description: args.catalogDescription,
    catalog_youtube_url: args.catalogYoutubeUrl,
    source: "catalog_endpoint_fallback",
    saved_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("webhook_logs").insert({
    request_url: toRequestUrl(args.productId),
    request_method: CATALOG_FALLBACK_METHOD,
    request_headers: {},
    request_body: payload,
    response_status: 200,
    response_body: "fallback_saved",
    duration_ms: 0,
    created_by: args.createdBy,
  });

  if (!error) {
    return { ok: true as const };
  }

  if (isMissingSchemaError(error)) {
    return { ok: false as const, error: "Fallback storage table is missing required columns." };
  }

  return { ok: false as const, error: error.message };
};

