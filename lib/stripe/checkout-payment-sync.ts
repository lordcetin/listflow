import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

type QueryError = {
  message?: string;
  code?: string | null;
};

export type CheckoutPaymentState = "paid" | "pending" | "failed";

export type CheckoutPaymentSyncResult = {
  paymentId: string | null;
  paymentStatus: CheckoutPaymentState;
  orderId: string | null;
  orderUpdated: boolean;
};

const isMissingColumnError = (error: QueryError | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isRecoverableColumnError = (error: QueryError | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const normalizeCheckoutPaymentStatus = (
  status: string | null | undefined,
  forcedStatus?: CheckoutPaymentState
): CheckoutPaymentState => {
  if (forcedStatus) {
    return forcedStatus;
  }

  const normalized = (status ?? "").toLowerCase();

  if (normalized === "paid" || normalized === "no_payment_required") {
    return "paid";
  }

  if (normalized === "failed") {
    return "failed";
  }

  return "pending";
};

const parseOrderIdFromMetadata = (session: Stripe.Checkout.Session) => {
  const metadataOrderId = session.metadata?.orderId;
  if (metadataOrderId && isUuid(metadataOrderId)) {
    return metadataOrderId;
  }

  const metadataShopId = session.metadata?.shopId;
  if (metadataShopId && metadataShopId.startsWith("order_")) {
    const parsedOrderId = metadataShopId.slice("order_".length);
    if (isUuid(parsedOrderId)) {
      return parsedOrderId;
    }
  }

  return null;
};

const findExistingPaymentBySessionId = async (sessionId: string) => {
  const withSessionId = await supabaseAdmin
    .from("payments")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!withSessionId.error) {
    return {
      id: withSessionId.data?.id ?? null,
      hasStripeSessionColumn: true,
    };
  }

  if (!isMissingColumnError(withSessionId.error, "stripe_session_id")) {
    throw new Error(withSessionId.error.message ?? "Could not query payments by stripe_session_id");
  }

  return {
    id: null,
    hasStripeSessionColumn: false,
  };
};

const findExistingPaymentByShopFallback = async (shopId: string | null) => {
  if (!shopId) {
    return null;
  }

  const withShopId = await supabaseAdmin
    .from("payments")
    .select("id")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!withShopId.error) {
    return withShopId.data?.id ?? null;
  }

  if (isMissingColumnError(withShopId.error, "shop_id")) {
    return null;
  }

  throw new Error(withShopId.error.message ?? "Could not query payments by shop_id");
};

const updateExistingPayment = async (args: {
  paymentId: string;
  userId: string | null;
  shopId: string | null;
  sessionId: string;
  amountCents: number;
  currency: string;
  status: CheckoutPaymentState;
}) => {
  const updateCandidates: Array<Record<string, unknown>> = [
    {
      user_id: args.userId,
      shop_id: args.shopId,
      stripe_session_id: args.sessionId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      user_id: args.userId,
      stripe_session_id: args.sessionId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      user_id: args.userId,
      shop_id: args.shopId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
  ];

  let lastError: QueryError | null = null;

  for (const patch of updateCandidates) {
    const updated = await supabaseAdmin.from("payments").update(patch).eq("id", args.paymentId);

    if (!updated.error) {
      return;
    }

    lastError = updated.error;

    if (!isRecoverableColumnError(updated.error, ["user_id", "shop_id", "stripe_session_id", "amount_cents", "currency", "status"])) {
      throw new Error(updated.error.message ?? "Could not update payment");
    }
  }

  throw new Error(lastError?.message ?? "Could not update payment");
};

const insertPayment = async (args: {
  userId: string | null;
  shopId: string | null;
  sessionId: string;
  amountCents: number;
  currency: string;
  status: CheckoutPaymentState;
}) => {
  const insertCandidates: Array<Record<string, unknown>> = [
    {
      user_id: args.userId,
      shop_id: args.shopId,
      stripe_session_id: args.sessionId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      user_id: args.userId,
      stripe_session_id: args.sessionId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      user_id: args.userId,
      shop_id: args.shopId,
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
    {
      amount_cents: args.amountCents,
      currency: args.currency,
      status: args.status,
    },
  ];

  let lastError: QueryError | null = null;

  for (const payload of insertCandidates) {
    const inserted = await supabaseAdmin
      .from("payments")
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (!inserted.error) {
      return inserted.data?.id ?? null;
    }

    lastError = inserted.error;

    if (!isRecoverableColumnError(inserted.error, ["user_id", "shop_id", "stripe_session_id", "amount_cents", "currency", "status"])) {
      throw new Error(inserted.error.message ?? "Could not insert payment");
    }
  }

  throw new Error(lastError?.message ?? "Could not insert payment");
};

const updateOrderPaymentStatus = async (args: {
  orderId: string;
  userId: string | null;
  status: CheckoutPaymentState;
}) => {
  const updateCandidates: Array<Record<string, unknown>> = [
    {
      payment_status: args.status,
      updated_at: new Date().toISOString(),
    },
    {
      payment_status: args.status,
    },
  ];

  let lastError: QueryError | null = null;

  for (const patch of updateCandidates) {
    let query = supabaseAdmin.from("orders").update(patch).eq("id", args.orderId);

    if (args.userId && isUuid(args.userId)) {
      query = query.eq("user_id", args.userId);
    }

    const updated = await query.select("id").limit(1).maybeSingle<{ id: string }>();

    if (!updated.error) {
      return Boolean(updated.data?.id);
    }

    lastError = updated.error;

    if (!isRecoverableColumnError(updated.error, ["payment_status", "updated_at", "user_id"])) {
      throw new Error(updated.error.message ?? "Could not update order payment status");
    }
  }

  throw new Error(lastError?.message ?? "Could not update order payment status");
};

export const syncOneTimeCheckoutPayment = async (
  session: Stripe.Checkout.Session,
  options?: { forcedStatus?: CheckoutPaymentState }
): Promise<CheckoutPaymentSyncResult> => {
  const paymentStatus = normalizeCheckoutPaymentStatus(session.payment_status, options?.forcedStatus);
  const userId = session.metadata?.userId ?? null;
  const shopId = session.metadata?.shopId ?? null;
  const orderId = parseOrderIdFromMetadata(session);
  const amountCents = session.amount_total ?? 0;
  const currency = (session.currency ?? "usd").toLowerCase();

  const existing = await findExistingPaymentBySessionId(session.id);

  let paymentId = existing.id;

  if (!paymentId && !existing.hasStripeSessionColumn) {
    paymentId = await findExistingPaymentByShopFallback(shopId);
  }

  if (paymentId) {
    await updateExistingPayment({
      paymentId,
      userId,
      shopId,
      sessionId: session.id,
      amountCents,
      currency,
      status: paymentStatus,
    });
  } else {
    paymentId = await insertPayment({
      userId,
      shopId,
      sessionId: session.id,
      amountCents,
      currency,
      status: paymentStatus,
    });
  }

  let orderUpdated = false;

  if (orderId) {
    orderUpdated = await updateOrderPaymentStatus({
      orderId,
      userId,
      status: paymentStatus,
    });
  }

  return {
    paymentId,
    paymentStatus,
    orderId,
    orderUpdated,
  };
};
