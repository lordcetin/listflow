"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type ExecuteResult = {
  status?: number;
  duration?: number;
  body?: string;
  error?: string;
  savedConfigId?: string | null;
};

type WebhookLogRow = {
  id: string;
  request_url: string | null;
  request_method: string | null;
  response_status: number | null;
  duration_ms: number | null;
  response_body: string | null;
  created_at: string | null;
};

type WebhookConfigRow = {
  id: string;
  name: string;
  description: string | null;
  scope: string | null;
  target_url: string;
  method: string | null;
  enabled: boolean | null;
  product_id: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type TransitionRow = {
  id: string;
  store_id: string | null;
  subscription_id: string | null;
  from_webhook_config_id: string | null;
  to_webhook_config_id: string | null;
  month_index: number | null;
  status: string | null;
  trigger_response_status: number | null;
  trigger_response_body: string | null;
  created_by: string | null;
  created_at: string | null;
};

type SchedulerRow = {
  id: string;
  subscription_id: string | null;
  user_id: string | null;
  store_id: string | null;
  store_name?: string | null;
  webhook_config_id: string | null;
  plan: string | null;
  trigger_type: string | null;
  status: string | null;
  idempotency_key: string | null;
  run_at: string | null;
  response_status: number | null;
  error_message: string | null;
  created_at: string | null;
};

type ProductOption = {
  id: string;
  categoryId: string | null;
  titleTr: string | null;
  titleEn: string | null;
  labelTr: string;
  labelEn: string;
};

type CronTestWebhookRow = {
  id: string;
  name: string;
  target_url: string;
  method: "GET" | "POST";
  enabled: boolean;
  scope: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_run_at: string | null;
  last_response_status: number | null;
  last_response_body: string | null;
  next_run_at: string | null;
};

type DirectCronJobRow = {
  jobId: number;
  enabled: boolean;
  title: string;
  url: string;
  requestMethod: number;
  lastStatus: number | null;
  lastDuration: number | null;
  lastExecution: number | null;
  nextExecution: number | null;
  schedule: {
    timezone: string;
    hours: number[];
    minutes: number[];
  } | null;
  subscriptionId: string | null;
  storeId: string | null;
  webhookConfigId: string | null;
  plan: string | null;
};

type CronTestTriggerResult = {
  ok?: boolean;
  status?: number | null;
  body?: string | null;
  durationMs?: number;
  triggeredAt?: string;
  error?: string;
};

type OverviewResponse = {
  configs?: WebhookConfigRow[];
  logs?: WebhookLogRow[];
  transitions?: TransitionRow[];
  jobs?: SchedulerRow[];
  products?: ProductOption[];
  error?: string;
};

type CronTestListResponse = {
  rows?: CronTestWebhookRow[];
  error?: string;
};

type DirectCronListResponse = {
  rows?: DirectCronJobRow[];
  rateLimited?: boolean;
  message?: string;
  error?: string;
};

type CronSyncResponse = {
  cronSync?: {
    ok: boolean;
    status: "created" | "updated" | "deleted" | "noop" | "skipped" | "error";
    message: string;
    details?: string;
    jobId?: number;
  };
};

type EditState = {
  id: string;
  productId: string;
  targetUrl: string;
  method: "GET" | "POST";
  enabled: boolean;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("tr-TR");
};

const formatUnixDate = (value: number | null | undefined) => {
  if (!value || value <= 0) {
    return "-";
  }

  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("tr-TR");
};

const formatCountdown = (remainingMs: number | null | undefined) => {
  if (remainingMs === null || remainingMs === undefined) {
    return "-";
  }

  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}g ${hours}sa ${minutes}dk ${seconds}sn`;
  }

  if (hours > 0) {
    return `${hours}sa ${minutes}dk ${seconds}sn`;
  }

  return `${minutes}dk ${seconds}sn`;
};

const normalizeHeadersText = (value: string) => {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {} as Record<string, string>;
  }

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!key.trim()) continue;
    if (typeof raw === "string") {
      result[key] = raw;
      continue;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      result[key] = String(raw);
    }
  }
  return result;
};

const buildCronSyncMessage = (
  prefix: string,
  cronSync?: {
    status: "created" | "updated" | "deleted" | "noop" | "skipped" | "error";
    message: string;
    details?: string;
    jobId?: number;
  }
) => {
  if (!cronSync) {
    return prefix;
  }

  if (cronSync.status === "error") {
    return `${prefix} Cron sync hatası: ${cronSync.details || cronSync.message}`;
  }

  if (cronSync.jobId) {
    return `${prefix} ${cronSync.message} (jobId=${cronSync.jobId})`;
  }

  return `${prefix} ${cronSync.message}`;
};

const getStatusVariant = (status: string | null | undefined) => {
  const normalized = (status ?? "").toLowerCase();

  if (normalized === "success" || normalized === "active" || normalized === "paid") {
    return "success" as const;
  }

  if (normalized === "failed" || normalized === "canceled") {
    return "destructive" as const;
  }

  if (normalized === "processing" || normalized === "pending" || normalized === "skipped") {
    return "warning" as const;
  }

  return "secondary" as const;
};

const parseCronTickPayload = (raw: string | null | undefined) => {
  if (!raw) {
    return {
      source: "-",
      triggered: null as number | null,
      skipped: null as number | null,
      failed: null as number | null,
      total: null as number | null,
      cronTestTriggered: null as number | null,
      cronTestSkipped: null as number | null,
      cronTestFailed: null as number | null,
      cronTestError: null as string | null,
      error: null as string | null,
      success: null as boolean | null,
    };
  }

  try {
    const parsed = JSON.parse(raw) as {
      success?: boolean;
      error?: string;
      meta?: { source?: string };
      summary?: { total?: number; triggered?: number; skipped?: number; failed?: number };
      cronTests?: { error?: string | null; summary?: { triggered?: number; skipped?: number; failed?: number } | null };
    };

    return {
      source: parsed.meta?.source || "-",
      triggered: typeof parsed.summary?.triggered === "number" ? parsed.summary.triggered : null,
      skipped: typeof parsed.summary?.skipped === "number" ? parsed.summary.skipped : null,
      failed: typeof parsed.summary?.failed === "number" ? parsed.summary.failed : null,
      total: typeof parsed.summary?.total === "number" ? parsed.summary.total : null,
      cronTestTriggered:
        typeof parsed.cronTests?.summary?.triggered === "number" ? parsed.cronTests.summary.triggered : null,
      cronTestSkipped: typeof parsed.cronTests?.summary?.skipped === "number" ? parsed.cronTests.summary.skipped : null,
      cronTestFailed: typeof parsed.cronTests?.summary?.failed === "number" ? parsed.cronTests.summary.failed : null,
      cronTestError: parsed.cronTests?.error || null,
      error: parsed.error || null,
      success: typeof parsed.success === "boolean" ? parsed.success : null,
    };
  } catch {
    return {
      source: "-",
      triggered: null as number | null,
      skipped: null as number | null,
      failed: null as number | null,
      total: null as number | null,
      cronTestTriggered: null as number | null,
      cronTestSkipped: null as number | null,
      cronTestFailed: null as number | null,
      cronTestError: null as string | null,
      error: raw,
      success: null as boolean | null,
    };
  }
};

export default function AdminWebhookConsolePage() {
  const [configs, setConfigs] = useState<WebhookConfigRow[]>([]);
  const [logs, setLogs] = useState<WebhookLogRow[]>([]);
  const [transitions, setTransitions] = useState<TransitionRow[]>([]);
  const [jobs, setJobs] = useState<SchedulerRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);

  const [executeUrl, setExecuteUrl] = useState("https://httpbin.org/post");
  const [executeMethod, setExecuteMethod] = useState<"GET" | "POST">("POST");
  const [executeHeadersText, setExecuteHeadersText] = useState('{"Content-Type":"application/json"}');
  const [executePayloadText, setExecutePayloadText] = useState('{"client_id":"store-id"}');
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);

  const [createProductId, setCreateProductId] = useState("");
  const [createTargetUrl, setCreateTargetUrl] = useState("");
  const [createMethod, setCreateMethod] = useState<"GET" | "POST">("POST");
  const [testOpen, setTestOpen] = useState(false);
  const [cronTestOpen, setCronTestOpen] = useState(false);
  const [cronTestWebhooks, setCronTestWebhooks] = useState<CronTestWebhookRow[]>([]);
  const [directCronJobs, setDirectCronJobs] = useState<DirectCronJobRow[]>([]);
  const [cronTestName, setCronTestName] = useState("");
  const [cronTestTargetUrl, setCronTestTargetUrl] = useState("");
  const [cronTestMethod, setCronTestMethod] = useState<"GET" | "POST">("POST");
  const [cronTestHeadersText, setCronTestHeadersText] = useState("{}");
  const [cronTestCreating, setCronTestCreating] = useState(false);
  const [cronTestActionLoadingId, setCronTestActionLoadingId] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);

  const [loading, setLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [cronBootstrapLoading, setCronBootstrapLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const directCronLastLoadedAtRef = useRef(0);
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());

  const configMap = useMemo(() => new Map(configs.map((item) => [item.id, item])), [configs]);
  const productMap = useMemo(() => new Map(products.map((item) => [item.id, item])), [products]);

  const loadCronTestWebhooks = useCallback(async () => {
    const response = await fetch("/api/admin/webhooks/cron-tests", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as CronTestListResponse;

    if (!response.ok) {
      throw new Error(payload.error || "Cron test webhook listesi yüklenemedi.");
    }

    setCronTestWebhooks(payload.rows ?? []);
  }, []);

  const loadDirectCronJobs = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force === true;
    const response = await fetch("/api/admin/webhooks/cron/direct-jobs", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as DirectCronListResponse;

    if (!response.ok) {
      throw new Error(payload.error || "Direct cron job listesi yüklenemedi.");
    }

    if (payload.rateLimited) {
      if (payload.message) {
        setInfo((prev) => prev ?? payload.message ?? null);
      }

      if (force && (payload.rows?.length ?? 0) === 0) {
        return;
      }
    }

    if (payload.rows) {
      setDirectCronJobs(payload.rows);
      directCronLastLoadedAtRef.current = Date.now();
    }
  }, []);

  const loadOverview = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;

    if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const shouldLoadDirect = !silent || Date.now() - directCronLastLoadedAtRef.current > 180_000;
      const [overviewResponse] = await Promise.all([
        fetch("/api/admin/webhooks/overview", { cache: "no-store" }),
        loadCronTestWebhooks(),
        shouldLoadDirect ? loadDirectCronJobs({ force: !silent }) : Promise.resolve(),
      ]);
      const payload = (await overviewResponse.json()) as OverviewResponse;

      if (!overviewResponse.ok) {
        throw new Error(payload.error || "Webhook console verileri yüklenemedi.");
      }

      setConfigs(payload.configs ?? []);
      setLogs(payload.logs ?? []);
      setTransitions(payload.transitions ?? []);
      setJobs(payload.jobs ?? []);
      setProducts(payload.products ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Webhook console verileri yüklenemedi.");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [loadCronTestWebhooks, loadDirectCronJobs]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadOverview({ silent: true });
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadOverview]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCountdownNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const runExecute = async () => {
    setExecuteLoading(true);
    setError(null);
    setInfo(null);
    setExecuteResult(null);

    try {
      const headers = normalizeHeadersText(executeHeadersText);
      const payload = executePayloadText.trim() ? (JSON.parse(executePayloadText) as unknown) : {};

      const response = await fetch("/api/admin/webhook-console/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: executeUrl,
          method: executeMethod,
          headers,
          payload,
          saveConfig: false,
        }),
      });

      const data = (await response.json()) as ExecuteResult;

      if (!response.ok) {
        throw new Error(data.error || "Webhook isteği başarısız.");
      }

      setExecuteResult(data);
      setInfo("Webhook isteği çalıştırıldı ve loglandı.");
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Webhook isteği başarısız.");
    } finally {
      setExecuteLoading(false);
    }
  };

  const createConfig = async () => {
    setCreateLoading(true);
    setError(null);
    setInfo(null);

    try {
      if (!createProductId) {
        throw new Error("Alt ürün seçimi zorunlu.");
      }

      const selectedProduct = productMap.get(createProductId);
      if (!selectedProduct) {
        throw new Error("Seçilen alt ürün bulunamadı.");
      }

      if (!createTargetUrl.trim()) {
        throw new Error("Webhook URL zorunlu.");
      }

      const response = await fetch("/api/admin/webhooks/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedProduct.labelTr,
          productId: createProductId,
          targetUrl: createTargetUrl.trim(),
          method: createMethod,
          enabled: true,
          headers: {},
          description: "",
        }),
      });

      const body = (await response.json()) as {
        error?: string;
        directBootstrap?: { attempted: number; success: number; failed: number };
      } & CronSyncResponse;

      if (!response.ok) {
        throw new Error(body.error || "Webhook kaydedilemedi.");
      }

      const bootstrapSummary = body.directBootstrap
        ? ` İlk tetikleme: ${body.directBootstrap.success}/${body.directBootstrap.attempted} başarılı.`
        : "";
      setInfo(`${buildCronSyncMessage("Webhook kaydedildi.", body.cronSync)}${bootstrapSummary}`);
      setCreateTargetUrl("");
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Webhook kaydedilemedi.");
    } finally {
      setCreateLoading(false);
    }
  };

  const createCronTestWebhook = async () => {
    setCronTestCreating(true);
    setError(null);
    setInfo(null);

    try {
      if (!cronTestTargetUrl.trim()) {
        throw new Error("Test webhook URL zorunlu.");
      }

      const headers = normalizeHeadersText(cronTestHeadersText);
      const response = await fetch("/api/admin/webhooks/cron-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cronTestName.trim() || "Webhook",
          targetUrl: cronTestTargetUrl.trim(),
          method: cronTestMethod,
          headers,
          enabled: true,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as { error?: string } & CronSyncResponse;
      if (!response.ok) {
        throw new Error(body.error || "Test webhook oluşturulamadı.");
      }

      setCronTestName("");
      setCronTestTargetUrl("");
      setCronTestMethod("POST");
      setCronTestHeadersText("{}");
      setInfo(buildCronSyncMessage("2 dakikalık test webhook kaydedildi.", body.cronSync));
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test webhook oluşturulamadı.");
    } finally {
      setCronTestCreating(false);
    }
  };

  const patchCronTestWebhook = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      setCronTestActionLoadingId(id);
      setError(null);
      setInfo(null);

      try {
        const response = await fetch(`/api/admin/webhooks/cron-tests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string } & CronSyncResponse;

        if (!response.ok) {
          throw new Error(body.error || "Test webhook güncellenemedi.");
        }

        setInfo(buildCronSyncMessage("Test webhook güncellendi.", body.cronSync));
        await loadOverview();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Test webhook güncellenemedi.");
      } finally {
        setCronTestActionLoadingId(null);
      }
    },
    [loadOverview]
  );

  const deleteCronTestWebhook = useCallback(
    async (id: string) => {
      setCronTestActionLoadingId(id);
      setError(null);
      setInfo(null);

      try {
        const response = await fetch(`/api/admin/webhooks/cron-tests/${id}`, { method: "DELETE" });
        const body = (await response.json().catch(() => ({}))) as { error?: string } & CronSyncResponse;

        if (!response.ok) {
          throw new Error(body.error || "Test webhook silinemedi.");
        }

        setInfo(buildCronSyncMessage("Test webhook silindi.", body.cronSync));
        await loadOverview();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Test webhook silinemedi.");
      } finally {
        setCronTestActionLoadingId(null);
      }
    },
    [loadOverview]
  );

  const triggerCronTestWebhook = useCallback(
    async (id: string) => {
      setCronTestActionLoadingId(id);
      setError(null);
      setInfo(null);

      try {
        const response = await fetch(`/api/admin/webhooks/cron-tests/${id}/trigger`, { method: "POST" });
        const body = (await response.json().catch(() => ({}))) as CronTestTriggerResult;

        if (!response.ok) {
          throw new Error(body.error || "Test webhook tetiklenemedi.");
        }

        const statusText = typeof body.status === "number" ? `HTTP ${body.status}` : "HTTP -";
        setInfo(`Test webhook manuel tetiklendi (${statusText}).`);
        await loadOverview();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Test webhook tetiklenemedi.");
      } finally {
        setCronTestActionLoadingId(null);
      }
    },
    [loadOverview]
  );

  const patchConfig = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      setActionLoadingId(id);
      setError(null);
      setInfo(null);

      try {
        const response = await fetch(`/api/admin/webhooks/configs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });

        const body = (await response.json()) as { error?: string } & CronSyncResponse;

        if (!response.ok) {
          throw new Error(body.error || "Webhook güncellenemedi.");
        }

        setInfo(buildCronSyncMessage("Webhook güncellendi.", body.cronSync));
        await loadOverview();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Webhook güncellenemedi.");
      } finally {
        setActionLoadingId(null);
      }
    },
    [loadOverview]
  );

  const bootstrapCronJob = async () => {
    setCronBootstrapLoading(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch("/api/admin/webhooks/cron/bootstrap", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        message?: string;
        details?: string;
        jobId?: number;
      };

      if (!response.ok) {
        throw new Error(body.details || body.message || "Cron job senkronu başarısız.");
      }

      if (body.jobId) {
        setInfo(`${body.message || "Cron job senkronlandı."} (jobId=${body.jobId})`);
      } else {
        setInfo(body.message || "Cron job senkronlandı.");
      }

      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cron job senkronu başarısız.");
    } finally {
      setCronBootstrapLoading(false);
    }
  };

  const deleteConfig = useCallback(
    async (id: string) => {
      setActionLoadingId(id);
      setError(null);
      setInfo(null);

      try {
        const response = await fetch(`/api/admin/webhooks/configs/${id}`, { method: "DELETE" });
        const body = (await response.json()) as { error?: string } & CronSyncResponse;

        if (!response.ok) {
          throw new Error(body.error || "Webhook silinemedi.");
        }

        setInfo(buildCronSyncMessage("Webhook silindi.", body.cronSync));
        await loadOverview();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Webhook silinemedi.");
      } finally {
        setActionLoadingId(null);
      }
    },
    [loadOverview]
  );

  const openEditDialog = (item: WebhookConfigRow) => {
    setEditState({
      id: item.id,
      productId: item.product_id ?? "",
      targetUrl: item.target_url,
      method: item.method === "GET" ? "GET" : "POST",
      enabled: item.enabled !== false,
    });
    setEditOpen(true);
  };

  const saveEditDialog = async () => {
    if (!editState) return;

    if (!editState.productId) {
      setError("Alt ürün seçimi zorunlu.");
      return;
    }

    if (!editState.targetUrl.trim()) {
      setError("Webhook URL zorunlu.");
      return;
    }

    await patchConfig(editState.id, {
      productId: editState.productId,
      targetUrl: editState.targetUrl.trim(),
      method: editState.method,
      enabled: editState.enabled,
    });

    setEditOpen(false);
    setEditState(null);
  };

  const logColumns = useMemo<ColumnDef<WebhookLogRow>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "Tarih",
        cell: ({ row }) => <span>{formatDate(row.original.created_at)}</span>,
      },
      { accessorKey: "request_method", header: "Method" },
      {
        accessorKey: "request_url",
        header: "URL",
        cell: ({ row }) => <span className="text-xs break-all">{row.original.request_url || "-"}</span>,
      },
      {
        accessorKey: "response_status",
        header: "HTTP",
        cell: ({ row }) => <span>{row.original.response_status ?? "-"}</span>,
      },
      {
        accessorKey: "duration_ms",
        header: "Süre",
        cell: ({ row }) => <span>{row.original.duration_ms ?? 0}ms</span>,
      },
      {
        accessorKey: "response_body",
        header: "Response",
        cell: ({ row }) => (
          <span className="text-xs text-slate-400 break-all">{(row.original.response_body || "-").slice(0, 120)}</span>
        ),
      },
    ],
    []
  );

  const transitionColumns = useMemo<ColumnDef<TransitionRow>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "Tarih",
        cell: ({ row }) => <span>{formatDate(row.original.created_at)}</span>,
      },
      {
        accessorKey: "status",
        header: "Durum",
        cell: ({ row }) => <Badge variant={getStatusVariant(row.original.status)}>{row.original.status || "-"}</Badge>,
      },
      {
        accessorKey: "store_id",
        header: "Mağaza",
        cell: ({ row }) => <span className="text-xs break-all">{row.original.store_id || "-"}</span>,
      },
      {
        accessorKey: "to_webhook_config_id",
        header: "Hedef Webhook",
        cell: ({ row }) => {
          const cfg = row.original.to_webhook_config_id ? configMap.get(row.original.to_webhook_config_id) : null;
          return (
            <div className="space-y-1">
              <p className="text-xs text-slate-200 break-all">{row.original.to_webhook_config_id || "-"}</p>
              <p className="text-xs text-slate-500">{cfg?.name || "-"}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "trigger_response_status",
        header: "HTTP",
        cell: ({ row }) => <span>{row.original.trigger_response_status ?? "-"}</span>,
      },
    ],
    [configMap]
  );

  const jobColumns = useMemo<ColumnDef<SchedulerRow>[]>(
    () => [
      {
        accessorKey: "run_at",
        header: "Çalışma",
        cell: ({ row }) => <span>{formatDate(row.original.run_at || row.original.created_at)}</span>,
      },
      {
        accessorKey: "trigger_type",
        header: "Tetik Tipi",
        cell: ({ row }) => <Badge variant="secondary">{row.original.trigger_type || "scheduled"}</Badge>,
      },
      {
        accessorKey: "status",
        header: "Durum",
        cell: ({ row }) => <Badge variant={getStatusVariant(row.original.status)}>{row.original.status || "-"}</Badge>,
      },
      {
        accessorKey: "store_name",
        header: "Mağaza",
        cell: ({ row }) => <span className="text-xs break-all">{row.original.store_name || "-"}</span>,
      },
      {
        accessorKey: "webhook_config_id",
        header: "Webhook",
        cell: ({ row }) => {
          const cfg = row.original.webhook_config_id ? configMap.get(row.original.webhook_config_id) : null;
          return (
            <div className="space-y-1">
              <p className="text-xs break-all">{row.original.webhook_config_id || "-"}</p>
              <p className="text-xs text-slate-500">{cfg?.name || "-"}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "response_status",
        header: "HTTP",
        cell: ({ row }) => <span>{row.original.response_status ?? "-"}</span>,
      },
      {
        accessorKey: "error_message",
        header: "Hata",
        cell: ({ row }) => <span className="text-xs break-all text-red-300">{row.original.error_message || "-"}</span>,
      },
    ],
    [configMap]
  );

  const schedulerStats = useMemo(() => {
    const total = jobs.length;
    const success = jobs.filter((job) => job.status === "success").length;
    const failed = jobs.filter((job) => job.status === "failed").length;
    const skipped = jobs.filter((job) => job.status === "skipped").length;
    return { total, success, failed, skipped };
  }, [jobs]);

  const cronTickLogs = useMemo(
    () =>
      logs.filter(
        (log) =>
          (log.request_method ?? "").toUpperCase() === "CRON_TICK" ||
          (log.request_url ?? "").includes("/api/scheduler/tick") ||
          (log.request_url ?? "").includes("/api/internal/scheduler/tick")
      ),
    [logs]
  );

  const cronTickStats = useMemo(() => {
    const total = cronTickLogs.length;
    const success = cronTickLogs.filter((row) => {
      const parsed = parseCronTickPayload(row.response_body);
      return parsed.success === true || (row.response_status !== null && row.response_status >= 200 && row.response_status < 300);
    }).length;
    const unauthorized = cronTickLogs.filter((row) => row.response_status === 401).length;
    const failed = cronTickLogs.filter((row) => {
      if (row.response_status === null) return true;
      return row.response_status >= 400 && row.response_status !== 401;
    }).length;
    const lastRunAt = cronTickLogs[0]?.created_at ?? null;

    return { total, success, unauthorized, failed, lastRunAt };
  }, [cronTickLogs]);

  const cronTickColumns = useMemo<ColumnDef<WebhookLogRow>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "Tarih",
        cell: ({ row }) => <span>{formatDate(row.original.created_at)}</span>,
      },
      {
        accessorKey: "response_body",
        header: "Kaynak",
        cell: ({ row }) => {
          const parsed = parseCronTickPayload(row.original.response_body);
          return <Badge variant="secondary">{parsed.source}</Badge>;
        },
      },
      {
        accessorKey: "response_status",
        header: "HTTP",
        cell: ({ row }) => {
          const status = row.original.response_status;
          if (status === null) return "-";
          return <Badge variant={status >= 200 && status < 300 ? "success" : status === 401 ? "warning" : "destructive"}>{status}</Badge>;
        },
      },
      {
        accessorKey: "duration_ms",
        header: "Süre",
        cell: ({ row }) => <span>{row.original.duration_ms ?? 0}ms</span>,
      },
      {
        accessorKey: "summary",
        header: "Scheduler Özeti",
        cell: ({ row }) => {
          const parsed = parseCronTickPayload(row.original.response_body);
          if (parsed.total === null) {
            return <span className="text-xs text-slate-500">-</span>;
          }

          return (
            <div className="text-xs text-slate-200 space-y-1">
              <p>scheduler total: {parsed.total}, ok: {parsed.triggered ?? 0}, skipped: {parsed.skipped ?? 0}, failed: {parsed.failed ?? 0}</p>
              <p>cron-test ok: {parsed.cronTestTriggered ?? 0}, skipped: {parsed.cronTestSkipped ?? 0}, failed: {parsed.cronTestFailed ?? 0}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "error",
        header: "Hata",
        cell: ({ row }) => {
          const parsed = parseCronTickPayload(row.original.response_body);
          return <span className="text-xs text-red-300 break-all">{parsed.error || parsed.cronTestError || "-"}</span>;
        },
      },
    ],
    []
  );

  const cronTickHealth = useMemo(() => {
    if (!cronTickStats.lastRunAt) {
      return { state: "critical" as const, label: "Cron Tick yok" };
    }

    const lastRunMs = new Date(cronTickStats.lastRunAt).getTime();
    if (Number.isNaN(lastRunMs)) {
      return { state: "critical" as const, label: "Cron Tick zamanı okunamadı" };
    }

    const diffMinutes = Math.floor((Date.now() - lastRunMs) / 60_000);
    if (diffMinutes >= 3) {
      return { state: "warning" as const, label: `Cron gecikmeli (${diffMinutes} dk)` };
    }

    return { state: "healthy" as const, label: "Cron aktif" };
  }, [cronTickStats.lastRunAt]);

  const cronTestStats = useMemo(() => {
    const total = cronTestWebhooks.length;
    const enabled = cronTestWebhooks.filter((item) => item.enabled).length;
    const lastRunAt = cronTestWebhooks
      .map((item) => item.last_run_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    return { total, enabled, lastRunAt };
  }, [cronTestWebhooks]);

  const cronTestLogs = useMemo(
    () =>
      logs.filter((log) => {
        const method = (log.request_method ?? "").toUpperCase();
        return method === "CRON_TEST" || method === "CRON_TEST_MANUAL";
      }),
    [logs]
  );

  const cronTestLogStats = useMemo(() => {
    const total = cronTestLogs.length;
    const success = cronTestLogs.filter((row) => row.response_status !== null && row.response_status >= 200 && row.response_status < 300).length;
    const failed = cronTestLogs.filter((row) => row.response_status === null || row.response_status >= 400).length;
    const lastRunAt = cronTestLogs[0]?.created_at ?? null;
    return { total, success, failed, lastRunAt };
  }, [cronTestLogs]);

  const cronTestColumns = useMemo<ColumnDef<CronTestWebhookRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Test Webhook",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="font-black text-white">{row.original.name || "-"}</p>
            <p className="text-xs text-slate-500">{row.original.id}</p>
          </div>
        ),
      },
      {
        accessorKey: "target_url",
        header: "URL",
        cell: ({ row }) => <span className="text-xs break-all">{row.original.target_url}</span>,
      },
      {
        accessorKey: "method",
        header: "Method",
      },
      {
        accessorKey: "enabled",
        header: "Durum",
        cell: ({ row }) => <Badge variant={row.original.enabled ? "success" : "secondary"}>{row.original.enabled ? "Aktif" : "Pasif"}</Badge>,
      },
      {
        accessorKey: "last_run_at",
        header: "Son Test",
        cell: ({ row }) => <span>{formatDate(row.original.last_run_at)}</span>,
      },
      {
        accessorKey: "next_run_at",
        header: "Sonraki Test",
        cell: ({ row }) => <span>{formatDate(row.original.next_run_at)}</span>,
      },
      {
        accessorKey: "last_response_status",
        header: "Son HTTP",
        cell: ({ row }) => <span>{row.original.last_response_status ?? "-"}</span>,
      },
      {
        id: "actions",
        header: "Aksiyon",
        cell: ({ row }) => {
          const item = row.original;
          const loadingThis = cronTestActionLoadingId === item.id;
          return (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                disabled={loadingThis}
                onClick={() => void triggerCronTestWebhook(item.id)}
              >
                Şimdi Test Et
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                disabled={loadingThis}
                onClick={() => void patchCronTestWebhook(item.id, { enabled: !item.enabled })}
              >
                {item.enabled ? "Pasifleştir" : "Aktifleştir"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="cursor-pointer"
                disabled={loadingThis}
                onClick={() => void deleteCronTestWebhook(item.id)}
              >
                Sil
              </Button>
            </div>
          );
        },
      },
    ],
    [cronTestActionLoadingId, deleteCronTestWebhook, patchCronTestWebhook, triggerCronTestWebhook]
  );

  const cronTestLogColumns = useMemo<ColumnDef<WebhookLogRow>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "Tarih",
        cell: ({ row }) => <span>{formatDate(row.original.created_at)}</span>,
      },
      {
        accessorKey: "request_method",
        header: "Tip",
      },
      {
        accessorKey: "request_url",
        header: "URL",
        cell: ({ row }) => <span className="text-xs break-all">{row.original.request_url || "-"}</span>,
      },
      {
        accessorKey: "response_status",
        header: "HTTP",
        cell: ({ row }) => <span>{row.original.response_status ?? "-"}</span>,
      },
      {
        accessorKey: "duration_ms",
        header: "Süre",
        cell: ({ row }) => <span>{row.original.duration_ms ?? 0}ms</span>,
      },
      {
        accessorKey: "response_body",
        header: "Response",
        cell: ({ row }) => <span className="text-xs break-all text-slate-400">{(row.original.response_body || "-").slice(0, 120)}</span>,
      },
    ],
    []
  );

  const nextExecutionByWebhookConfigId = useMemo(() => {
    const map = new Map<string, number>();

    for (const row of directCronJobs) {
      if (!row.enabled) {
        continue;
      }

      if (!row.webhookConfigId) {
        continue;
      }

      if (!row.nextExecution || row.nextExecution <= 0) {
        continue;
      }

      const nextExecutionMs = row.nextExecution * 1000;
      const current = map.get(row.webhookConfigId);
      if (current === undefined || nextExecutionMs < current) {
        map.set(row.webhookConfigId, nextExecutionMs);
      }
    }

    return map;
  }, [directCronJobs]);

  const storeNameById = useMemo(
    () =>
      new Map(
        jobs
          .filter((row) => Boolean(row.store_id))
          .map((row) => [row.store_id as string, row.store_name || row.store_id || "-"])
      ),
    [jobs]
  );

  const directCronStats = useMemo(() => {
    const total = directCronJobs.length;
    const enabled = directCronJobs.filter((row) => row.enabled).length;
    const neverRun = directCronJobs.filter((row) => !row.lastExecution || row.lastExecution <= 0).length;
    const failed = directCronJobs.filter((row) => row.lastStatus !== null && row.lastStatus !== 1 && row.lastStatus !== 0).length;
    const nextRunAt = directCronJobs
      .map((row) => row.nextExecution ?? 0)
      .filter((value) => value > 0)
      .sort((a, b) => a - b)[0] ?? null;

    return {
      total,
      enabled,
      neverRun,
      failed,
      nextRunAt,
    };
  }, [directCronJobs]);

  const directCronColumns = useMemo<ColumnDef<DirectCronJobRow>[]>(
    () => [
      {
        accessorKey: "jobId",
        header: "Job",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="font-black text-white">#{row.original.jobId}</p>
            <p className="text-xs text-slate-500 break-all">{row.original.title}</p>
          </div>
        ),
      },
      {
        accessorKey: "storeId",
        header: "Mağaza",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="text-xs text-slate-200 break-all">{row.original.storeId || "-"}</p>
            <p className="text-xs text-slate-500">{(row.original.storeId && storeNameById.get(row.original.storeId)) || "-"}</p>
          </div>
        ),
      },
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ row }) => <Badge variant="secondary">{(row.original.plan || "-").toUpperCase()}</Badge>,
      },
      {
        accessorKey: "webhookConfigId",
        header: "Webhook",
        cell: ({ row }) => {
          const cfg = row.original.webhookConfigId ? configMap.get(row.original.webhookConfigId) : null;
          return (
            <div className="space-y-1">
              <p className="text-xs break-all">{row.original.webhookConfigId || "-"}</p>
              <p className="text-xs text-slate-500">{cfg?.name || "-"}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "url",
        header: "Target URL",
        cell: ({ row }) => <span className="text-xs break-all">{row.original.url || "-"}</span>,
      },
      {
        accessorKey: "nextExecution",
        header: "Sonraki Çalışma",
        cell: ({ row }) => <span>{formatUnixDate(row.original.nextExecution)}</span>,
      },
      {
        accessorKey: "lastExecution",
        header: "Son Çalışma",
        cell: ({ row }) => <span>{formatUnixDate(row.original.lastExecution)}</span>,
      },
      {
        accessorKey: "lastStatus",
        header: "Son Durum",
        cell: ({ row }) => {
          const status = row.original.lastStatus;
          const label = status === 1 ? "OK" : status === 0 ? "Bekliyor" : `Hata (${status ?? "-"})`;
          const variant = status === 1 ? "success" : status === 0 ? "warning" : "destructive";
          return <Badge variant={variant}>{label}</Badge>;
        },
      },
    ],
    [configMap, storeNameById]
  );

  const configColumns = useMemo<ColumnDef<WebhookConfigRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Webhook Başlığı",
        cell: ({ row }) => {
          const product = row.original.product_id ? productMap.get(row.original.product_id) : null;
          return (
            <div className="space-y-1">
              <p className="font-black text-white">{product?.labelTr || row.original.name || "-"}</p>
              <p className="text-xs text-slate-500">{row.original.product_id || "Alt ürün bağlı değil"}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "target_url",
        header: "Webhook URL",
        cell: ({ row }) => <span className="text-xs break-all">{row.original.target_url}</span>,
      },
      {
        accessorKey: "method",
        header: "Method",
      },
      {
        accessorKey: "enabled",
        header: "Durum",
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? "success" : "secondary"}>{row.original.enabled ? "Aktif" : "Pasif"}</Badge>
        ),
      },
      {
        id: "next_upload_countdown",
        header: "Sonraki Yükleme",
        cell: ({ row }) => {
          if (!row.original.enabled) {
            return <Badge variant="secondary">Pasif</Badge>;
          }

          const nextExecutionMs = nextExecutionByWebhookConfigId.get(row.original.id) ?? null;
          if (!nextExecutionMs) {
            return <span className="text-xs text-slate-500">Planlı job yok</span>;
          }

          const remainingMs = nextExecutionMs - countdownNowMs;
          return (
            <div className="space-y-1">
              <p className={`text-xs font-semibold ${remainingMs <= 0 ? "text-emerald-300" : "text-slate-100"}`}>
                {formatCountdown(remainingMs)}
              </p>
              <p className="text-xs text-slate-500">{new Date(nextExecutionMs).toLocaleString("tr-TR")}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "updated_at",
        header: "Güncellendi",
        cell: ({ row }) => <span>{formatDate(row.original.updated_at || row.original.created_at)}</span>,
      },
      {
        id: "actions",
        header: "Aksiyon",
        cell: ({ row }) => {
          const item = row.original;
          const loadingThis = actionLoadingId === item.id;
          return (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                disabled={loadingThis}
                onClick={() => openEditDialog(item)}
              >
                Düzenle
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                disabled={loadingThis}
                onClick={() =>
                  void patchConfig(item.id, {
                    enabled: !(item.enabled !== false),
                  })
                }
              >
                {item.enabled ? "Pasifleştir" : "Aktifleştir"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="cursor-pointer"
                disabled={loadingThis}
                onClick={() => void deleteConfig(item.id)}
              >
                Sil
              </Button>
            </div>
          );
        },
      },
    ],
    [actionLoadingId, countdownNowMs, deleteConfig, nextExecutionByWebhookConfigId, patchConfig, productMap]
  );
  return (
    <div className="space-y-6">
      <Card className="glass-card-pro rounded-[32px]">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <Badge>Webhook Console</Badge>
                <Badge variant="secondary">TEK MERKEZ</Badge>
              </div>
              <CardTitle className="mt-2">Webhook Console</CardTitle>
              <CardDescription>
                Webhook oluşturma, test etme, log izleme ve düzenleme tek ekrandan yapılır.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="cursor-pointer" onClick={() => setTestOpen(true)}>
                Webhook Test
              </Button>
              <Button
                variant="outline"
                className="cursor-pointer"
                onClick={() => void bootstrapCronJob()}
                disabled={cronBootstrapLoading}
              >
                {cronBootstrapLoading ? "Senkron..." : "Cron Sync"}
              </Button>
              <Button variant="secondary" className="cursor-pointer" onClick={() => void loadOverview()} disabled={loading}>
                Yenile
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Hata</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {info ? (
            <Alert variant="success">
              <AlertTitle>Bilgi</AlertTitle>
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs defaultValue="console" className="space-y-4">
            <TabsList>
              <TabsTrigger value="console">Console</TabsTrigger>
              <TabsTrigger value="transitions">Geçiş Logları</TabsTrigger>
              <TabsTrigger value="scheduler">Zamanlayıcı</TabsTrigger>
              <TabsTrigger value="direct-cron">Direct Cron Jobs</TabsTrigger>
              <TabsTrigger value="cron">Cron Tick</TabsTrigger>
            </TabsList>

            <TabsContent value="console" className="space-y-4">
              <Card className="rounded-2xl">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base">Webhook Oluştur</CardTitle>
                  <CardDescription>
                    Alt ürün seç, webhook URL gir, method belirle (varsayılan POST) ve kaydet.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Select value={createProductId} onChange={(event) => setCreateProductId(event.target.value)}>
                      <option value="">Alt ürün seçin</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.labelTr || product.titleTr || product.id}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={createTargetUrl}
                      onChange={(event) => setCreateTargetUrl(event.target.value)}
                      placeholder="https://n8n.example/webhook/..."
                    />
                    <Select value={createMethod} onChange={(event) => setCreateMethod(event.target.value as "GET" | "POST")}>
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                    </Select>
                  </div>

                  <div className="flex justify-end">
                    <Button className="cursor-pointer" onClick={() => void createConfig()} disabled={createLoading}>
                      {createLoading ? "Kaydediliyor..." : "Webhook Kaydet"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base">Kayıtlı Webhooklar</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <DataTable
                    columns={configColumns}
                    data={configs}
                    searchPlaceholder="Webhook ara..."
                    pageSize={8}
                    dateFilterKey="updated_at"
                    dateFilterLabel="Webhook Güncelleme"
                  />
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base">Webhook Logları</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <DataTable
                    columns={logColumns}
                    data={logs}
                    searchPlaceholder="Log ara..."
                    pageSize={10}
                    dateFilterKey="created_at"
                    dateFilterLabel="Log Tarihi"
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="transitions">
              <DataTable
                columns={transitionColumns}
                data={transitions}
                searchPlaceholder="Geçiş logu ara..."
                pageSize={10}
                statusFilterKey="status"
                dateFilterKey="created_at"
                dateFilterLabel="Geçiş Tarihi"
              />
            </TabsContent>

            <TabsContent value="scheduler" className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Toplam: {schedulerStats.total}</Badge>
                <Badge variant="success">Başarılı: {schedulerStats.success}</Badge>
                <Badge variant="warning">Atlanan: {schedulerStats.skipped}</Badge>
                <Badge variant="destructive">Hata: {schedulerStats.failed}</Badge>
              </div>
              <DataTable
                columns={jobColumns}
                data={jobs}
                searchPlaceholder="Job ara..."
                pageSize={10}
                statusFilterKey="status"
                dateFilterKey="run_at"
                dateFilterLabel="Çalışma Tarihi"
              />
            </TabsContent>

            <TabsContent value="direct-cron" className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Toplam Job: {directCronStats.total}</Badge>
                <Badge variant="success">Aktif: {directCronStats.enabled}</Badge>
                <Badge variant="warning">Henüz Çalışmamış: {directCronStats.neverRun}</Badge>
                <Badge variant="destructive">Son Durum Hatalı: {directCronStats.failed}</Badge>
                <Badge variant="outline">En Yakın Çalışma: {formatUnixDate(directCronStats.nextRunAt)}</Badge>
              </div>

              <DataTable
                columns={directCronColumns}
                data={directCronJobs}
                searchPlaceholder="Direct cron job ara..."
                pageSize={10}
              />
            </TabsContent>

            <TabsContent value="cron" className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Toplam Tick: {cronTickStats.total}</Badge>
                <Badge variant="success">200 OK: {cronTickStats.success}</Badge>
                <Badge variant="warning">401 Yetkisiz: {cronTickStats.unauthorized}</Badge>
                <Badge variant="destructive">Hata: {cronTickStats.failed}</Badge>
                <Badge variant="outline">Son Tick: {formatDate(cronTickStats.lastRunAt)}</Badge>
                <Badge
                  variant={
                    cronTickHealth.state === "healthy"
                      ? "success"
                      : cronTickHealth.state === "warning"
                        ? "warning"
                        : "destructive"
                  }
                >
                  {cronTickHealth.label}
                </Badge>
                <Badge variant="secondary">2DK Test Webhook: {cronTestStats.total}</Badge>
                <Badge variant="success">2DK Test Aktif: {cronTestStats.enabled}</Badge>
                <Badge variant="outline">2DK Son Test: {formatDate(cronTestStats.lastRunAt)}</Badge>
              </div>

              <div className="flex justify-end">
                <Button variant="outline" className="cursor-pointer" onClick={() => setCronTestOpen(true)}>
                  2 Dakika Test Paneli
                </Button>
              </div>

              <Card className="rounded-2xl">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base">Cron Tick Logları</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <DataTable
                    columns={cronTickColumns}
                    data={cronTickLogs}
                    searchPlaceholder="Cron tick log ara..."
                    pageSize={10}
                    dateFilterKey="created_at"
                    dateFilterLabel="Tick Tarihi"
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={cronTestOpen} onOpenChange={setCronTestOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>2 Dakika Test Webhook Paneli</DialogTitle>
            <DialogDescription>
              Bu panel yalnızca cron testleri içindir. Her cron tick çağrısında due olan test webhooklar 2 dakikalık periyotla otomatik tetiklenir.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Card className="rounded-2xl">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Test Webhook Ekle</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Input
                    value={cronTestName}
                    onChange={(event) => setCronTestName(event.target.value)}
                    placeholder="Test adı (örn: n8n smoke test)"
                  />
                  <Input
                    value={cronTestTargetUrl}
                    onChange={(event) => setCronTestTargetUrl(event.target.value)}
                    placeholder="https://n8n.example/webhook/..."
                  />
                  <Select value={cronTestMethod} onChange={(event) => setCronTestMethod(event.target.value as "GET" | "POST")}>
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                  </Select>
                </div>
                <Textarea
                  value={cronTestHeadersText}
                  onChange={(event) => setCronTestHeadersText(event.target.value)}
                  rows={3}
                  placeholder='{"Authorization":"Bearer ..."}'
                />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">Test webhook: {cronTestStats.total}</Badge>
                    <Badge variant="success">Aktif: {cronTestStats.enabled}</Badge>
                    <Badge variant="outline">Son test: {formatDate(cronTestStats.lastRunAt)}</Badge>
                  </div>
                  <Button className="cursor-pointer" onClick={() => void createCronTestWebhook()} disabled={cronTestCreating}>
                    {cronTestCreating ? "Kaydediliyor..." : "2 Dakika Test Webhook Ekle"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Kayıtlı Test Webhooklar</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <DataTable
                  columns={cronTestColumns}
                  data={cronTestWebhooks}
                  searchPlaceholder="Test webhook ara..."
                  pageSize={8}
                  dateFilterKey="updated_at"
                  dateFilterLabel="Güncelleme Tarihi"
                />
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Cron Test Logları</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Toplam: {cronTestLogStats.total}</Badge>
                  <Badge variant="success">Başarılı: {cronTestLogStats.success}</Badge>
                  <Badge variant="destructive">Hata: {cronTestLogStats.failed}</Badge>
                  <Badge variant="outline">Son Çalışma: {formatDate(cronTestLogStats.lastRunAt)}</Badge>
                </div>
                <DataTable
                  columns={cronTestLogColumns}
                  data={cronTestLogs}
                  searchPlaceholder="Cron test log ara..."
                  pageSize={10}
                  dateFilterKey="created_at"
                  dateFilterLabel="Test Tarihi"
                />
              </CardContent>
            </Card>
          </div>

          <DialogFooter>
            <Button variant="secondary" className="cursor-pointer" onClick={() => setCronTestOpen(false)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook Düzenle</DialogTitle>
            <DialogDescription>Alt ürün, URL, method ve durum alanlarını güncelleyebilirsin.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Select
              value={editState?.productId || ""}
              onChange={(event) =>
                setEditState((prev) => (prev ? { ...prev, productId: event.target.value } : prev))
              }
            >
              <option value="">Alt ürün seçin</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.labelTr || product.titleTr || product.id}
                </option>
              ))}
            </Select>

            <Input
              value={editState?.targetUrl || ""}
              onChange={(event) =>
                setEditState((prev) => (prev ? { ...prev, targetUrl: event.target.value } : prev))
              }
              placeholder="https://..."
            />

            <Select
              value={editState?.method || "POST"}
              onChange={(event) =>
                setEditState((prev) =>
                  prev ? { ...prev, method: event.target.value === "GET" ? "GET" : "POST" } : prev
                )
              }
            >
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </Select>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(editState?.enabled)}
                onChange={(event) =>
                  setEditState((prev) => (prev ? { ...prev, enabled: event.target.checked } : prev))
                }
                className="accent-indigo-500"
              />
              Aktif
            </label>
          </div>

          <DialogFooter>
            <Button variant="secondary" className="cursor-pointer" onClick={() => setEditOpen(false)}>
              İptal
            </Button>
            <Button className="cursor-pointer" onClick={() => void saveEditDialog()} disabled={Boolean(actionLoadingId)}>
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Webhook Test</DialogTitle>
            <DialogDescription>Manuel istek atıp response, method, süre ve HTTP durumunu loglarda kontrol et.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <Input value={executeUrl} onChange={(event) => setExecuteUrl(event.target.value)} placeholder="https://..." />
              </div>
              <Select value={executeMethod} onChange={(event) => setExecuteMethod(event.target.value as "GET" | "POST")}>
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </Select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Textarea value={executeHeadersText} onChange={(event) => setExecuteHeadersText(event.target.value)} rows={6} />
              <Textarea value={executePayloadText} onChange={(event) => setExecutePayloadText(event.target.value)} rows={6} />
            </div>

            {executeResult ? (
              <Alert variant={executeResult.status && executeResult.status < 400 ? "success" : "destructive"}>
                <AlertTitle>Test Sonucu</AlertTitle>
                <AlertDescription>
                  <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(executeResult, null, 2)}</pre>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="secondary" className="cursor-pointer" onClick={() => setTestOpen(false)}>
              Kapat
            </Button>
            <Button className="cursor-pointer" onClick={() => void runExecute()} disabled={executeLoading}>
              {executeLoading ? "Çalıştırılıyor..." : "İstek Çalıştır"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
