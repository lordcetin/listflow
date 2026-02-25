import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env/server";
import { runSchedulerTick } from "@/lib/scheduler/engine";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runCronTestTick } from "@/lib/webhooks/cron-test";

export const runtime = "nodejs";

const getBearerToken = (authHeader: string | null) => {
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return match[1]?.trim() || null;
};

const normalizeTokenCandidate = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  // Some cron providers turn "+" into space in query/header text fields.
  return value.trim().replace(/ /g, "+");
};

const sanitizeQuery = (request: NextRequest) => {
  const params = new URLSearchParams(request.nextUrl.searchParams);

  const redactKeys = ["cron_secret", "secret", "token"];
  for (const key of redactKeys) {
    if (params.has(key)) {
      params.set(key, "[REDACTED]");
    }
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : null;
};

const isAuthorized = (request: NextRequest) => {
  const headerToken = normalizeTokenCandidate(getBearerToken(request.headers.get("authorization")));
  const altHeaderToken = normalizeTokenCandidate(request.headers.get("x-cron-secret"));
  const queryToken = normalizeTokenCandidate(
    request.nextUrl.searchParams.get("cron_secret") ??
      request.nextUrl.searchParams.get("secret") ??
      null
  );

  const providedTokens = [headerToken, altHeaderToken, queryToken].filter(
    (token): token is string => Boolean(token)
  );

  if (!providedTokens.length) {
    return false;
  }

  return providedTokens.some((token) => token === serverEnv.CRON_SECRET);
};

const isDirectAutomationMode = () =>
  (process.env.AUTOMATION_DISPATCH_MODE?.trim().toLowerCase() || "direct") === "direct";

const isMissingColumnError = (error: { message?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isMissingAnyColumnError = (error: { message?: string } | null | undefined, columns: string[]) => {
  if (!error) {
    return false;
  }

  return columns.some((column) => isMissingColumnError(error, column));
};

const detectSource = (request: NextRequest) => {
  const explicitSource = request.headers.get("x-listflow-tick-source")?.trim();
  if (explicitSource) {
    return explicitSource.toLowerCase();
  }

  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();

  if (ua.includes("cron-job.org")) {
    return "cron-job.org";
  }

  if (ua.includes("vercel")) {
    return "vercel";
  }

  if (ua.includes("postman")) {
    return "postman";
  }

  if (ua.includes("curl")) {
    return "curl";
  }

  return "unknown";
};

const buildRequestHeaders = (request: NextRequest) => ({
  user_agent: request.headers.get("user-agent"),
  x_forwarded_for: request.headers.get("x-forwarded-for"),
  x_real_ip: request.headers.get("x-real-ip"),
  cf_connecting_ip: request.headers.get("cf-connecting-ip"),
  x_vercel_id: request.headers.get("x-vercel-id"),
  cf_ray: request.headers.get("cf-ray"),
  x_listflow_tick_source: request.headers.get("x-listflow-tick-source"),
  authorization: request.headers.get("authorization") ? "[REDACTED]" : null,
  x_cron_secret: request.headers.get("x-cron-secret") ? "[REDACTED]" : null,
});

const safeSerialize = (payload: unknown) => {
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
};

const insertCronTickLogWithFallback = async (args: {
  request: NextRequest;
  status: number;
  responsePayload: unknown;
  durationMs: number;
  authorized: boolean;
  source: string;
}) => {
  const requestUrl = args.request.nextUrl.pathname;
  const requestHeaders = buildRequestHeaders(args.request);
  const requestBody = {
    method: args.request.method,
    source: args.source,
    authorized: args.authorized,
    query: sanitizeQuery(args.request),
    requested_at: new Date().toISOString(),
  };

  const payloads: Array<Record<string, unknown>> = [
    {
      request_url: requestUrl,
      request_method: "CRON_TICK",
      request_headers: requestHeaders,
      request_body: requestBody,
      response_status: args.status,
      response_body: safeSerialize(args.responsePayload),
      duration_ms: args.durationMs,
      created_by: null,
    },
    {
      request_url: requestUrl,
      request_method: "CRON_TICK",
      request_headers: requestHeaders,
      request_body: requestBody,
      response_status: args.status,
      response_body: safeSerialize(args.responsePayload),
      duration_ms: args.durationMs,
    },
    {
      request_url: requestUrl,
      request_method: "CRON_TICK",
      request_body: requestBody,
      response_status: args.status,
      response_body: safeSerialize(args.responsePayload),
      duration_ms: args.durationMs,
    },
    {
      request_url: requestUrl,
      request_method: "CRON_TICK",
      response_status: args.status,
      response_body: safeSerialize(args.responsePayload),
      duration_ms: args.durationMs,
    },
  ];

  for (const payload of payloads) {
    const attempt = await supabaseAdmin.from("webhook_logs").insert(payload);

    if (!attempt.error) {
      return;
    }

    const toleratedMissingColumns = isMissingAnyColumnError(attempt.error, [
      "request_headers",
      "request_body",
      "response_status",
      "response_body",
      "duration_ms",
      "created_by",
    ]);

    if (!toleratedMissingColumns) {
      return;
    }
  }
};

const runTick = async (request: NextRequest) => {
  const startedAt = Date.now();
  const source = detectSource(request);
  const authorized = isAuthorized(request);

  if (!authorized) {
    const payload = { success: false, error: "Unauthorized", meta: { source } };
    await insertCronTickLogWithFallback({
      request,
      status: 401,
      responsePayload: payload,
      durationMs: Date.now() - startedAt,
      authorized,
      source,
    });
    return NextResponse.json(payload, { status: 401 });
  }

  try {
    const summary = isDirectAutomationMode()
      ? {
          total: 0,
          triggered: 0,
          skipped: 0,
          failed: 0,
          reasonBreakdown: {
            direct_mode_enabled: 1,
          },
        }
      : await runSchedulerTick();
    let cronTestSummary: Awaited<ReturnType<typeof runCronTestTick>> | null = null;
    let cronTestError: string | null = null;

    try {
      cronTestSummary = await runCronTestTick();
    } catch (error) {
      cronTestError = error instanceof Error ? error.message : "Cron test tick failed";
    }

    const payload = {
      success: true,
      summary,
      cronTests: {
        summary: cronTestSummary,
        error: cronTestError,
      },
      meta: { source },
    };
    await insertCronTickLogWithFallback({
      request,
      status: 200,
      responsePayload: payload,
      durationMs: Date.now() - startedAt,
      authorized,
      source,
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduler failed";
    const payload = { success: false, error: message, meta: { source } };
    await insertCronTickLogWithFallback({
      request,
      status: 500,
      responsePayload: payload,
      durationMs: Date.now() - startedAt,
      authorized,
      source,
    });
    return NextResponse.json(payload, { status: 500 });
  }
};

export async function GET(request: NextRequest) {
  return runTick(request);
}

export async function POST(request: NextRequest) {
  return runTick(request);
}
