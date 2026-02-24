import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isSubscriptionActive, loadUserSubscriptions, type SettingsSubscriptionRow } from "@/lib/settings/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone?: string | null;
  role?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SettingsSubscriptionResponseRow = {
  id: string;
  plan: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
  isActive: boolean;
};

type UpdateProfileBody = {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
};

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const isRecoverableProfileColumnError = (error: { message?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  return (
    isMissingColumnError(error, "phone") ||
    isMissingColumnError(error, "updated_at") ||
    isMissingColumnError(error, "created_at")
  );
};

const normalizeText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
};

const normalizeEmail = (value: unknown) => {
  const text = normalizeText(value, 254);
  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(normalized) ? normalized : null;
};

const selectProfile = async (userId: string) => {
  const selectCandidates = [
    "user_id, email, full_name, phone, role, created_at, updated_at",
    "user_id, email, full_name, phone, role, created_at",
    "user_id, email, full_name, phone, role",
    "user_id, email, full_name, role, created_at",
    "user_id, email, full_name, role",
  ] as const;

  let lastError: { message?: string } | null = null;

  for (const select of selectCandidates) {
    const result = await supabaseAdmin
      .from("profiles")
      .select(select)
      .eq("user_id", userId)
      .maybeSingle<ProfileRow>();

    if (!result.error) {
      if (!result.data) {
        return null;
      }

      return {
        ...result.data,
        phone: result.data.phone ?? null,
        created_at: result.data.created_at ?? null,
        updated_at: result.data.updated_at ?? null,
      };
    }

    lastError = result.error;

    if (!isRecoverableProfileColumnError(result.error)) {
      throw new Error(result.error.message);
    }
  }

  throw new Error(lastError?.message ?? "Profile could not be loaded");
};

const mapSubscriptions = (rows: SettingsSubscriptionRow[]) => {
  return rows.map<SettingsSubscriptionResponseRow>((row) => ({
    id: row.id,
    plan: row.plan ?? null,
    status: row.status ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    isActive: isSubscriptionActive(row),
  }));
};

const ensureAuthorizedUser = async (request: NextRequest) => {
  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user = await getUserFromAccessToken(accessToken);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { accessToken, user };
};

export async function GET(request: NextRequest) {
  try {
    const auth = await ensureAuthorizedUser(request);
    if ("error" in auth) {
      return auth.error;
    }

    const [profile, subscriptions] = await Promise.all([
      selectProfile(auth.user.id),
      loadUserSubscriptions(auth.user.id),
    ]);

    const mappedSubscriptions = mapSubscriptions(subscriptions);
    const hasActiveSubscription = mappedSubscriptions.some((row) => row.isActive);

    return NextResponse.json({
      profile: {
        userId: auth.user.id,
        email: profile?.email ?? auth.user.email ?? null,
        fullName: profile?.full_name ?? null,
        phone: profile?.phone ?? null,
        role: profile?.role ?? "user",
        createdAt: profile?.created_at ?? null,
      },
      subscriptions: mappedSubscriptions,
      hasActiveSubscription,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Settings profile could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await ensureAuthorizedUser(request);
    if ("error" in auth) {
      return auth.error;
    }

    const body = (await request.json()) as UpdateProfileBody;
    const fullName = normalizeText(body.fullName, 120);
    const phone = normalizeText(body.phone, 32);
    const email = normalizeEmail(body.email);

    if (body.email !== undefined && !email) {
      return NextResponse.json({ error: "Geçerli bir e-posta adresi girin." }, { status: 400 });
    }

    const authUserResult = await supabaseAdmin.auth.getUser(auth.accessToken);
    if (authUserResult.error || !authUserResult.data.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authUser = authUserResult.data.user;
    const currentMetadata =
      typeof authUser.user_metadata === "object" && authUser.user_metadata !== null
        ? (authUser.user_metadata as Record<string, unknown>)
        : {};

    const metadataPatch: Record<string, unknown> = {
      ...currentMetadata,
      full_name: fullName,
      phone,
    };

    const desiredEmail = email ?? authUser.email ?? null;
    const needsEmailUpdate = Boolean(desiredEmail && desiredEmail !== authUser.email);
    const needsMetadataUpdate = currentMetadata.full_name !== fullName || currentMetadata.phone !== phone;

    if (needsEmailUpdate || needsMetadataUpdate) {
      const updatePayload: {
        email?: string;
        user_metadata?: Record<string, unknown>;
      } = {};

      if (needsEmailUpdate && desiredEmail) {
        updatePayload.email = desiredEmail;
      }

      if (needsMetadataUpdate) {
        updatePayload.user_metadata = metadataPatch;
      }

      const authUpdate = await supabaseAdmin.auth.admin.updateUserById(auth.user.id, updatePayload);
      if (authUpdate.error) {
        return NextResponse.json({ error: authUpdate.error.message }, { status: 500 });
      }
    }

    const nowIso = new Date().toISOString();
    const payloadCandidates: Array<Record<string, unknown>> = [
      {
        user_id: auth.user.id,
        email: desiredEmail,
        full_name: fullName,
        phone,
        updated_at: nowIso,
      },
      {
        user_id: auth.user.id,
        email: desiredEmail,
        full_name: fullName,
        phone,
      },
      {
        user_id: auth.user.id,
        email: desiredEmail,
        full_name: fullName,
        updated_at: nowIso,
      },
      {
        user_id: auth.user.id,
        email: desiredEmail,
        full_name: fullName,
      },
    ];

    let upserted = false;
    let lastUpsertError: { message?: string } | null = null;

    for (const payload of payloadCandidates) {
      const result = await supabaseAdmin.from("profiles").upsert(payload, { onConflict: "user_id" });

      if (!result.error) {
        upserted = true;
        break;
      }

      lastUpsertError = result.error;

      if (!isRecoverableProfileColumnError(result.error)) {
        return NextResponse.json({ error: result.error.message }, { status: 500 });
      }
    }

    if (!upserted) {
      return NextResponse.json({ error: lastUpsertError?.message ?? "Profile could not be updated" }, { status: 500 });
    }

    const profile = await selectProfile(auth.user.id);

    return NextResponse.json({
      success: true,
      profile: {
        userId: auth.user.id,
        email: profile?.email ?? desiredEmail,
        fullName: profile?.full_name ?? fullName,
        phone: profile?.phone ?? phone,
        role: profile?.role ?? "user",
        createdAt: profile?.created_at ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Settings profile could not be updated";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
