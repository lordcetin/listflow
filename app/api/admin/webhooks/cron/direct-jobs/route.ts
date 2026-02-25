import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { loadDirectAutomationCronJobs } from "@/lib/cron-job-org/client";

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const rows = await loadDirectAutomationCronJobs();
    return NextResponse.json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Direct cron job listesi yüklenemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
