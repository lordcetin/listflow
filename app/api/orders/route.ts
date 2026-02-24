import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QueryError = {
  message: string;
  code?: string | null;
};

type OrderRow = {
  id: string;
  user_id?: string | null;
  store_id?: string | null;
  category_name?: string | null;
  sub_product_name?: string | null;
  variant_name?: string | null;
  product_link?: string | null;
  order_date?: string | null;
  shipping_address?: string | null;
  note?: string | null;
  ioss?: string | null;
  label_number?: string | null;
  amount_usd?: number | string | null;
  payment_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CreateOrderPayload = {
  storeId?: unknown;
  category?: unknown;
  subProductName?: unknown;
  variantName?: unknown;
  productLink?: unknown;
  address?: unknown;
  note?: unknown;
  ioss?: unknown;
  labelNumber?: unknown;
  price?: unknown;
  date?: unknown;
};

type DeleteOrderPayload = {
  id?: unknown;
};

const ORDER_SELECT_CANDIDATES = [
  "id, user_id, store_id, category_name, sub_product_name, variant_name, product_link, order_date, shipping_address, note, ioss, label_number, amount_usd, payment_status, created_at, updated_at",
  "id, user_id, category_name, sub_product_name, variant_name, product_link, order_date, shipping_address, note, ioss, label_number, amount_usd, payment_status, created_at, updated_at",
  "id, user_id, category_name, sub_product_name, product_link, order_date, shipping_address, label_number, amount_usd, payment_status, created_at",
] as const;

const ORDER_BY_CANDIDATES = ["created_at", "order_date", "id"] as const;

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const asTrimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const asDateString = (value: unknown) => {
  if (typeof value !== "string") {
    return new Date().toISOString().split("T")[0];
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return new Date().toISOString().split("T")[0];
};

const toNumber = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const isMissingTableError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = error.message.toLowerCase();
  return error.code === "42P01" || message.includes("could not find the table") || message.includes("relation");
};

const isRecoverableSelectError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("column") ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("failed to parse select")
  );
};

