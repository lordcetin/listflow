import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";

const isRateLimitResult = (result: { message?: string; details?: string } | null | undefined) => {
  if (!result) {
    return false;
  }

  const merged = `${result.message ?? ""} ${result.details ?? ""}`.toLowerCase();
  return merged.includes("429") || merged.includes("rate limit");
};

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const result = await syncSchedulerCronJobLifecycle({ force: true });
  if (!result.ok && result.status === "error") {
    if (isRateLimitResult(result)) {
      return NextResponse.json({
        ok: false,
        status: "skipped",
        message:
          "cron-job.org rate limit nedeniyle tam senkron bu istekte tamamlanamadı. Birkaç dakika sonra tekrar deneyin.",
        details: result.details ?? result.message,
      });
    }

    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
