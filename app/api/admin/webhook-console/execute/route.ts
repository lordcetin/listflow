import { NextRequest, NextResponse } from "next/server";
import { redactObject } from "@/lib/webhooks/redaction";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { persistWebhookConfigProductMap } from "@/lib/webhooks/config-product-map";

const notFoundResponse = () => NextResponse.json({ error: "Not Found" }, { status: 404 });

const requireAdmin = async (request: NextRequest) => {
  const token = getAccessTokenFromRequest(request);
  if (!token) return null;

  const user = await getUserFromAccessToken(token);
  if (!user) return null;

  const profile = await getProfileByUserId(user.id, token);
  if (!profile || !isAdminRole(profile.role)) return null;

  return { user, profile };
};

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  const started = Date.now();

  try {
    const body = (await request.json()) as {
      url?: string;
      method?: "GET" | "POST";
      headers?: Record<string, string>;
      payload?: unknown;
      saveConfig?: boolean;
      configName?: string;
      configDescription?: string;
      configProductId?: string;
    };

    if (!body.url || !body.method) {
      return NextResponse.json({ error: "url and method are required" }, { status: 400 });
    }

    const requestHeaders = body.headers ?? {};
    const response = await fetch(body.url, {
      method: body.method,
      headers: requestHeaders,
      body: body.method === "POST" ? JSON.stringify(body.payload ?? {}) : undefined,
    });

    const responseText = await response.text();
    const duration = Date.now() - started;

    const safeHeaders = redactObject(requestHeaders);
    const safePayload = typeof body.payload === "object" && body.payload !== null
      ? redactObject(body.payload as Record<string, unknown>)
      : body.payload;

    await supabaseAdmin.from("webhook_logs").insert({
      request_url: body.url,
      request_method: body.method,
      request_headers: safeHeaders,
      request_body: safePayload,
      response_status: response.status,
      response_body: responseText,
      duration_ms: duration,
      created_by: admin.user.id,
    });

    let savedConfigId: string | null = null;

    if (body.saveConfig) {
      const name = body.configName?.trim();
      if (!name) {
        return NextResponse.json({ error: "configName is required when saveConfig=true" }, { status: 400 });
      }

      const scope = "automation";
      const configProductId = body.configProductId?.trim() || null;

      if (!configProductId) {
        return NextResponse.json(
          { error: "Automation config kaydı için configProductId zorunlu." },
          { status: 400 }
        );
      }

      const description = body.configDescription?.trim() || null;
      const nowIso = new Date().toISOString();
      const insertPayloads: Array<Record<string, unknown>> = [
        {
          name,
          description,
          target_url: body.url,
          method: body.method,
          headers: safeHeaders,
          enabled: true,
          scope,
          product_id: configProductId,
          updated_at: nowIso,
        },
        {
          name,
          target_url: body.url,
          method: body.method,
          headers: safeHeaders,
          enabled: true,
          scope,
          product_id: configProductId,
          updated_at: nowIso,
        },
        {
          name,
          description,
          target_url: body.url,
          method: body.method,
          headers: safeHeaders,
          enabled: true,
          updated_at: nowIso,
        },
        {
          name,
          target_url: body.url,
          method: body.method,
          headers: safeHeaders,
          enabled: true,
          updated_at: nowIso,
        },
        {
          name,
          target_url: body.url,
          method: body.method,
          headers: safeHeaders,
          enabled: true,
        },
      ];

      let fallbackErrorMessage: string | null = null;
      for (const payload of insertPayloads) {
        const attempt = await supabaseAdmin
          .from("webhook_configs")
          .insert(payload)
          .select("id")
          .maybeSingle<{ id: string }>();

        if (!attempt.error) {
          savedConfigId = attempt.data?.id ?? null;
          fallbackErrorMessage = null;
          break;
        }

        const lowerMessage = (attempt.error.message ?? "").toLowerCase();
        const isMissingColumnError =
          lowerMessage.includes("column") &&
          (lowerMessage.includes("description") ||
            lowerMessage.includes("scope") ||
            lowerMessage.includes("updated_at"));

        if (!isMissingColumnError) {
          return NextResponse.json({ error: attempt.error.message }, { status: 500 });
        }

        fallbackErrorMessage = attempt.error.message;
      }

      if (!savedConfigId && fallbackErrorMessage) {
        return NextResponse.json({ error: fallbackErrorMessage }, { status: 500 });
      }

      if (savedConfigId && configProductId) {
        await persistWebhookConfigProductMap({
          webhookConfigId: savedConfigId,
          productId: configProductId,
          createdBy: admin.user.id,
        });
      }
    }

    return NextResponse.json({
      status: response.status,
      duration,
      body: responseText,
      headers: Object.fromEntries(response.headers.entries()),
      savedConfigId,
    });
  } catch (error) {
    const duration = Date.now() - started;
    const message = error instanceof Error ? error.message : "Webhook request failed";

    await supabaseAdmin.from("webhook_logs").insert({
      request_url: "unknown",
      request_method: "POST",
      request_headers: {},
      request_body: {},
      response_status: 500,
      response_body: message,
      duration_ms: duration,
      created_by: admin.user.id,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
