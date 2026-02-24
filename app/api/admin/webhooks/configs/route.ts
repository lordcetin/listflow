import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { persistWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";

type QueryError = { message?: string; code?: string | null };

type ConfigPayload = {
  name?: unknown;
  targetUrl?: unknown;
  method?: unknown;
  headers?: unknown;
  description?: unknown;
  enabled?: unknown;
  productId?: unknown;
};

const isRecoverableColumnError = (error: QueryError | null | undefined) => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("failed to parse") ||
    message.includes("does not exist")
  );
};

const parseMethod = (value: unknown) => {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "POST";
  return normalized === "GET" ? "GET" : "POST";
};

const parseHeaders = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) continue;
    if (typeof raw === "string") {
      next[key] = raw;
      continue;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      next[key] = String(raw);
    }
  }
  return next;
};

const resolveProductTitle = async (productId: string) => {
  const candidates = [
    "id,title_tr,title_en",
    "id,title_tr",
    "id,title",
  ] as const;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select(select)
      .eq("id", productId)
      .maybeSingle();

    if (!error) {
      if (!data) {
        throw new Error("Seçilen alt ürün bulunamadı.");
      }

      const row = data as { title_tr?: string | null; title_en?: string | null; title?: string | null };
      const title = row.title_tr?.trim() || row.title_en?.trim() || row.title?.trim();
      if (!title) {
        throw new Error("Seçilen alt ürünün başlığı bulunamadı.");
      }
      return title;
    }

    if (!isRecoverableColumnError(error)) {
      throw new Error(error.message);
    }
  }

  throw new Error("Alt ürün başlığı çözümlenemedi.");
};

const parseBody = async (raw: ConfigPayload) => {
  const targetUrl = typeof raw.targetUrl === "string" ? raw.targetUrl.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const productId = typeof raw.productId === "string" && raw.productId.trim() ? raw.productId.trim() : null;

  if (!targetUrl) {
    throw new Error("targetUrl is required");
  }

  if (!productId) {
    throw new Error("Alt ürün seçimi zorunlu.");
  }

  const derivedTitle = await resolveProductTitle(productId);
  const manualName = typeof raw.name === "string" ? raw.name.trim() : "";

  return {
    name: manualName || derivedTitle,
    target_url: targetUrl,
    method: parseMethod(raw.method),
    headers: parseHeaders(raw.headers),
    description: description || null,
    scope: "automation" as const,
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    product_id: productId,
  };
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  const candidates = [
    { select: "id,name,description,scope,target_url,method,headers,enabled,product_id,created_at,updated_at", hasScope: true },
    { select: "id,name,description,scope,target_url,method,headers,enabled,created_at,updated_at", hasScope: true },
    { select: "id,name,target_url,method,headers,enabled,product_id,created_at,updated_at", hasScope: false },
    { select: "id,name,target_url,method,headers,enabled,created_at,updated_at", hasScope: false },
  ] as const;

  for (const candidate of candidates) {
    let query = supabaseAdmin
      .from("webhook_configs")
      .select(candidate.select)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (candidate.hasScope) {
      query = query.eq("scope", "automation");
    }

    const { data, error } = await query;

    if (!error) {
      return NextResponse.json({ rows: data ?? [] });
    }

    if (!isRecoverableColumnError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ rows: [] });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  try {
    const body = (await request.json()) as ConfigPayload;
    const payload = await parseBody(body);

    const nowIso = new Date().toISOString();
    const insertCandidates: Array<Record<string, unknown>> = [
      {
        ...payload,
        updated_at: nowIso,
      },
      {
        name: payload.name,
        target_url: payload.target_url,
        method: payload.method,
        headers: payload.headers,
        enabled: payload.enabled,
        scope: payload.scope,
        product_id: payload.product_id,
      },
      {
        name: payload.name,
        target_url: payload.target_url,
        method: payload.method,
        headers: payload.headers,
        enabled: payload.enabled,
        scope: payload.scope,
        updated_at: nowIso,
      },
      {
        name: payload.name,
        target_url: payload.target_url,
        method: payload.method,
        headers: payload.headers,
        enabled: payload.enabled,
        scope: payload.scope,
      },
      {
        name: payload.name,
        target_url: payload.target_url,
        method: payload.method,
        headers: payload.headers,
        enabled: payload.enabled,
        updated_at: nowIso,
      },
      {
        name: payload.name,
        target_url: payload.target_url,
        method: payload.method,
        headers: payload.headers,
        enabled: payload.enabled,
      },
    ];

    let lastError: QueryError | null = null;

    for (const candidate of insertCandidates) {
      const { data, error } = await supabaseAdmin
        .from("webhook_configs")
        .insert(candidate)
        .select("id")
        .maybeSingle<{ id: string }>();

      if (!error) {
        if (data?.id) {
          await persistWebhookConfigProductMap({
            webhookConfigId: data.id,
            productId: payload.product_id,
            createdBy: admin.user.id,
          });
        }
        const cronSync = await syncSchedulerCronJobLifecycle();
        return NextResponse.json({ row: data, cronSync });
      }

      if (error.code === "23505") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }

      lastError = error;

      if (!isRecoverableColumnError(error)) {
        break;
      }
    }

    return NextResponse.json({ error: lastError?.message || "Config create failed" }, { status: 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Config create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
