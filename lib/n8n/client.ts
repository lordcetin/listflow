export type N8nPayload = {
  client_id: string;
};

type DispatchN8nTriggerInput = {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, unknown>;
  payload: N8nPayload;
  idempotencyKey: string;
  triggeredAt: string;
};

const normalizeHeaders = (headers: Record<string, unknown> | undefined) => {
  if (!headers || typeof headers !== "object") {
    return {};
  }

  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (!key) {
      continue;
    }

    if (typeof value === "string") {
      normalized[key] = value;
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      normalized[key] = String(value);
    }
  }

  return normalized;
};

export const dispatchN8nTrigger = async ({
  url,
  method = "POST",
  headers,
  payload,
  idempotencyKey,
  triggeredAt,
}: DispatchN8nTriggerInput) => {
  const targetUrl = url.trim();
  if (!targetUrl) {
    throw new Error("Webhook target URL is required.");
  }

  const body = JSON.stringify(payload);
  const safeHeaders = normalizeHeaders(headers);
  const finalMethod = method.toUpperCase() === "GET" ? "GET" : "POST";

  const response = await fetch(targetUrl, {
    method: finalMethod,
    headers: {
      ...(finalMethod === "POST" ? { "Content-Type": "application/json" } : {}),
      ...safeHeaders,
      "x-listflow-idempotency-key": idempotencyKey,
      "x-listflow-triggered-at": triggeredAt,
    },
    body: finalMethod === "POST" ? body : undefined,
  });

  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    body: text,
    url: targetUrl,
    method: finalMethod,
  };
};
