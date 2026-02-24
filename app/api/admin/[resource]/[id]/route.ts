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

const requireAdmin = async (request: NextRequest) => {
  const token = getAccessTokenFromRequest(request);
  if (!token) return null;

  const user = await getUserFromAccessToken(token);
  if (!user) return null;

  const profile = await getProfileByUserId(user.id, token);
  if (!profile || !isAdminRole(profile.role)) return null;

  return { user, profile };
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  const { resource, id } = await params;
  if (!isAdminResource(resource)) return notFoundResponse();

  const { table, idColumn } = ADMIN_RESOURCE_MAP[resource];
  const body = (await request.json()) as Record<string, unknown>;

  const { data, error } = await supabaseAdmin
    .from(table)
    .update(body)
    .eq(idColumn, id)
    .select("*")
    .maybeSingle();

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  const { resource, id } = await params;
  if (!isAdminResource(resource)) return notFoundResponse();

  const { table, idColumn } = ADMIN_RESOURCE_MAP[resource];

  const { error } = await supabaseAdmin.from(table).delete().eq(idColumn, id);

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: `Table ${table} does not exist in remote schema yet. Apply migrations first.` },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
