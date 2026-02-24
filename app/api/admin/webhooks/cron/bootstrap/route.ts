import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { syncSchedulerCronJobLifecycle } from "@/lib/cron-job-org/client";

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const result = await syncSchedulerCronJobLifecycle();
  if (!result.ok && result.status === "error") {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
