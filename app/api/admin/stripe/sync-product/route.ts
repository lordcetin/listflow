import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";
import { createStripeProductAndPrice } from "@/lib/stripe/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveStripeMode } from "@/lib/stripe/client";

const notFoundResponse = () => NextResponse.json({ error: "Not Found" }, { status: 404 });

const requireAdmin = async (request: NextRequest) => {
  const token = getAccessTokenFromRequest(request);
  if (!token) return null;

  const user = await getUserFromAccessToken(token);
  if (!user) return null;

  const profile = await getProfileByUserId(user.id, token);
  if (!profile || !isAdminRole(profile.role)) return null;

  return { user, profile };
};

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  try {
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      amount?: number;
      currency?: string;
      interval?: "month" | "year";
      productId?: string;
      mode?: string;
    };

    if (!body.name || !body.amount) {
      return NextResponse.json({ error: "name and amount are required" }, { status: 400 });
    }

    const mode = resolveStripeMode(body.mode);

    const { product, price } = await createStripeProductAndPrice({
      name: body.name,
      description: body.description,
      amount: body.amount,
      currency: body.currency || "usd",
      interval: body.interval || "month",
      mode,
    });

    if (body.productId) {
      await supabaseAdmin
        .from("products")
        .update({
          stripe_product_id: product.id,
          stripe_price_id: price.id,
        })
        .eq("id", body.productId);
    }

    return NextResponse.json({
      mode,
      stripeProductId: product.id,
      stripePriceId: price.id,
      webhookUrl: `${request.nextUrl.origin}/api/stripe/webhook`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
