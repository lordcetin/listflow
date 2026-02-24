import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";

type QueryError = { message?: string; code?: string | null };

const isMissingColumn = (error: QueryError | null | undefined, column: string) => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const asTrimmedStringOrNull = (value: unknown) => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  const { id: storeId } = await params;

  try {
    const body = (await request.json().catch(() => ({}))) as { productId?: unknown };
    const productId = asTrimmedStringOrNull(body.productId);

    const storeQuery = await supabaseAdmin
      .from("stores")
      .select("id, product_id, active_webhook_config_id")
      .eq("id", storeId)
      .maybeSingle<{ id: string; product_id?: string | null; active_webhook_config_id?: string | null }>();

    if (storeQuery.error) {
      if (isMissingColumn(storeQuery.error, "product_id") || isMissingColumn(storeQuery.error, "active_webhook_config_id")) {
        return NextResponse.json(
          { error: "stores.product_id / stores.active_webhook_config_id kolonları eksik. Migration çalıştırın." },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: storeQuery.error.message }, { status: 500 });
    }

    if (!storeQuery.data) {
      return notFoundResponse();
    }

    if (productId) {
      const productExists = await supabaseAdmin.from("products").select("id").eq("id", productId).maybeSingle<{ id: string }>();

      if (productExists.error) {
        return NextResponse.json({ error: productExists.error.message }, { status: 500 });
      }

      if (!productExists.data) {
        return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
      }
    }

    let nextWebhookConfigId: string | null = null;

    if (productId) {
      const webhookRows = await supabaseAdmin
        .from("webhook_configs")
        .select("id")
        .eq("enabled", true)
        .eq("scope", "automation")
        .eq("product_id", productId)
        .order("updated_at", { ascending: false })
        .limit(2);

      if (webhookRows.error) {
        if (isMissingColumn(webhookRows.error, "product_id") || isMissingColumn(webhookRows.error, "scope")) {
          return NextResponse.json(
            { error: "webhook_configs.product_id / webhook_configs.scope kolonları eksik. Migration çalıştırın." },
            { status: 400 }
          );
        }

        return NextResponse.json({ error: webhookRows.error.message }, { status: 500 });
      }

      if ((webhookRows.data ?? []).length === 1) {
        nextWebhookConfigId = webhookRows.data?.[0]?.id ?? null;
      }
    }

    const updatePayload: Record<string, unknown> = {
      product_id: productId,
      updated_at: new Date().toISOString(),
    };

    if (productId) {
      updatePayload.active_webhook_config_id = nextWebhookConfigId;
    } else {
      updatePayload.active_webhook_config_id = null;
    }

    const withAudit = {
      ...updatePayload,
      automation_updated_at: new Date().toISOString(),
      automation_updated_by: admin.user.id,
    };

    const update = await supabaseAdmin
      .from("stores")
      .update(withAudit)
      .eq("id", storeId)
      .select("id, product_id, active_webhook_config_id, automation_updated_at")
      .maybeSingle();

    if (update.error) {
      if (isMissingColumn(update.error, "automation_updated_at") || isMissingColumn(update.error, "automation_updated_by")) {
        const fallback = await supabaseAdmin
          .from("stores")
          .update(updatePayload)
          .eq("id", storeId)
          .select("id, product_id, active_webhook_config_id")
          .maybeSingle();

        if (fallback.error) {
          return NextResponse.json({ error: fallback.error.message }, { status: 500 });
        }

        return NextResponse.json({ row: fallback.data, warning: "automation audit kolonları eksik" });
      }

      return NextResponse.json({ error: update.error.message }, { status: 500 });
    }

    return NextResponse.json({
      row: update.data,
      autoWebhookLinked: Boolean(nextWebhookConfigId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store product bind failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
