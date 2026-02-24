import { NextResponse } from "next/server";
import { getPublicPlanPricing } from "@/lib/stripe/plans";

export const runtime = "nodejs";

export async function GET() {
  try {
    const plans = await getPublicPlanPricing();
    return NextResponse.json({ plans });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Plan pricing could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
