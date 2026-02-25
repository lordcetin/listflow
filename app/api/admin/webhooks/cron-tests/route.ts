import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import {
  createCronTestConfig,
  CRON_TEST_INTERVAL_MS,
  loadCronTestConfigs,
  loadCronTestLatestRuns,
} from "@/lib/webhooks/cron-test";

const parseUrl = (value: unknown) => {
  if (typeof value !== "string") {
    throw new Error("Webhook URL zorunlu.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Webhook URL zorunlu.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Webhook URL formatı geçersiz.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Webhook URL sadece http/https olabilir.");
  }

  return parsed.toString();
};

const parseMethod = (value: unknown) => {
  if (typeof value !== "string") {
    return "POST" as const;
  }

  return value.toUpperCase() === "GET" ? "GET" : "POST";
};

const parseHeaders = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, string>;
  }

  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) {
      continue;
    }

    if (typeof raw === "string") {
      headers[key] = raw;
      continue;
    }

    if (typeof raw === "number" || typeof raw === "boolean") {
      headers[key] = String(raw);
    }
  }

  return headers;
};

const toTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  try {
    const [configs, latestRuns] = await Promise.all([loadCronTestConfigs(), loadCronTestLatestRuns()]);
    const nowMs = Date.now();

    const rows = configs.map((config) => {
      const latestRun = latestRuns.get(config.id) ?? null;
      const latestRunMs = toTimestamp(latestRun?.createdAt ?? null);
      const nextRunAt =
        latestRunMs !== null ? new Date(latestRunMs + CRON_TEST_INTERVAL_MS).toISOString() : new Date(nowMs).toISOString();

      return {
        id: config.id,
        name: config.displayName,
        target_url: config.targetUrl,
        method: config.method,
        enabled: config.enabled,
        scope: config.scope,
        created_at: config.createdAt,
        updated_at: config.updatedAt,
        last_run_at: latestRun?.createdAt ?? null,
        last_response_status: latestRun?.responseStatus ?? null,
        last_response_body: latestRun?.responseBody ?? null,
        next_run_at: nextRunAt,
      };
    });

    return NextResponse.json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron test webhook listesi yüklenemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  try {
    const body = (await request.json()) as {
      name?: unknown;
      targetUrl?: unknown;
      method?: unknown;
      headers?: unknown;
      enabled?: unknown;
    };

    const targetUrl = parseUrl(body.targetUrl);
    const method = parseMethod(body.method);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Webhook";
    const headers = parseHeaders(body.headers);
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

    const row = await createCronTestConfig({
      name,
      targetUrl,
      method,
      headers,
      enabled,
    });
    const cronSync = {
      ok: true as const,
      status: "noop" as const,
      message: "Cron test webhook kaydedildi. Ana cron sync değişmedi.",
    };

    return NextResponse.json({
      row: {
        id: row.id,
        name: row.displayName,
        target_url: row.targetUrl,
        method: row.method,
        enabled: row.enabled,
        scope: row.scope,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      },
      cronSync,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron test webhook oluşturulamadı.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
