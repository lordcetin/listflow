import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { persistWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";

type QueryError = { message?: string; code?: string | null };

type ConfigPatch = {
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

const parsePatch = async (body: ConfigPatch) => {
  const patch: Record<string, unknown> = {};

  if (typeof body.targetUrl === "string") {
    patch.target_url = body.targetUrl.trim();
  }

  if (typeof body.method === "string") {
    patch.method = body.method.trim().toUpperCase() === "GET" ? "GET" : "POST";
  }

  if (body.headers !== undefined) {
    patch.headers = parseHeaders(body.headers);
  }

  if (typeof body.description === "string") {
    patch.description = body.description.trim() || null;
  }

  if (body.enabled !== undefined) {
    patch.enabled = Boolean(body.enabled);
  }

  if (body.productId !== undefined) {
    const nextProductId = typeof body.productId === "string" && body.productId.trim() ? body.productId.trim() : null;
    if (!nextProductId) {
      throw new Error("Alt ürün seçimi zorunlu.");
    }

    patch.product_id = nextProductId;
    patch.name = await resolveProductTitle(nextProductId);
  }

  patch.scope = "automation";
  patch.updated_at = new Date().toISOString();
  return patch;
};

const readCurrentConfig = async (id: string) => {
  const candidates = [
    "id,product_id",
    "id",
  ] as const;

  for (const select of candidates) {
    const { data, error } = await supabaseAdmin.from("webhook_configs").select(select).eq("id", id).maybeSingle();

    if (!error) {
      return data as { id: string; product_id?: string | null } | null;
    }

    if (!isRecoverableColumnError(error)) {
      throw new Error(error.message);
    }
  }

  return null;
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  const { id } = await params;

  try {
    const current = await readCurrentConfig(id);

    if (!current) {
      return notFoundResponse();
    }

    const body = (await request.json()) as ConfigPatch;
    const patch = await parsePatch(body);

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Güncellenecek alan yok." }, { status: 400 });
    }

    const updateCandidates: Array<Record<string, unknown>> = [
      patch,
      Object.fromEntries(
        Object.entries(patch).filter(([key]) => !["description", "scope", "product_id", "name", "updated_at"].includes(key))
      ),
      Object.fromEntries(
        Object.entries(patch).filter(([key]) => !["description", "scope", "product_id", "name"].includes(key))
      ),
    ];

    let lastError: QueryError | null = null;

    for (const candidate of updateCandidates) {
      if (!Object.keys(candidate).length) {
        continue;
      }

      const { data, error } = await supabaseAdmin
        .from("webhook_configs")
        .update(candidate)
        .eq("id", id)
        .select("id")
        .maybeSingle<{ id: string }>();

      if (!error) {
        if (data?.id && typeof patch.product_id === "string" && patch.product_id.trim()) {
          await persistWebhookConfigProductMap({
            webhookConfigId: data.id,
            productId: patch.product_id,
            createdBy: admin.user.id,
          });
        }
        const cronSync = {
          ok: true as const,
          status: "noop" as const,
          message: "Webhook güncellendi. Cron sync otomatik tetiklenmedi (rate-limit koruması).",
        };
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

    return NextResponse.json({ error: lastError?.message || "Config update failed" }, { status: 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Config update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  const { id } = await params;

  const { error } = await supabaseAdmin.from("webhook_configs").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cronSync = {
    ok: true as const,
    status: "noop" as const,
    message: "Webhook silindi. Cron sync otomatik tetiklenmedi (rate-limit koruması).",
  };
  return NextResponse.json({ success: true, cronSync });
}
