"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type LastTrigger = {
  status: string | null;
  triggerType: string | null;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: string | null;
  webhookConfigId: string | null;
};

type AutomationOverviewRow = {
  storeId: string;
  storeName: string;
  storeStatus: string;
  category: string | null;
  productId: string | null;
  productLabel: string | null;
  eligibleWebhookConfigIds: string[];
  userId: string;
  userLabel: string;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  plan: string | null;
  currentPeriodEnd: string | null;
  monthIndex: number;
  canSwitch: boolean;
  minMonthRequired: number;
  eligibilityReason: string | null;
  activeWebhookConfigId: string | null;
  activeWebhookName: string | null;
  automationUpdatedAt: string | null;
  cadenceHours: number | null;
  nextTriggerAt: string | null;
  lastTrigger: LastTrigger | null;
};

type WebhookOption = {
  id: string;
  name: string;
  description: string | null;
  targetUrl: string;
  method: string | null;
  enabled: boolean;
  productId: string | null;
  productLabel?: string | null;
};

type AutomationOverviewResponse = {
  rows?: AutomationOverviewRow[];
  webhookOptions?: WebhookOption[];
  error?: string;
};

type SwitchResponse = {
  success?: boolean;
  code?: string;
  message?: string;
  error?: string;
};

type TableRow = AutomationOverviewRow & {
  selectedWebhookConfigId: string;
  availableWebhookOptions: WebhookOption[];
};

const PLAN_LABELS: Record<string, string> = {
  standard: "Standard",
  pro: "Pro",
  turbo: "Turbo",
};

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("tr-TR");
};

