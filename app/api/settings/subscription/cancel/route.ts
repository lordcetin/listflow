import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncProfileSubscriptionState } from "@/lib/subscription/profile-sync";
import {
  cancelStripeSubscriptionsNow,
  isSubscriptionActive,
  loadUserSubscriptions,
  resolveStoreIdFromSubscription,
} from "@/lib/settings/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

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

    const allSubscriptions = await loadUserSubscriptions(user.id);
    const activeSubscriptions = allSubscriptions.filter((row) => isSubscriptionActive(row));

    if (activeSubscriptions.length === 0) {
      return NextResponse.json({
        success: true,
        canceledCount: 0,
        alreadyStopped: true,
      });
    }

    const cancellation = await cancelStripeSubscriptionsNow(activeSubscriptions);

    if (cancellation.missingStripeIds.length > 0) {
      return NextResponse.json(
        {
          error: "Bazı aktif aboneliklerin Stripe ID bilgisi eksik. İptal işlemi tamamlanamadı.",
          missingStripeIds: cancellation.missingStripeIds,
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const canceledRows = activeSubscriptions.filter((row) => cancellation.canceledIds.includes(row.id));

    for (const row of canceledRows) {
      const updateSubscription = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "canceled",
          current_period_end: nowIso,
          updated_at: nowIso,
        })
        .eq("id", row.id)
        .eq("user_id", user.id);

      if (updateSubscription.error) {
        return NextResponse.json({ error: updateSubscription.error.message }, { status: 500 });
      }

      const storeId = resolveStoreIdFromSubscription(row);
      if (storeId) {
        const storeUpdate = await supabaseAdmin
          .from("stores")
          .update({
            status: "canceled",
            updated_at: nowIso,
          })
          .eq("id", storeId)
          .eq("user_id", user.id);

        if (storeUpdate.error && !isMissingColumnError(storeUpdate.error, "updated_at")) {
          return NextResponse.json({ error: storeUpdate.error.message }, { status: 500 });
        }

        if (storeUpdate.error && isMissingColumnError(storeUpdate.error, "updated_at")) {
          const fallbackStoreUpdate = await supabaseAdmin
            .from("stores")
            .update({
              status: "canceled",
            })
            .eq("id", storeId)
            .eq("user_id", user.id);

          if (fallbackStoreUpdate.error) {
            return NextResponse.json({ error: fallbackStoreUpdate.error.message }, { status: 500 });
          }
        }
      }
    }

    await syncProfileSubscriptionState({
      userId: user.id,
      email: user.email ?? null,
      status: "canceled",
      plan: null,
    });

    if (cancellation.failed.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Bazı abonelikler Stripe üzerinde durdurulamadı.",
          canceledCount: cancellation.canceledIds.length,
          failed: cancellation.failed,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      canceledCount: cancellation.canceledIds.length,
      failed: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Subscriptions could not be canceled";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
