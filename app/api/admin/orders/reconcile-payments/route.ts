import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { syncOneTimeCheckoutPayment } from "@/lib/stripe/checkout-payment-sync";
import { getActiveStripeMode, getStripeClientForMode, type StripeMode } from "@/lib/stripe/client";
import { isUuid } from "@/lib/utils/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReconcileRequestBody = {
  mode?: "all" | "live" | "test";
  days?: number;
  maxSessions?: number;
  dryRun?: boolean;
};

type ModeSummary = {
  mode: StripeMode;
  scannedSessions: number;
  eligibleSessions: number;
  paidCandidates: number;
  syncedSessions: number;
  ordersMarkedPaid: number;
  skippedNotPaid: number;
  failures: Array<{ sessionId: string; reason: string }>;
};

const clampInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const resolveModes = (raw: string | undefined): StripeMode[] => {
  if (raw === "live" || raw === "test") {
    return [raw];
  }

  const active = getActiveStripeMode();
  const secondary: StripeMode = active === "live" ? "test" : "live";
  return [active, secondary];
};

const extractOrderId = (session: Stripe.Checkout.Session) => {
  const metadataOrderId = session.metadata?.orderId;
  if (metadataOrderId && isUuid(metadataOrderId)) {
    return metadataOrderId;
  }

  const metadataShopId = session.metadata?.shopId;
  if (!metadataShopId || !metadataShopId.startsWith("order_")) {
    return null;
  }

  const parsed = metadataShopId.slice("order_".length);
  return isUuid(parsed) ? parsed : null;
};

const isPaidCheckoutStatus = (status: string | null | undefined) => {
  const normalized = (status ?? "").toLowerCase();
  return normalized === "paid" || normalized === "no_payment_required";
};

const collectOrderCheckoutSessions = async (args: {
  mode: StripeMode;
  sinceUnix: number;
  maxSessions: number;
}) => {
  const stripe = getStripeClientForMode(args.mode);
  const sessions: Stripe.Checkout.Session[] = [];
  let scannedSessions = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore && sessions.length < args.maxSessions) {
    const response = await stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: args.sinceUnix },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    if (!response.data.length) {
      break;
    }

    scannedSessions += response.data.length;

    for (const session of response.data) {
      if (session.mode !== "payment") {
        continue;
      }

      if (!extractOrderId(session)) {
        continue;
      }

      sessions.push(session);
      if (sessions.length >= args.maxSessions) {
        break;
      }
    }

    hasMore = response.has_more;
    startingAfter = response.data[response.data.length - 1]?.id;
  }

  return {
    sessions,
    scannedSessions,
  };
};

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const body = (await request.json().catch(() => ({}))) as ReconcileRequestBody;

    const requestedMode = body.mode ?? "all";
    const days = clampInteger(body.days, 180, 1, 3650);
    const maxSessions = clampInteger(body.maxSessions, 500, 20, 2000);
    const dryRun = body.dryRun === true;
    const sinceUnix = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    const modes = resolveModes(requestedMode === "all" ? undefined : requestedMode);

    const warnings: string[] = [];
    const modeSummaries: ModeSummary[] = [];

    for (const mode of modes) {
      try {
        const { sessions, scannedSessions } = await collectOrderCheckoutSessions({
          mode,
          sinceUnix,
          maxSessions,
        });

        const summary: ModeSummary = {
          mode,
          scannedSessions,
          eligibleSessions: sessions.length,
          paidCandidates: 0,
          syncedSessions: 0,
          ordersMarkedPaid: 0,
          skippedNotPaid: 0,
          failures: [],
        };

        for (const session of sessions) {
          if (!isPaidCheckoutStatus(session.payment_status)) {
            summary.skippedNotPaid += 1;
            continue;
          }

          summary.paidCandidates += 1;

          if (dryRun) {
            continue;
          }

          try {
            const sync = await syncOneTimeCheckoutPayment(session, { forcedStatus: "paid" });
            summary.syncedSessions += 1;

            if (sync.orderUpdated) {
              summary.ordersMarkedPaid += 1;
            }
          } catch (error) {
            summary.failures.push({
              sessionId: session.id,
              reason: error instanceof Error ? error.message : "sync_failed",
            });
          }
        }

        modeSummaries.push(summary);
      } catch (error) {
        warnings.push(`${mode}: ${error instanceof Error ? error.message : "session scan failed"}`);
      }
    }

    if (!modeSummaries.length) {
      return NextResponse.json(
        {
          error: "Stripe checkout oturumları okunamadı.",
          warnings,
        },
        { status: 500 }
      );
    }

    const aggregate = modeSummaries.reduce(
      (acc, summary) => {
        acc.scannedSessions += summary.scannedSessions;
        acc.eligibleSessions += summary.eligibleSessions;
        acc.paidCandidates += summary.paidCandidates;
        acc.syncedSessions += summary.syncedSessions;
        acc.ordersMarkedPaid += summary.ordersMarkedPaid;
        acc.skippedNotPaid += summary.skippedNotPaid;
        acc.failures.push(...summary.failures.map((failure) => ({ ...failure, mode: summary.mode })));
        return acc;
      },
      {
        scannedSessions: 0,
        eligibleSessions: 0,
        paidCandidates: 0,
        syncedSessions: 0,
        ordersMarkedPaid: 0,
        skippedNotPaid: 0,
        failures: [] as Array<{ mode: StripeMode; sessionId: string; reason: string }>,
      }
    );

    return NextResponse.json({
      requestedMode,
      processedModes: modeSummaries.map((summary) => summary.mode),
      days,
      maxSessions,
      dryRun,
      scannedSessions: aggregate.scannedSessions,
      eligibleSessions: aggregate.eligibleSessions,
      paidCandidates: aggregate.paidCandidates,
      syncedSessions: aggregate.syncedSessions,
      ordersMarkedPaid: aggregate.ordersMarkedPaid,
      skippedNotPaid: aggregate.skippedNotPaid,
      failures: aggregate.failures,
      warnings,
      modeSummaries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment reconciliation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
