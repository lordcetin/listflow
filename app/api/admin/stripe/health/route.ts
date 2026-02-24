import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { getStripeClientForMode, resolveStripeMode, type StripeMode } from "@/lib/stripe/client";

const notFoundResponse = () => NextResponse.json({ error: "Not Found" }, { status: 404 });

type StripeHealthEvent = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  processed_at: string;
};

const requireAdmin = async (request: NextRequest) => {
  const token = getAccessTokenFromRequest(request);
  if (!token) return null;

  const user = await getUserFromAccessToken(token);
  if (!user) return null;

  const profile = await getProfileByUserId(user.id, token);
  if (!profile || !isAdminRole(profile.role)) return null;

  return { user, profile };
};

const isMissingRelationError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  if (error.code === "42P01") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
};

const isMissingColumnError = (
  error: { message?: string; code?: string } | null | undefined,
  columnName: string
) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const mapStripeApiEvents = async (mode: StripeMode): Promise<StripeHealthEvent[]> => {
  const stripeClient = getStripeClientForMode(mode);
  const response = await stripeClient.events.list({ limit: 20 });

  return response.data.map((event) => ({
    id: `stripe-api-${event.id}`,
    stripe_event_id: event.id,
    event_type: event.type,
    processed_at: new Date(event.created * 1000).toISOString(),
  }));
};

const readDbEvents = async (mode: StripeMode): Promise<StripeHealthEvent[]> => {
  const withMode = await supabaseAdmin
    .from("stripe_event_logs")
    .select("id, stripe_event_id, event_type, processed_at, stripe_mode, payload")
    .order("processed_at", { ascending: false })
    .limit(200);

  let rows = withMode.data as Array<{
    id: string;
    stripe_event_id: string;
    event_type: string;
    processed_at: string;
    stripe_mode?: string | null;
    payload?: { livemode?: boolean } | null;
  }> | null;
  let rowsError = withMode.error;
  let hasModeColumn = true;

  if (withMode.error && isMissingColumnError(withMode.error, "stripe_mode")) {
    hasModeColumn = false;
    const fallback = await supabaseAdmin
      .from("stripe_event_logs")
      .select("id, stripe_event_id, event_type, processed_at, payload")
      .order("processed_at", { ascending: false })
      .limit(200);

    rows = fallback.data as Array<{
      id: string;
      stripe_event_id: string;
      event_type: string;
      processed_at: string;
      stripe_mode?: string | null;
      payload?: { livemode?: boolean } | null;
    }> | null;
    rowsError = fallback.error;
  }

  if (rowsError && isMissingColumnError(rowsError, "payload")) {
    const basicFallback = await supabaseAdmin
      .from("stripe_event_logs")
      .select("id, stripe_event_id, event_type, processed_at")
      .order("processed_at", { ascending: false })
      .limit(200);

    rows = basicFallback.data as Array<{
      id: string;
      stripe_event_id: string;
      event_type: string;
      processed_at: string;
      stripe_mode?: string | null;
      payload?: { livemode?: boolean } | null;
    }> | null;
    rowsError = basicFallback.error;
  }

  if (rowsError) {
    if (isMissingRelationError(rowsError)) {
      throw new Error(
        "Missing table public.stripe_event_logs. Apply Supabase schema/migrations and retry."
      );
    }

    throw new Error(rowsError.message);
  }

  const targetMode = mode;
  const targetLive = targetMode === "live";

  return (rows ?? [])
    .filter((row) => {
      if (hasModeColumn && (row.stripe_mode === "live" || row.stripe_mode === "test")) {
        return row.stripe_mode === targetMode;
      }

      if (row.payload && typeof row.payload.livemode === "boolean") {
        return row.payload.livemode === targetLive;
      }

      return true;
    })
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      stripe_event_id: row.stripe_event_id,
      event_type: row.event_type,
      processed_at: row.processed_at,
    }));
};

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  const mode = resolveStripeMode(request.nextUrl.searchParams.get("mode"), serverEnv.STRIPE_MODE);

  try {
    const dbEvents = await readDbEvents(mode);

    if (dbEvents.length > 0) {
      return NextResponse.json({ mode, source: "webhook_db", events: dbEvents });
    }

    const stripeApiEvents = await mapStripeApiEvents(mode);
    return NextResponse.json({ mode, source: "stripe_api", events: stripeApiEvents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe health could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