const formatCountdown = (targetIso: string | null | undefined, nowMs: number) => {
  if (!targetIso) {
    return "-";
  }

  const targetMs = new Date(targetIso).getTime();
  if (!Number.isFinite(targetMs)) {
    return "-";
  }

  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) {
    return "Şimdi";
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}g ${String(hours).padStart(2, "0")}s ${String(minutes).padStart(2, "0")}d ${String(seconds).padStart(2, "0")}sn`;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

type NextTriggerCountdownProps = {
  hasSubscription: boolean;
  targetIso: string | null;
  cadenceHours: number | null;
};

function NextTriggerCountdown({ hasSubscription, targetIso, cadenceHours }: NextTriggerCountdownProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  if (!hasSubscription) {
    return <span className="text-xs text-slate-500">Aktif abonelik yok</span>;
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-black text-white">{formatCountdown(targetIso, nowMs)}</p>
      <p className="text-xs text-slate-500">
        {targetIso ? formatDate(targetIso) : "-"} {cadenceHours ? `(her ${cadenceHours} saat)` : ""}
      </p>
    </div>
  );
}

const getStatusVariant = (status: string | null | undefined) => {
  const normalized = (status ?? "").toLowerCase();

  if (normalized === "active" || normalized === "success" || normalized === "paid" || normalized === "trialing") {
    return "success" as const;
  }

  if (normalized === "failed" || normalized === "canceled" || normalized === "unpaid") {
    return "destructive" as const;
  }

  if (normalized === "skipped" || normalized === "pending") {
    return "warning" as const;
  }

  return "secondary" as const;
};

const formatErrorMessage = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  if (value === "no_active_webhook_config") {
    return "Aktif webhook atanmamış.";
  }

  if (value === "inactive_or_invalid_webhook_config") {
    return "Webhook pasif veya geçersiz.";
  }

  return value;
};

export default function AdminStoresPage() {
  const [rows, setRows] = useState<AutomationOverviewRow[]>([]);
  const [webhookOptions, setWebhookOptions] = useState<WebhookOption[]>([]);
  const [selectedWebhookByStore, setSelectedWebhookByStore] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [switchingStoreId, setSwitchingStoreId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedStoreId, setCopiedStoreId] = useState<string | null>(null);

  const webhookMap = useMemo(() => new Map(webhookOptions.map((item) => [item.id, item])), [webhookOptions]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/stores/automation-overview", { cache: "no-store" });
      const payload = (await response.json()) as AutomationOverviewResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Automation overview yüklenemedi.");
      }

      const nextRows = payload.rows ?? [];
      const nextWebhookOptions = payload.webhookOptions ?? [];
      setRows(nextRows);
      setWebhookOptions(nextWebhookOptions);

      setSelectedWebhookByStore((prev) => {
        const next = { ...prev };

        for (const row of nextRows) {
          const eligibleWebhookIds = (row.eligibleWebhookConfigIds ?? []).filter((id) =>
            nextWebhookOptions.some((option) => option.id === id)
          );
          const selectedCurrent = next[row.storeId];
          const hasSelectedStillValid = eligibleWebhookIds.includes(selectedCurrent);
          const defaultTarget =
            row.activeWebhookConfigId && eligibleWebhookIds.includes(row.activeWebhookConfigId)
              ? row.activeWebhookConfigId
              : eligibleWebhookIds[0] ?? "";

          next[row.storeId] = hasSelectedStillValid ? selectedCurrent : defaultTarget;
        }

        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Automation overview yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const runSwitch = useCallback(
    async (store: AutomationOverviewRow) => {
      const rowWithSelection = store as AutomationOverviewRow & { selectedWebhookConfigId?: string };
      const targetWebhookConfigId = rowWithSelection.selectedWebhookConfigId ?? selectedWebhookByStore[store.storeId];

      if (!targetWebhookConfigId) {
        setError("Önce hedef webhook seçmelisin.");
        return;
      }

      setSwitchingStoreId(store.storeId);
      setError(null);
      setSuccessMessage(null);

      try {
        const response = await fetch(`/api/admin/stores/${store.storeId}/automation-switch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ targetWebhookConfigId }),
        });

        const payload = (await response.json()) as SwitchResponse;

        if (!response.ok) {
          throw new Error(payload.message || payload.error || "Geçiş işlemi başarısız.");
        }

        const webhookName = webhookMap.get(targetWebhookConfigId)?.name ?? "hedef webhook";
        setSuccessMessage(`${store.storeName} için ${webhookName} otomasyonu tetiklendi.`);
        await loadOverview();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Geçiş işlemi başarısız.");
      } finally {
        setSwitchingStoreId(null);
      }
    },
    [loadOverview, selectedWebhookByStore, webhookMap]
  );

  const tableRows = useMemo<TableRow[]>(() => {
    return rows.map((row) => {
      const eligibleIds = row.eligibleWebhookConfigIds ?? [];
      const strictOptions = webhookOptions.filter((option) =>
        eligibleIds.includes(option.id)
      );
      const fallbackOptions = strictOptions.length
        ? strictOptions
        : webhookOptions;

      const selectedCurrent = selectedWebhookByStore[row.storeId] ?? "";
      const selectedWebhookConfigId = fallbackOptions.some((option) => option.id === selectedCurrent)
        ? selectedCurrent
        : fallbackOptions[0]?.id ?? "";

      return {
        ...row,
        selectedWebhookConfigId,
        availableWebhookOptions: fallbackOptions,
      };
    });
  }, [rows, selectedWebhookByStore, webhookOptions]);

  const handleCopyStoreId = useCallback(async (storeId: string) => {
    try {
      await navigator.clipboard.writeText(storeId);
      setCopiedStoreId(storeId);
      window.setTimeout(() => {
        setCopiedStoreId((prev) => (prev === storeId ? null : prev));
      }, 1200);
    } catch {
      // no-op
    }
  }, []);

  const columns = useMemo<ColumnDef<TableRow>[]>(
    () => [
      {
        accessorKey: "storeName",
        header: "Mağaza",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="rounded bg-white/5 px-2 py-1 text-[11px] font-black text-indigo-200">{item.storeId}</code>
                <button
                  type="button"
                  onClick={() => void handleCopyStoreId(item.storeId)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/15 bg-white/5 text-slate-300 hover:text-white cursor-pointer"
                  title="Store ID kopyala"
                >
                  {copiedStoreId === item.storeId ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="font-black text-white">{item.storeName}</p>
              <div className="flex items-center gap-2">
                <Badge variant={getStatusVariant(item.storeStatus)}>{item.storeStatus}</Badge>
                <span className="text-xs text-slate-500">{item.category || "-"}</span>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "userLabel",
        header: "Kullanıcı",
      },
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="space-y-1">
              <Badge variant={getStatusVariant(item.subscriptionStatus)}>{item.subscriptionStatus || "-"}</Badge>
              <p className="text-xs text-slate-400">{item.plan ? PLAN_LABELS[item.plan] ?? item.plan : "-"}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "monthIndex",
        header: "Ay",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="space-y-1">
              <p className="text-sm font-black text-white">{item.monthIndex}. Ay</p>
              <p className="text-xs text-slate-500">Dönem sonu: {formatDate(item.currentPeriodEnd)}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "activeWebhookName",
        header: "Mevcut Otomasyon",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="space-y-1">
              <p className="text-xs text-slate-200">{item.activeWebhookName || "-"}</p>
              <p className="text-xs text-slate-500">Güncelleme: {formatDate(item.automationUpdatedAt)}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "lastTrigger",
        header: "Son Tetik",
        cell: ({ row }) => {
          const trigger = row.original.lastTrigger;

          if (!trigger) {
            return <span className="text-xs text-slate-500">Henüz job yok</span>;
          }

          return (
            <div className="space-y-1">
              <Badge variant={getStatusVariant(trigger.status)}>
                {trigger.triggerType || "scheduled"} / {trigger.status || "-"}
              </Badge>
              <p className="text-xs text-slate-500">
                HTTP {trigger.responseStatus ?? "-"} - {formatDate(trigger.createdAt)}
              </p>
              {trigger.errorMessage ? <p className="text-xs text-red-300">{formatErrorMessage(trigger.errorMessage)}</p> : null}
            </div>
          );
        },
      },
      {
        accessorKey: "nextTriggerAt",
        header: "Sonraki Tetik",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <NextTriggerCountdown
              hasSubscription={Boolean(item.subscriptionId)}
              targetIso={item.nextTriggerAt}
              cadenceHours={item.cadenceHours}
            />
          );
        },
      },
      {
        id: "switchTarget",
        header: "Hedef Geçiş",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <Select
              value={item.selectedWebhookConfigId}
              onChange={(event) =>
                setSelectedWebhookByStore((prev) => ({
                  ...prev,
                  [item.storeId]: event.target.value,
                }))
              }
            >
              <option value="">Webhook seçin</option>
              {item.availableWebhookOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.productLabel ? `${option.name} · ${option.productLabel}` : option.name}
                </option>
              ))}
            </Select>
          );
        },
      },
      {
        id: "actions",
        header: "Aksiyon",
        cell: ({ row }) => {
          const item = row.original;
          const selectedWebhook = item.availableWebhookOptions.find((option) => option.id === item.selectedWebhookConfigId) ?? null;
          const switchDisabled =
            !item.canSwitch ||
            !item.selectedWebhookConfigId ||
            switchingStoreId === item.storeId;

          return (
            <div className="space-y-1">
              <Button onClick={() => void runSwitch(item)} disabled={switchDisabled} className="cursor-pointer">
                {switchingStoreId === item.storeId
                  ? "Geçiriliyor..."
                  : `${selectedWebhook?.name || "Webhook"}'a Geçir`}
              </Button>
              {!item.subscriptionId ? <p className="text-xs text-amber-300">Aktif abonelik yok.</p> : null}
            </div>
          );
        },
      },
    ],
    [
      runSwitch,
      switchingStoreId,
      copiedStoreId,
      handleCopyStoreId,
    ]
  );

  return (
    <div className="space-y-6">
      <Card className="glass-card-pro rounded-[32px]">
        <CardHeader className="space-y-3">
          <Badge className="w-fit">Stores Automation</Badge>
          <CardTitle>Mağaza Otomasyon Orkestrasyonu</CardTitle>
          <CardDescription>
            Store bazlı n8n webhook yönetimi. Webhook seçip geçir butonu{" "}
            <span className="text-indigo-300 font-mono">{`{ client_id: store_id }`}</span> payload&apos;ı ile anında tetikler.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-end">
            <Button variant="secondary" className="cursor-pointer" onClick={() => void loadOverview()} disabled={loading}>
              Yenile
            </Button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Hata</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {successMessage ? (
            <Alert variant="success">
              <AlertTitle>Başarılı</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={tableRows}
              searchPlaceholder="Mağaza, kullanıcı, plan ara..."
              pageSize={8}
              statusFilterKey="storeStatus"
              dateFilterKey="automationUpdatedAt"
              statusFilterLabel="Mağaza Durumu"
              dateFilterLabel="Otomasyon Güncelleme"
              filtersInline
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