const mapOrderRow = (row: OrderRow) => {
  const amount = toNumber(row.amount_usd);
  const date = row.order_date || row.created_at?.split("T")[0] || new Date().toISOString().split("T")[0];
  const paymentStatus = (row.payment_status || "pending").toLowerCase();

  return {
    id: row.id,
    productName: row.category_name || "",
    subProductName: row.sub_product_name || "",
    variantName: row.variant_name || undefined,
    productLink: row.product_link || "",
    category: row.category_name || "",
    date,
    address: row.shipping_address || "",
    isPaid: paymentStatus === "paid",
    note: row.note || undefined,
    ioss: row.ioss || undefined,
    labelNumber: row.label_number || "",
    price: amount,
    storeId: row.store_id || null,
    paymentStatus,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
};

const selectOrdersWithFallback = async (userId: string) => {
  let lastError: QueryError | null = null;

  outer:
  for (const select of ORDER_SELECT_CANDIDATES) {
    for (const orderBy of ORDER_BY_CANDIDATES) {
      const orderColumn: string = orderBy;
      const queryBase = supabaseAdmin
        .from("orders")
        .select(select as string)
        .eq("user_id", userId)
        .order(orderColumn, { ascending: false });

      const query = orderBy !== "id" ? queryBase.order("id", { ascending: false }) : queryBase;

      const { data, error } = await query;

      if (!error) {
        return ((data ?? []) as unknown as OrderRow[]) ?? [];
      }

      lastError = error;

      if (!isRecoverableSelectError(error)) {
        break outer;
      }
    }
  }

  throw new Error(lastError?.message ?? "orders could not be loaded");
};

const resolveSingleStoreIdForUser = async (userId: string) => {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(2);

  if (error) {
    return null;
  }

  const rows = (data ?? []) as Array<{ id: string }>;
  if (rows.length !== 1) {
    return null;
  }

  return rows[0]?.id ?? null;
};

export async function GET(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await selectOrdersWithFallback(user.id);
    return NextResponse.json({ rows: rows.map(mapOrderRow) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orders could not be loaded";

    if (isMissingTableError({ message })) {
      return NextResponse.json({
        rows: [],
        warning: "Table public.orders does not exist in remote schema yet. Apply the latest orders migration in supabase/migrations.",
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as CreateOrderPayload;

    const category = asTrimmedString(body.category);
    const subProductName = asTrimmedString(body.subProductName);
    const variantName = asTrimmedString(body.variantName) || null;
    const productLink = asTrimmedString(body.productLink);
    const address = asTrimmedString(body.address);
    const note = asTrimmedString(body.note) || null;
    const ioss = asTrimmedString(body.ioss) || null;
    const labelNumber = asTrimmedString(body.labelNumber);
    const amountUsd = toNumber(body.price as number | string | null | undefined);
    const date = asDateString(body.date);
    const requestedStoreId = asTrimmedString(body.storeId) || null;
    const storeId = requestedStoreId ?? (await resolveSingleStoreIdForUser(user.id));

    if (!category || !subProductName || !productLink || !address || !labelNumber) {
      return NextResponse.json({ error: "Missing required order fields." }, { status: 400 });
    }

    if (amountUsd < 0) {
      return NextResponse.json({ error: "Order amount must be zero or positive." }, { status: 400 });
    }

    const payloadCandidates: Array<Record<string, unknown>> = [
      {
        user_id: user.id,
        store_id: storeId,
        category_name: category,
        sub_product_name: subProductName,
        variant_name: variantName,
        product_link: productLink,
        order_date: date,
        shipping_address: address,
        note,
        ioss,
        label_number: labelNumber,
        amount_usd: amountUsd,
        payment_status: "pending",
        updated_at: new Date().toISOString(),
      },
      {
        user_id: user.id,
        category_name: category,
        sub_product_name: subProductName,
        variant_name: variantName,
        product_link: productLink,
        order_date: date,
        shipping_address: address,
        note,
        ioss,
        label_number: labelNumber,
        amount_usd: amountUsd,
        payment_status: "pending",
        updated_at: new Date().toISOString(),
      },
      {
        user_id: user.id,
        category_name: category,
        sub_product_name: subProductName,
        product_link: productLink,
        order_date: date,
        shipping_address: address,
        label_number: labelNumber,
        amount_usd: amountUsd,
        payment_status: "pending",
      },
    ];

    let created: OrderRow | null = null;
    let lastError: QueryError | null = null;

    for (const payload of payloadCandidates) {
      const { data, error } = await supabaseAdmin.from("orders").insert(payload).select("*").maybeSingle<OrderRow>();

      if (!error) {
        created = data ?? null;
        break;
      }

      lastError = error;

      if (!isRecoverableSelectError(error)) {
        break;
      }
    }

    if (created) {
      return NextResponse.json({ row: mapOrderRow(created) });
    }

    if (isMissingTableError(lastError)) {
      return NextResponse.json(
        {
          error: "Table public.orders does not exist in remote schema yet. Apply the latest orders migration in supabase/migrations.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: lastError?.message ?? "Order could not be created" }, { status: 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order could not be created";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const accessToken = getAccessToken(request);

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromAccessToken(accessToken);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const idFromQuery = asTrimmedString(request.nextUrl.searchParams.get("id"));
    let orderId = idFromQuery;

    if (!orderId) {
      const body = (await request.json().catch(() => ({}))) as DeleteOrderPayload;
      orderId = asTrimmedString(body.id);
    }

    if (!orderId) {
      return NextResponse.json({ error: "Order id is required." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .delete()
      .eq("id", orderId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json(
          {
            error: "Table public.orders does not exist in remote schema yet. Apply the latest orders migration in supabase/migrations.",
          },
          { status: 400 }
        );
      }

      return NextResponse.json({ error: error.message || "Order could not be deleted" }, { status: 500 });
    }

    if (!data?.id) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    return NextResponse.json({ id: data.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order could not be deleted";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
