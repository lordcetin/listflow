import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import {
  deleteCronTestConfig,
  getCronTestConfigById,
  updateCronTestConfig,
} from "@/lib/webhooks/cron-test";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";

const parseUrl = (value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Webhook URL boş olamaz.");
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

const parseMethod = (value: unknown): "GET" | "POST" | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return "POST" as const;
  }

  return value.toUpperCase() === "GET" ? ("GET" as const) : ("POST" as const);
};

const parseHeaders = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, string>;
  }

  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) continue;

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  const { id } = await params;

  try {
    const existing = await getCronTestConfigById(id);
    if (!existing) {
      return notFoundResponse();
    }

    const body = (await request.json()) as {
      name?: unknown;
      targetUrl?: unknown;
      method?: unknown;
      headers?: unknown;
      enabled?: unknown;
    };

    const patch = {
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      targetUrl: parseUrl(body.targetUrl),
      method: parseMethod(body.method),
      headers: parseHeaders(body.headers),
      enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
    };

    const updated = await updateCronTestConfig(id, patch);
    const cronSync = await syncSchedulerCronJobLifecycle();

    return NextResponse.json({
      row: {
        id: updated.id,
        name: updated.displayName,
        target_url: updated.targetUrl,
        method: updated.method,
        enabled: updated.enabled,
        scope: updated.scope,
        created_at: updated.createdAt,
        updated_at: updated.updatedAt,
      },
      cronSync,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron test webhook güncellenemedi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  const { id } = await params;

  try {
    const existing = await getCronTestConfigById(id);
    if (!existing) {
      return notFoundResponse();
    }

    await deleteCronTestConfig(id);
    const cronSync = await syncSchedulerCronJobLifecycle();
    return NextResponse.json({ success: true, cronSync });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron test webhook silinemedi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
