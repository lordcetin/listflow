import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { loadDirectAutomationCronJobs } from "@/lib/cron-job-org/client";

const isRateLimitError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("429") || message.includes("rate limit");
};

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const rows = await loadDirectAutomationCronJobs();
    return NextResponse.json({ rows });
  } catch (error) {
    if (isRateLimitError(error)) {
      return NextResponse.json({
        rows: [],
        rateLimited: true,
        message: "cron-job.org rate limit nedeniyle direct cron listesi geçici olarak güncellenemedi.",
      });
    }

    const message = error instanceof Error ? error.message : "Direct cron job listesi yüklenemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
