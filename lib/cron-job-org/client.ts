import { serverEnv } from "@/lib/env/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const CRON_JOB_ORG_BASE_URL = "https://api.cron-job.org";
const LISTFLOW_SCHEDULER_TITLE = "Listflow Scheduler Tick";
const POST_REQUEST_METHOD = 1;

type CronJobSchedule = {
  timezone: string;
  expiresAt: number;
  hours: number[];
  mdays: number[];
  minutes: number[];
  months: number[];
  wdays: number[];
};

type CronJobExtendedData = {
  headers?: Record<string, string>;
  body?: string;
};

type CronJobPayload = {
  enabled: boolean;
  title: string;
  saveResponses: boolean;
  url: string;
  requestMethod: number;
  schedule: CronJobSchedule;
  extendedData: CronJobExtendedData;
};

type CronJobSummary = {
  jobId: number;
  title?: string;
  url?: string;
};

type CronJobListResponse = {
  jobs?: CronJobSummary[];
  someFailed?: boolean;
};

type CronJobCreateResponse = {
  jobId?: number;
};

export type SchedulerCronSyncResult =
  | {
      ok: true;
      status: "created" | "updated" | "deleted" | "noop";
      jobId?: number;
      message: string;
    }
  | {
      ok: false;
      status: "skipped" | "error";
      message: string;
      details?: string;
    };

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

const resolveSchedulerBaseUrl = () => {
  const raw = serverEnv.CRON_SCHEDULER_BASE_URL ?? serverEnv.APP_URL;
  return stripTrailingSlashes(raw);
};

const schedulerTickUrl = () => `${resolveSchedulerBaseUrl()}/api/scheduler/tick`;

const createSchedule = (): CronJobSchedule => ({
  timezone: "UTC",
  expiresAt: 0,
  hours: [-1],
  mdays: [-1],
  minutes: [-1],
  months: [-1],
  wdays: [-1],
});

const createSchedulerJobPayload = (): CronJobPayload => ({
  enabled: true,
  title: LISTFLOW_SCHEDULER_TITLE,
  saveResponses: true,
  url: schedulerTickUrl(),
  requestMethod: POST_REQUEST_METHOD,
  schedule: createSchedule(),
  extendedData: {
    headers: {
      Authorization: `Bearer ${serverEnv.CRON_SECRET}`,
      "Content-Type": "application/json",
    },
  },
});

const isPositiveInteger = (value: string | null) => {
  if (!value) {
    return false;
  }

  return /^\d+$/.test(value.trim());
};

