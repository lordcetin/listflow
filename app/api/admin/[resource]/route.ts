import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";
import { isAdminResource, ADMIN_RESOURCE_MAP } from "@/lib/admin/resources";
import { supabaseAdmin } from "@/lib/supabase/admin";

const notFoundResponse = () => NextResponse.json({ error: "Not Found" }, { status: 404 });
const isMissingTableError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    message.includes("could not find the table") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
};

const isMissingColumnError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return error.code === "42703" || (message.includes("column") && message.includes("does not exist"));
};

const ORDER_BY_RESOURCE: Partial<Record<keyof typeof ADMIN_RESOURCE_MAP, string>> = {
  payments: "created_at",
  subscriptions: "created_at",
  stores: "created_at",
  "webhook-logs": "created_at",
  "automation-transitions": "created_at",
  "stripe-events": "processed_at",
  jobs: "run_at",
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  const { resource } = await params;
  if (!isAdminResource(resource)) return notFoundResponse();

  const { table } = ADMIN_RESOURCE_MAP[resource];
  const orderColumn = ORDER_BY_RESOURCE[resource];
  let query = supabaseAdmin.from(table).select("*").limit(200);

  if (orderColumn) {
    query = query.order(orderColumn, { ascending: false });
  }

  let { data, error } = await query;

  // Fallback for older schemas where sort column is missing.
  if (error && orderColumn && isMissingColumnError(error)) {
    const fallback = await supabaseAdmin.from(table).select("*").limit(200);
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({
        rows: [],
        warning: `Table ${table} does not exist in remote schema yet. Apply migrations.`,
      });
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  const { resource } = await params;
  if (!isAdminResource(resource)) return notFoundResponse();

  const { table } = ADMIN_RESOURCE_MAP[resource];
  const body = (await request.json()) as Record<string, unknown>;

  const { data, error } = await supabaseAdmin.from(table).insert(body).select("*").maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: `Table ${table} does not exist in remote schema yet. Apply migrations first.` },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ row: data });
}
