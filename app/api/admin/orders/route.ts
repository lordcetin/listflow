import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QueryError = {
  message?: string;
  code?: string | null;
};

const isMissingTableError = (error: QueryError | null | undefined) => {
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

const isRecoverableSelectError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("column") ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("failed to parse select")
  );
};

const ORDER_SELECT_CANDIDATES = [
  "id, user_id, store_id, category_name, sub_product_name, variant_name, payment_status, created_at, updated_at",
  "id, user_id, category_name, sub_product_name, variant_name, payment_status, created_at, updated_at",
  "id, user_id, category_name, sub_product_name, payment_status, created_at",
] as const;

const ORDER_BY_CANDIDATES = ["created_at", "updated_at", "id"] as const;

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  let lastError: QueryError | null = null;

  for (const select of ORDER_SELECT_CANDIDATES) {
    for (const orderBy of ORDER_BY_CANDIDATES) {
      const query = supabaseAdmin
        .from("orders")
        .select(select)
        .order(orderBy, { ascending: false })
        .limit(5000);

      const { data, error } = await query;

      if (!error) {
        return NextResponse.json({ rows: data ?? [] });
      }

      lastError = error;

      if (isMissingTableError(error)) {
        return NextResponse.json({
          rows: [],
          warning: "Table public.orders does not exist in remote schema yet. Apply the latest orders migration.",
        });
      }

      if (!isRecoverableSelectError(error)) {
        return NextResponse.json({ error: error.message ?? "orders could not be loaded" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ error: lastError?.message ?? "orders could not be loaded" }, { status: 500 });
}