const resolveConfiguredJobId = () => {
  const raw = serverEnv.CRON_JOB_ORG_JOB_ID;
  if (!isPositiveInteger(raw)) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveCronApiKey = () => {
  return serverEnv.CRON_JOB_ORG_API_KEY ?? serverEnv.CRON_SECRET;
};

const isMissingColumnError = (error: { message?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const isMissingTableError = (error: { code?: string | null; message?: string } | null | undefined) => {
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

const parseCronJobApiError = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(text) as { error?: string; message?: string; code?: number };
    return data.error || data.message || `HTTP ${response.status}`;
  } catch {
    return text;
  }
};

const callCronJobOrgApi = async <T>(args: {
  method: "GET" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  apiKey: string;
}) => {
  const response = await fetch(`${CRON_JOB_ORG_BASE_URL}${args.path}`, {
    method: args.method,
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });

  if (!response.ok) {
    const message = await parseCronJobApiError(response);
    throw new Error(message);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
};

const findExistingSchedulerJobId = async (apiKey: string) => {
  const configuredJobId = resolveConfiguredJobId();
  const listResponse = await callCronJobOrgApi<CronJobListResponse>({
    method: "GET",
    path: "/jobs",
    apiKey,
  });

  const jobs = listResponse.jobs ?? [];

  if (configuredJobId !== null) {
    const exactById = jobs.find((job) => job.jobId === configuredJobId);
    if (exactById) {
      return exactById.jobId;
    }
  }

  const targetUrl = schedulerTickUrl();
  const byTitleAndUrl = jobs.find(
    (job) => (job.title ?? "").trim() === LISTFLOW_SCHEDULER_TITLE && (job.url ?? "").trim() === targetUrl
  );

  if (byTitleAndUrl) {
    return byTitleAndUrl.jobId;
  }

  const byUrl = jobs.find((job) => (job.url ?? "").trim() === targetUrl);
  if (byUrl) {
    return byUrl.jobId;
  }

  return null;
};

const loadEnabledWebhookConfigCount = async () => {
  const withEnabled = await supabaseAdmin
    .from("webhook_configs")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);

  if (!withEnabled.error) {
    return withEnabled.count ?? 0;
  }

  if (isMissingTableError(withEnabled.error)) {
    return 0;
  }

  if (!isMissingColumnError(withEnabled.error, "enabled")) {
    throw withEnabled.error;
  }

  const fallbackAll = await supabaseAdmin.from("webhook_configs").select("id", { count: "exact", head: true });
  if (!fallbackAll.error) {
    return fallbackAll.count ?? 0;
  }

  if (isMissingTableError(fallbackAll.error)) {
    return 0;
  }

  throw fallbackAll.error;
};

export const ensureSchedulerCronJob = async (): Promise<SchedulerCronSyncResult> => {
  const apiKey = resolveCronApiKey();

  if (!apiKey) {
    return {
      ok: false,
      status: "skipped",
      message: "Cron API key bulunamadı. Cron senkronu atlandı.",
    };
  }

  const payload = createSchedulerJobPayload();

  try {
    const existingJobId = await findExistingSchedulerJobId(apiKey);

    if (existingJobId !== null) {
      await callCronJobOrgApi<Record<string, never>>({
        method: "PATCH",
        path: `/jobs/${existingJobId}`,
        body: {
          job: payload,
        },
        apiKey,
      });

      return {
        ok: true,
        status: "updated",
        jobId: existingJobId,
        message: `Cron job güncellendi (jobId=${existingJobId}, url=${payload.url}).`,
      };
    }

    const created = await callCronJobOrgApi<CronJobCreateResponse>({
      method: "PUT",
      path: "/jobs",
      body: {
        job: payload,
      },
      apiKey,
    });

    if (!created.jobId || !Number.isFinite(created.jobId)) {
      return {
        ok: false,
        status: "error",
        message: "Cron job oluşturuldu ancak jobId alınamadı.",
      };
    }

    return {
      ok: true,
      status: "created",
      jobId: created.jobId,
      message: `Cron job oluşturuldu (jobId=${created.jobId}, url=${payload.url}).`,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      message: "cron-job.org senkronu başarısız.",
      details: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }
};

export const deleteSchedulerCronJob = async (): Promise<SchedulerCronSyncResult> => {
  const apiKey = resolveCronApiKey();

  if (!apiKey) {
    return {
      ok: false,
      status: "skipped",
      message: "Cron API key bulunamadı. Cron job silme atlandı.",
    };
  }

  try {
    const existingJobId = await findExistingSchedulerJobId(apiKey);
    if (existingJobId === null) {
      return {
        ok: true,
        status: "noop",
        message: "Silinecek scheduler cron job bulunamadı.",
      };
    }

    await callCronJobOrgApi<Record<string, never>>({
      method: "DELETE",
      path: `/jobs/${existingJobId}`,
      apiKey,
    });

    return {
      ok: true,
      status: "deleted",
      jobId: existingJobId,
      message: `Scheduler cron job silindi (jobId=${existingJobId}).`,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      message: "cron-job.org job silme başarısız.",
      details: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }
};

export const syncSchedulerCronJobLifecycle = async (): Promise<SchedulerCronSyncResult> => {
  try {
    const enabledCount = await loadEnabledWebhookConfigCount();
    if (enabledCount > 0) {
      return ensureSchedulerCronJob();
    }

    return deleteSchedulerCronJob();
  } catch (error) {
    return {
      ok: false,
      status: "error",
      message: "Cron lifecycle senkronu başarısız.",
      details: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }
};

