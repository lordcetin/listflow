import type { NextRequest } from "next/server";
import { GET as schedulerGet, POST as schedulerPost } from "@/app/api/scheduler/tick/route";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return schedulerGet(request);
}

export async function POST(request: NextRequest) {
  return schedulerPost(request);
}
