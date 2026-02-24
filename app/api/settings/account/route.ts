import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE, clearSessionCookies } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cancelStripeSubscriptionsNow, isSubscriptionActive, loadUserSubscriptions } from "@/lib/settings/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

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

const safeDeleteByUser = async (table: string, userId: string) => {
  const result = await supabaseAdmin.from(table).delete().eq("user_id", userId);

  if (result.error && !isMissingRelationError(result.error)) {
    throw new Error(result.error.message);
  }
};

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

    const subscriptions = await loadUserSubscriptions(user.id);
    const activeSubscriptions = subscriptions.filter((row) => isSubscriptionActive(row));

    if (activeSubscriptions.length > 0) {
      const cancellation = await cancelStripeSubscriptionsNow(activeSubscriptions);

      if (cancellation.missingStripeIds.length > 0) {
        return NextResponse.json(
          {
            error: "Aktif abonelik Stripe kimliği eksik olduğu için hesap silinemedi. Önce destek ekibiyle iletişime geçin.",
            missingStripeIds: cancellation.missingStripeIds,
          },
          { status: 409 }
        );
      }

      if (cancellation.failed.length > 0) {
        return NextResponse.json(
          {
            error: "Aktif abonelikler Stripe üzerinde durdurulamadı. Hesap silme işlemi iptal edildi.",
            failed: cancellation.failed,
          },
          { status: 502 }
        );
      }
    }

    await safeDeleteByUser("orders", user.id);
    await safeDeleteByUser("scheduler_jobs", user.id);
    await safeDeleteByUser("payments", user.id);
    await safeDeleteByUser("subscriptions", user.id);
    await safeDeleteByUser("stores", user.id);
    await safeDeleteByUser("profiles", user.id);

    const authDelete = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (authDelete.error) {
      return NextResponse.json({ error: authDelete.error.message }, { status: 500 });
    }

    const response = NextResponse.json({ success: true });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account could not be deleted";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
