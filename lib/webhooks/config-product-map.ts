import { supabaseAdmin } from "@/lib/supabase/admin";

const WEBHOOK_CONFIG_PRODUCT_MAP_METHOD = "WEBHOOK_CONFIG_PRODUCT_MAP";
const WEBHOOK_CONFIG_PRODUCT_MAP_URL = "webhook-config-product-map";

const isSchemaCompatibilityError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  if (error.code === "42P01" || error.code === "42703") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("schema cache") ||
    message.includes("failed to parse") ||
    message.includes("column") ||
    message.includes("relation") ||
    message.includes("could not find the table")
  );
};

const parseMappingFromBody = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  const webhookConfigId =
    typeof row.webhook_config_id === "string" ? row.webhook_config_id.trim() : "";
  const productId =
    typeof row.product_id === "string" ? row.product_id.trim() : "";

  if (!webhookConfigId || !productId) {
    return null;
  }

  return { webhookConfigId, productId };
};

export const loadWebhookConfigProductMap = async (configIds?: string[]) => {
  const map = new Map<string, string>();
  const allowedIds = configIds?.length ? new Set(configIds) : null;

  const { data, error } = await supabaseAdmin
    .from("webhook_logs")
    .select("request_body,created_at")
    .eq("request_method", WEBHOOK_CONFIG_PRODUCT_MAP_METHOD)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    if (isSchemaCompatibilityError(error)) {
      return map;
    }

    throw new Error(error.message);
  }

  for (const row of (data ?? []) as Array<{ request_body?: unknown }>) {
    const parsed = parseMappingFromBody(row.request_body);
    if (!parsed) {
      continue;
    }

    if (allowedIds && !allowedIds.has(parsed.webhookConfigId)) {
      continue;
    }

    if (!map.has(parsed.webhookConfigId)) {
      map.set(parsed.webhookConfigId, parsed.productId);
    }
  }

  return map;
};

export const persistWebhookConfigProductMap = async (args: {
  webhookConfigId: string;
  productId: string;
  createdBy?: string | null;
}) => {
  const payload = {
    webhook_config_id: args.webhookConfigId,
    product_id: args.productId,
    saved_at: new Date().toISOString(),
  };

  const candidates: Array<Record<string, unknown>> = [
    {
      request_url: WEBHOOK_CONFIG_PRODUCT_MAP_URL,
      request_method: WEBHOOK_CONFIG_PRODUCT_MAP_METHOD,
      request_headers: {},
      request_body: payload,
      response_status: 200,
      response_body: "mapping_saved",
      duration_ms: 0,
      created_by: args.createdBy ?? null,
    },
    {
      request_url: WEBHOOK_CONFIG_PRODUCT_MAP_URL,
      request_method: WEBHOOK_CONFIG_PRODUCT_MAP_METHOD,
      request_body: payload,
    },
  ];

  for (const candidate of candidates) {
    const { error } = await supabaseAdmin.from("webhook_logs").insert(candidate);

    if (!error) {
      return;
    }

    if (!isSchemaCompatibilityError(error)) {
      throw new Error(error.message);
    }
  }
};

