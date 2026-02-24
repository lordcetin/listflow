import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { getCronTestConfigById, triggerCronTestWebhookNow } from "@/lib/webhooks/cron-test";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return notFoundResponse();

  const { id } = await params;

  try {
    const config = await getCronTestConfigById(id);
    if (!config) {
      return notFoundResponse();
    }

    const result = await triggerCronTestWebhookNow(config);
    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      body: result.body,
      durationMs: result.durationMs,
      triggeredAt: result.triggeredAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron test webhook tetiklenemedi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
