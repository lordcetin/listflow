"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Row = Record<string, unknown>;
type FieldType = "text" | "number" | "textarea" | "select" | "boolean" | "array" | "json";
type FormState = Record<string, string | boolean>;
type OptionsSource = "users" | "stores" | "categories" | "subscriptions" | "webhook_configs";
type StoreLookup = {
  id: string;
  name: string;
  userId: string | null;
  category: string | null;
};
type PaymentReconcileResponse = {
  error?: string;
  scannedSessions?: number;
  eligibleSessions?: number;
  paidCandidates?: number;
  syncedSessions?: number;
  ordersMarkedPaid?: number;
  skippedNotPaid?: number;
  failures?: Array<{ mode: string; sessionId: string; reason: string }>;
};

type FieldConfig = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  optionsSource?: OptionsSource;
  emptyOptionLabel?: string;
  autoGenerateOnCreate?: boolean;
  hiddenOnCreate?: boolean;
  hiddenOnEdit?: boolean;
  readOnlyOnCreate?: boolean;
  readOnlyOnEdit?: boolean;
  rows?: number;
};

type ResourceConfig = {
  title: string;
  endpoint: string;
  idKey: string;
  createEnabled?: boolean;
  updateEnabled?: boolean;
  deleteEnabled?: boolean;
  fields: FieldConfig[];
};

const RESOURCE_CONFIG: Record<string, ResourceConfig> = {
  categories: {
    title: "Kategoriler",
    endpoint: "categories",
    idKey: "id",
    fields: [
      { key: "slug", label: "Slug", type: "text", required: true, placeholder: "tig-isi" },
      { key: "title_tr", label: "Başlık (TR)", type: "text", required: true, placeholder: "Tığ İşi" },
      { key: "title_en", label: "Başlık (EN)", type: "text", required: true, placeholder: "Crochet" },
    ],
  },
  products: {
    title: "Ürünler",
    endpoint: "products",
    idKey: "id",
    fields: [
      {
        key: "category_id",
        label: "Kategori",
        type: "select",
        optionsSource: "categories",
        emptyOptionLabel: "Seçiniz",
      },
      { key: "title_tr", label: "Başlık (TR)", type: "text", required: true, placeholder: "Örnek Ürün" },
      { key: "title_en", label: "Başlık (EN)", type: "text", required: true, placeholder: "Sample Product" },
      { key: "image_urls", label: "Görseller (max 2)", type: "array", placeholder: "url1, url2" },
      { key: "cost", label: "Maliyet", type: "number", placeholder: "0", required: true },
      { key: "shipping_cost", label: "Kargo", type: "number", placeholder: "10", required: true },
      { key: "cut_percent", label: "Komisyon %", type: "number", placeholder: "24", required: true },
      { key: "sale_price", label: "Satış Fiyatı", type: "number", placeholder: "0", required: true },
      { key: "margin_percent", label: "Marj %", type: "number", placeholder: "25", required: true },
      { key: "net_profit", label: "Net Kar", type: "number", placeholder: "0", required: true },
      { key: "stripe_product_id", label: "Stripe Product ID", type: "text", placeholder: "prod_..." },
      { key: "stripe_price_id", label: "Stripe Price ID", type: "text", placeholder: "price_..." },
      { key: "variations", label: "Varyasyonlar", type: "json", rows: 4, placeholder: "[]" },
    ],
  },
  users: {
    title: "Kullanıcılar",
    endpoint: "users",
    idKey: "user_id",
    fields: [
      {
        key: "user_id",
        label: "User ID",
        type: "text",
        required: true,
        autoGenerateOnCreate: true,
        hiddenOnCreate: true,
        hiddenOnEdit: true,
        readOnlyOnCreate: true,
        readOnlyOnEdit: true,
      },
      { key: "email", label: "E-posta", type: "text", placeholder: "user@mail.com", required: true },
      { key: "full_name", label: "Ad Soyad", type: "text", placeholder: "Mert Demir" },
      { key: "phone", label: "Telefon", type: "text", placeholder: "+90..." },
      {
        key: "role",
        label: "Rol",
        type: "select",
        required: true,
        options: [
          { value: "user", label: "user" },
          { value: "admin", label: "admin" },
        ],
      },
      {
        key: "locale",
        label: "Dil",
        type: "select",
        options: [
          { value: "tr", label: "tr" },
          { value: "en", label: "en" },
        ],
      },
    ],
  },
  payments: {
    title: "Ödemeler",
    endpoint: "payments",
    idKey: "id",
    createEnabled: false,
    updateEnabled: false,
    deleteEnabled: false,
    fields: [
      { key: "user_id", label: "Kullanıcı", type: "select", optionsSource: "users", emptyOptionLabel: "Seçiniz" },
      { key: "shop_id", label: "Mağaza", type: "select", optionsSource: "stores", emptyOptionLabel: "Seçiniz" },
      { key: "stripe_session_id", label: "Stripe Session ID", type: "text", placeholder: "cs_..." },
      { key: "amount_cents", label: "Tutar", type: "number", placeholder: "2990", required: true },
      { key: "currency", label: "Para Birimi", type: "text", placeholder: "usd", required: true },
      { key: "status", label: "Durum", type: "text", placeholder: "paid/pending", required: true },
    ],
  },
  subscriptions: {
    title: "Abonelikler",
    endpoint: "subscriptions",
    idKey: "id",
    fields: [
      { key: "user_id", label: "Kullanıcı", type: "select", optionsSource: "users", emptyOptionLabel: "Seçiniz" },
      { key: "store_id", label: "Mağaza (Yeni)", type: "select", optionsSource: "stores", emptyOptionLabel: "Seçiniz" },
      { key: "shop_id", label: "Mağaza (Legacy)", type: "select", optionsSource: "stores", emptyOptionLabel: "Seçiniz" },
      {
        key: "plan",
        label: "Plan",
        type: "select",
        required: true,
        options: [
          { value: "standard", label: "standard" },
          { value: "pro", label: "pro" },
          { value: "turbo", label: "turbo" },
        ],
      },
      { key: "status", label: "Durum", type: "text", required: true, placeholder: "active/trialing/canceled" },
      { key: "stripe_customer_id", label: "Stripe Customer ID", type: "text", placeholder: "cus_..." },
      { key: "stripe_subscription_id", label: "Stripe Subscription ID", type: "text", placeholder: "sub_..." },
      { key: "current_period_end", label: "Dönem Sonu", type: "text", placeholder: "2026-03-01T00:00:00Z" },
    ],
  },
  stores: {
    title: "Mağazalar",
    endpoint: "stores",
    idKey: "id",
    fields: [
      { key: "user_id", label: "Kullanıcı", type: "select", optionsSource: "users", required: true },
      { key: "store_name", label: "Mağaza Adı", type: "text", required: true, placeholder: "Mavi Dükkan" },
      { key: "phone", label: "Telefon", type: "text", placeholder: "+90..." },
      { key: "category", label: "Kategori", type: "text", placeholder: "Ev Dekor" },
      {
        key: "status",
        label: "Durum",
        type: "select",
        required: true,
        options: [
          { value: "pending", label: "pending" },
          { value: "active", label: "active" },
          { value: "paused", label: "paused" },
        ],
      },
      { key: "price_cents", label: "Ücret (cent)", type: "number", placeholder: "2990", required: true },
      {
        key: "active_webhook_config_id",
        label: "Aktif Webhook",
        type: "select",
        optionsSource: "webhook_configs",
        emptyOptionLabel: "Seçiniz",
      },
    ],
  },
  "webhook-configs": {
    title: "Webhook Config",
    endpoint: "webhook-configs",
    idKey: "id",
    fields: [
      { key: "name", label: "Ad", type: "text", required: true, placeholder: "n8n Trigger" },
      { key: "description", label: "Açıklama", type: "textarea", rows: 2, placeholder: "Opsiyonel" },
      { key: "target_url", label: "Hedef URL", type: "text", required: true, placeholder: "https://..." },
      {
        key: "method",
        label: "Method",
        type: "select",
        required: true,
        options: [
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST" },
        ],
      },
      {
        key: "scope",
        label: "Scope",
        type: "select",
        required: true,
        options: [
          { value: "automation", label: "automation" },
          { value: "generic", label: "generic" },
        ],
      },
      { key: "headers", label: "Headers (JSON)", type: "json", rows: 4, placeholder: '{"Authorization":"Bearer ***"}' },
      { key: "enabled", label: "Aktif", type: "boolean" },
    ],
  },
  "webhook-logs": {
    title: "Webhook Logları",
    endpoint: "webhook-logs",
    idKey: "id",
    createEnabled: false,
    updateEnabled: false,
    deleteEnabled: false,
    fields: [],
  },
  jobs: {
    title: "Zamanlayıcı İşleri",
    endpoint: "jobs",
    idKey: "id",
    fields: [
      {
        key: "subscription_id",
        label: "Abonelik",
        type: "select",
        optionsSource: "subscriptions",
        emptyOptionLabel: "Seçiniz",
      },
      { key: "user_id", label: "Kullanıcı", type: "select", optionsSource: "users", emptyOptionLabel: "Seçiniz" },
      { key: "store_id", label: "Mağaza", type: "select", optionsSource: "stores", emptyOptionLabel: "Seçiniz" },
      {
        key: "webhook_config_id",
        label: "Webhook",
        type: "select",
        optionsSource: "webhook_configs",
        emptyOptionLabel: "Seçiniz",
      },
      {
        key: "plan",
        label: "Plan",
        type: "select",
        options: [
          { value: "standard", label: "standard" },
          { value: "pro", label: "pro" },
          { value: "turbo", label: "turbo" },
        ],
      },
      {
        key: "trigger_type",
        label: "Tetik Tipi",
        type: "select",
        options: [
          { value: "scheduled", label: "scheduled" },
          { value: "manual_switch", label: "manual_switch" },
        ],
      },
      { key: "status", label: "Durum", type: "text", placeholder: "processing/success/failed", required: true },
      { key: "idempotency_key", label: "Idempotency Key", type: "text", required: true, placeholder: "job_key_..." },
      { key: "request_payload", label: "Request Payload", type: "json", rows: 3, placeholder: '{"client_id":"..."}' },
      { key: "run_at", label: "Çalışma Zamanı", type: "text", placeholder: "2026-03-01T00:00:00Z" },
      { key: "response_status", label: "Response Status", type: "number", placeholder: "200" },
      { key: "response_payload", label: "Response Payload", type: "textarea", rows: 3, placeholder: "n8n response..." },
      { key: "error_message", label: "Hata Mesajı", type: "textarea", rows: 3, placeholder: "opsiyonel" },
      { key: "retry_count", label: "Retry Count", type: "number", placeholder: "0" },
    ],
  },
  "automation-transitions": {
    title: "Automation Geçişleri",
    endpoint: "automation-transitions",
    idKey: "id",
    fields: [
      { key: "store_id", label: "Mağaza", type: "select", optionsSource: "stores", emptyOptionLabel: "Seçiniz" },
      {
        key: "subscription_id",
        label: "Abonelik",
        type: "select",
        optionsSource: "subscriptions",
        emptyOptionLabel: "Seçiniz",
      },
      {
        key: "from_webhook_config_id",
        label: "Önceki Webhook",
        type: "select",
        optionsSource: "webhook_configs",
        emptyOptionLabel: "Seçiniz",
      },
      {
        key: "to_webhook_config_id",
        label: "Yeni Webhook",
        type: "select",
        optionsSource: "webhook_configs",
        emptyOptionLabel: "Seçiniz",
      },
      { key: "month_index", label: "Ay Index", type: "number", required: true },
      {
        key: "status",
        label: "Durum",
        type: "select",
        options: [
          { value: "processing", label: "processing" },
          { value: "success", label: "success" },
          { value: "failed", label: "failed" },
          { value: "blocked", label: "blocked" },
        ],
      },
      { key: "trigger_response_status", label: "HTTP", type: "number" },
      { key: "trigger_response_body", label: "Response", type: "textarea", rows: 3 },
      { key: "created_by", label: "Oluşturan", type: "text" },
    ],
  },
  "stripe-events": {
    title: "Stripe Event Logları",
    endpoint: "stripe-events",
    idKey: "id",
    createEnabled: false,
    updateEnabled: false,
    deleteEnabled: false,
    fields: [],
  },
};

const SOURCE_ENDPOINT_MAP: Record<OptionsSource, string> = {
  users: "users",
  stores: "stores",
  categories: "categories",
  subscriptions: "subscriptions",
  webhook_configs: "webhook-configs",
};

const getResourceConfig = (resource: string): ResourceConfig => {
  return (
    RESOURCE_CONFIG[resource] ?? {
      title: resource,
      endpoint: resource,
      idKey: "id",
      fields: [],
    }
  );
};

const generateUuid = () => {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const buildEmptyFormState = (fields: FieldConfig[]): FormState => {
  return fields.reduce<FormState>((acc, field) => {
    if (field.autoGenerateOnCreate) {
      acc[field.key] = generateUuid();
      return acc;
    }

    if (field.type === "boolean") {
      acc[field.key] = false;
      return acc;
    }

    if (field.type === "select") {
      if (field.emptyOptionLabel) {
        acc[field.key] = "";
      } else if (field.options?.length) {
        acc[field.key] = field.options[0].value;
      } else {
        acc[field.key] = "";
      }
      return acc;
    }

    acc[field.key] = "";
    return acc;
  }, {});
};

const toFormValue = (field: FieldConfig, value: unknown): string | boolean => {
  if (field.type === "boolean") {
    return Boolean(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (field.type === "array") {
    return Array.isArray(value) ? value.map((item) => String(item)).join(", ") : String(value);
  }

  if (field.type === "json") {
    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }

  return String(value);
};

const renderValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (Array.isArray(value)) {
    const hasObjectItem = value.some((item) => typeof item === "object" && item !== null);
    if (hasObjectItem) {
      try {
        return JSON.stringify(value);
      } catch {
        return "-";
      }
    }
    return value.join(", ");
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "-";
    }
  }

  return String(value);
};

const getRowString = (row: Row, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

const getRowNumber = (row: Row, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const normalizeLookupText = (value: string | null | undefined) => {
  return value?.trim().toLowerCase() ?? "";
};

const parseOrderIdFromShopReference = (value: string | null) => {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^order_(.+)$/i);
  return match?.[1]?.trim() || null;
};

const formatMoneyFromCents = (cents: number, currencyCode: string) => {
  const normalizedCurrency = currencyCode.toUpperCase();
  const amount = cents / 100;

  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${normalizedCurrency}`;
  }
};

const buildPayload = (values: FormState, fields: FieldConfig[], mode: "create" | "update") => {
  const payload: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = values[field.key];

    if (field.type === "boolean") {
      payload[field.key] = Boolean(raw);
      continue;
    }

    const text = typeof raw === "string" ? raw.trim() : "";

    if (!text) {
      if (mode === "update" && field.type !== "select") {
        payload[field.key] = null;
      }
      continue;
    }

    if (field.type === "number") {
      const parsed = Number(text);
      if (Number.isNaN(parsed)) {
        throw new Error(`${field.label} sayısal olmalı.`);
      }
      payload[field.key] = parsed;
      continue;
    }

    if (field.type === "array") {
      payload[field.key] = text
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }

    if (field.type === "json") {
      try {
        payload[field.key] = JSON.parse(text);
      } catch {
        throw new Error(`${field.label} geçerli JSON olmalı.`);
      }
      continue;
    }

    payload[field.key] = text;
  }

  return payload;
};

const validateRequiredFields = (values: FormState, fields: FieldConfig[]) => {
  for (const field of fields) {
    if (!field.required) {
      continue;
    }

    const raw = values[field.key];

    if (field.type === "boolean") {
      continue;
    }

    if (typeof raw !== "string" || !raw.trim()) {
      throw new Error(`${field.label} alanı zorunlu.`);
    }
  }
};

const getSourceOptions = (source: OptionsSource, rows: Row[]): Array<{ value: string; label: string }> => {
  if (source === "users") {
    return rows
      .map((row) => {
        const value = row.user_id ? String(row.user_id) : "";
        const label = row.email ? String(row.email) : row.full_name ? String(row.full_name) : value;
        return value ? { value, label } : null;
      })
      .filter((item): item is { value: string; label: string } => Boolean(item));
  }

  if (source === "stores") {
    return rows
      .map((row) => {
        const value = row.id ? String(row.id) : "";
        const label = row.store_name ? String(row.store_name) : value;
        return value ? { value, label } : null;
      })
      .filter((item): item is { value: string; label: string } => Boolean(item));
  }

  if (source === "categories") {
    return rows
      .map((row) => {
        const value = row.id ? String(row.id) : "";
        const label = row.title_tr
          ? String(row.title_tr)
          : row.title_en
            ? String(row.title_en)
            : row.slug
              ? String(row.slug)
              : value;
        return value ? { value, label } : null;
      })
      .filter((item): item is { value: string; label: string } => Boolean(item));
  }

  if (source === "webhook_configs") {
    return rows
      .map((row) => {
        const value = row.id ? String(row.id) : "";
        const label = row.name ? String(row.name) : value;
        return value ? { value, label } : null;
      })
      .filter((item): item is { value: string; label: string } => Boolean(item));
  }

  return rows
    .map((row) => {
      const value = row.id ? String(row.id) : "";
      const label = row.stripe_subscription_id ? String(row.stripe_subscription_id) : row.status ? String(row.status) : value;
      return value ? { value, label } : null;
    })
    .filter((item): item is { value: string; label: string } => Boolean(item));
};

const FieldInput = ({
  field,
  value,
  options,
  onChange,
  disabled,
}: {
  field: FieldConfig;
  value: string | boolean;
  options: Array<{ value: string; label: string }>;
  onChange: (key: string, value: string | boolean) => void;
  disabled?: boolean;
}) => {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 mt-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(field.key, event.target.checked)}
          disabled={disabled}
          className="w-4 h-4 accent-indigo-500"
        />
        <span className="text-xs text-slate-300 font-bold">Aktif</span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <Select
        value={String(value ?? "")}
        onChange={(event) => onChange(field.key, event.target.value)}
        disabled={disabled}
      >
        {field.emptyOptionLabel ? <option value="">{field.emptyOptionLabel}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  }

  if (field.type === "textarea" || field.type === "json") {
    return (
      <Textarea
        value={String(value ?? "")}
        onChange={(event) => onChange(field.key, event.target.value)}
        rows={field.rows ?? 4}
        placeholder={field.placeholder}
        disabled={disabled}
      />
    );
  }

  return (
    <Input
      type={field.type === "number" ? "number" : "text"}
      step={field.type === "number" ? "0.01" : undefined}
      value={String(value ?? "")}
      onChange={(event) => onChange(field.key, event.target.value)}
      placeholder={field.placeholder}
      disabled={disabled}
    />
  );
};

export default function AdminResourceClient({
  resource,
  hideCreateForm = false,
  reloadKey = 0,
}: {
  resource: string;
  hideCreateForm?: boolean;
  reloadKey?: number;
}) {
  const config = useMemo(() => getResourceConfig(resource), [resource]);
  const [rows, setRows] = useState<Row[]>([]);
  const [orderRows, setOrderRows] = useState<Row[]>([]);
  const [sourceRows, setSourceRows] = useState<Record<OptionsSource, Row[]>>({
    users: [],
    stores: [],
    categories: [],
    subscriptions: [],
    webhook_configs: [],
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reconcilingPayments, setReconcilingPayments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [createValues, setCreateValues] = useState<FormState>(() => buildEmptyFormState(config.fields));
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<FormState>({});
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const requiredSources = useMemo(() => {
    return Array.from(new Set(config.fields.map((field) => field.optionsSource).filter(Boolean))) as OptionsSource[];
  }, [config.fields]);

  useEffect(() => {
    setCreateValues(buildEmptyFormState(config.fields));
    setEditingRowId(null);
    setEditValues({});
  }, [config]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/${config.endpoint}`, { cache: "no-store" });
      const payload = (await response.json()) as { rows?: Row[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Yükleme hatası");
      }

      setRows(payload.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Yükleme hatası");
    } finally {
      setLoading(false);
    }
  }, [config.endpoint]);

  const loadOrderRows = useCallback(async () => {
    if (resource !== "payments") {
      setOrderRows([]);
      return;
    }

    try {
      const response = await fetch("/api/admin/orders", { cache: "no-store" });
      const payload = (await response.json()) as { rows?: Row[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Sipariş verisi yüklenemedi.");
      }

      setOrderRows(payload.rows ?? []);
    } catch {
      setOrderRows([]);
    }
  }, [resource]);

  const refreshData = useCallback(async () => {
    await loadRows();
    if (resource === "payments") {
      await loadOrderRows();
    }
  }, [loadOrderRows, loadRows, resource]);

  useEffect(() => {
    void refreshData();
  }, [refreshData, reloadKey]);

  useEffect(() => {
    if (!requiredSources.length) {
      return;
    }

    let active = true;

    const loadSources = async () => {
      try {
        const results = await Promise.all(
          requiredSources.map(async (source) => {
            const endpoint = SOURCE_ENDPOINT_MAP[source];
            const response = await fetch(`/api/admin/${endpoint}`, { cache: "no-store" });
            const payload = (await response.json()) as { rows?: Row[]; error?: string };

            if (!response.ok) {
              throw new Error(payload.error || "Kaynak verisi yüklenemedi");
            }

            return { source, rows: payload.rows ?? [] };
          })
        );

        if (!active) {
          return;
        }

        setSourceRows((prev) => {
          const next = { ...prev };
          for (const item of results) {
            next[item.source] = item.rows;
          }
          return next;
        });
      } catch {
        if (active) {
          setError("İlişkili veriler yüklenemedi.");
        }
      }
    };

    void loadSources();

    return () => {
      active = false;
    };
  }, [requiredSources]);

  const getSelectOptions = useCallback(
    (field: FieldConfig) => {
      if (field.type !== "select") {
        return [];
      }

      if (field.optionsSource) {
        return getSourceOptions(field.optionsSource, sourceRows[field.optionsSource]);
      }

      return field.options ?? [];
    },
    [sourceRows]
  );

  const storeLookupList = useMemo<StoreLookup[]>(() => {
    return sourceRows.stores
      .map((row) => {
        const id = getRowString(row, ["id"]);
        const name = getRowString(row, ["store_name", "name"]);

        if (!id || !name) {
          return null;
        }

        return {
          id,
          name,
          userId: getRowString(row, ["user_id", "userId"]),
          category: getRowString(row, ["category", "category_name", "categoryName"]),
        };
      })
      .filter((item): item is StoreLookup => Boolean(item));
  }, [sourceRows.stores]);

  const storeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const store of storeLookupList) {
      map.set(store.id, store.name);
    }
    return map;
  }, [storeLookupList]);

  const storesByUserId = useMemo(() => {
    const map = new Map<string, StoreLookup[]>();
    for (const store of storeLookupList) {
      if (!store.userId) {
        continue;
      }

      const current = map.get(store.userId) ?? [];
      current.push(store);
      map.set(store.userId, current);
    }
    return map;
  }, [storeLookupList]);

  const ordersById = useMemo(() => {
    const map = new Map<string, Row>();
    for (const row of orderRows) {
      const id = getRowString(row, ["id"]);
      if (id) {
        map.set(id, row);
      }
    }
    return map;
  }, [orderRows]);

  const resolvePaymentStoreName = useCallback(
    (paymentRow: Row) => {
      const paymentStoreRef = getRowString(paymentRow, ["shop_id", "store_id", "shopId", "storeId"]);
      const paymentUserId = getRowString(paymentRow, ["user_id", "userId"]);

      const getSingleStoreForUser = (userId: string | null) => {
        if (!userId) {
          return null;
        }
        const stores = storesByUserId.get(userId) ?? [];
        return stores.length === 1 ? stores[0].name : null;
      };

      const getStoreByCategory = (userId: string | null, category: string | null) => {
        if (!userId || !category) {
          return null;
        }

        const normalizedCategory = normalizeLookupText(category);
        if (!normalizedCategory) {
          return null;
        }

        const candidates = (storesByUserId.get(userId) ?? []).filter((store) => {
          const normalizedStoreCategory = normalizeLookupText(store.category);
          return normalizedStoreCategory !== "" && normalizedStoreCategory === normalizedCategory;
        });

        return candidates.length === 1 ? candidates[0].name : null;
      };

      if (paymentStoreRef) {
        const directStoreName = storeNameById.get(paymentStoreRef);
        if (directStoreName) {
          return directStoreName;
        }
      }

      const orderId =
        parseOrderIdFromShopReference(paymentStoreRef) ??
        (paymentStoreRef && ordersById.has(paymentStoreRef) ? paymentStoreRef : null);

      if (orderId) {
        const orderRow = ordersById.get(orderId);

        if (orderRow) {
          const orderStoreId = getRowString(orderRow, ["store_id", "storeId"]);

          if (orderStoreId) {
            const storeNameFromOrderStore = storeNameById.get(orderStoreId);
            if (storeNameFromOrderStore) {
              return storeNameFromOrderStore;
            }
          }

          const orderUserId = getRowString(orderRow, ["user_id", "userId"]) ?? paymentUserId;
          const orderCategory = getRowString(orderRow, ["category_name", "categoryName", "productName"]);

          const storeNameFromCategory = getStoreByCategory(orderUserId, orderCategory);
          if (storeNameFromCategory) {
            return storeNameFromCategory;
          }

          const singleStoreForOrderUser = getSingleStoreForUser(orderUserId);
          if (singleStoreForOrderUser) {
            return singleStoreForOrderUser;
          }
        }
      }

      return getSingleStoreForUser(paymentUserId);
    },
    [ordersById, storeNameById, storesByUserId]
  );

  const resolveRowId = useCallback(
    (row: Row, index: number) => {
      const raw = row[config.idKey] ?? row.id ?? index;
      return String(raw);
    },
    [config.idKey]
  );

  const setCreateField = (key: string, value: string | boolean) => {
    setCreateValues((prev) => ({ ...prev, [key]: value }));
  };

  const setEditField = (key: string, value: string | boolean) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  };

  const openEdit = useCallback(
    (row: Row, index: number) => {
      const rowId = resolveRowId(row, index);
      const nextValues = buildEmptyFormState(config.fields);

      for (const field of config.fields) {
        nextValues[field.key] = toFormValue(field, row[field.key]);
      }

      setEditingRowId(rowId);
      setEditValues(nextValues);
      setEditDialogOpen(true);
    },
    [config.fields, resolveRowId]
  );

  const createRow = async () => {
    if (config.createEnabled === false || !config.fields.length) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      validateRequiredFields(createValues, config.fields);
      const payload = buildPayload(createValues, config.fields, "create");

      const response = await fetch(`/api/admin/${config.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error || "Kayıt eklenemedi");
      }

      setCreateValues(buildEmptyFormState(config.fields));
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kayıt eklenemedi");
    } finally {
      setSaving(false);
    }
  };

  const runPaymentReconciliation = useCallback(async () => {
    if (resource !== "payments") {
      return;
    }

    setReconcilingPayments(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch("/api/admin/orders/reconcile-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "all",
          days: 365,
          maxSessions: 800,
          dryRun: false,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as PaymentReconcileResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Ödeme uzlaştırma başarısız.");
      }

      const failureCount = payload.failures?.length ?? 0;
      setInfo(
        `Senkron tamamlandı. Taranan: ${payload.scannedSessions ?? 0}, Eşleşen: ${payload.eligibleSessions ?? 0}, İşlenen: ${payload.syncedSessions ?? 0}, Sipariş güncellemesi: ${payload.ordersMarkedPaid ?? 0}, Atlanan: ${payload.skippedNotPaid ?? 0}, Hata: ${failureCount}.`
      );

      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ödeme uzlaştırma başarısız.");
    } finally {
      setReconcilingPayments(false);
    }
  }, [refreshData, resource]);

  const saveEdit = async () => {
    if (!editingRowId) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      validateRequiredFields(editValues, config.fields.filter((field) => !field.readOnlyOnEdit));
      const editableFields = config.fields.filter((field) => !field.readOnlyOnEdit);
      const payload = buildPayload(editValues, editableFields, "update");

      const response = await fetch(`/api/admin/${config.endpoint}/${editingRowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error || "Kayıt güncellenemedi");
      }

      setEditDialogOpen(false);
      setEditingRowId(null);
      setEditValues({});
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kayıt güncellenemedi");
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = useCallback(
    async (rowId: string) => {
      if (config.deleteEnabled === false) {
        return;
      }

      setSaving(true);
      setError(null);

      try {
        const response = await fetch(`/api/admin/${config.endpoint}/${rowId}`, {
          method: "DELETE",
        });

        const body = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(body.error || "Kayıt silinemedi");
        }

        await loadRows();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kayıt silinemedi");
      } finally {
        setSaving(false);
      }
    },
    [config.deleteEnabled, config.endpoint, loadRows]
  );

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const visibleKeys = config.fields.length
      ? config.fields.map((field) => field.key)
      : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

    const baseColumns: ColumnDef<Row>[] = visibleKeys.map((key) => {
      const field = config.fields.find((entry) => entry.key === key);
      return {
        accessorKey: key,
        header: field?.label ?? key,
        cell: ({ row }) => {
          if (resource === "payments") {
            if (key === "shop_id") {
              const storeName = resolvePaymentStoreName(row.original);
              return <span className="text-xs text-slate-200 break-all">{storeName ?? "-"}</span>;
            }

            if (key === "amount_cents") {
              const cents = getRowNumber(row.original, ["amount_cents", "amountCents"]);
              const currency = getRowString(row.original, ["currency"]) ?? "usd";

              if (cents === null) {
                return <span className="text-xs text-slate-200 break-all">-</span>;
              }

              return <span className="text-xs font-black text-slate-100">{formatMoneyFromCents(cents, currency)}</span>;
            }
          }

          const value = row.original[key];
          return <span className="text-xs text-slate-200 break-all">{renderValue(value)}</span>;
        },
      };
    });

    const showActions = config.updateEnabled !== false || config.deleteEnabled !== false;

    if (!showActions) {
      return baseColumns;
    }

    return [
      ...baseColumns,
      {
        id: "actions",
        header: "Aksiyon",
        cell: ({ row }) => {
          const rowId = resolveRowId(row.original, row.index);

          return (
            <div className="flex items-center gap-2 justify-end">
              {config.updateEnabled !== false && config.fields.length > 0 ? (
                <Button className="cursor-pointer" variant="outline" size="sm" onClick={() => openEdit(row.original, row.index)} disabled={saving}>
                  Düzenle
                </Button>
              ) : null}
              {config.deleteEnabled !== false ? (
                <Button className="cursor-pointer" variant="destructive" size="sm" onClick={() => void deleteRow(rowId)} disabled={saving}>
                  Sil
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ];
  }, [config.deleteEnabled, config.fields, config.updateEnabled, deleteRow, openEdit, resolvePaymentStoreName, resolveRowId, resource, rows, saving]);

  const canCreate = config.createEnabled !== false && config.fields.length > 0;
  const statusFilterKey = useMemo(() => {
    return rows.some((row) => Object.prototype.hasOwnProperty.call(row, "status")) ? "status" : undefined;
  }, [rows]);

  const dateFilterKey = useMemo(() => {
    const candidates = ["created_at", "updated_at", "run_at", "processed_at", "current_period_end"];
    for (const key of candidates) {
      if (rows.some((row) => Object.prototype.hasOwnProperty.call(row, key))) {
        return key;
      }
    }

    return undefined;
  }, [rows]);

  return (
    <div className="space-y-6">
      <Card className="glass-card-pro rounded-[32px]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-2">
            <Badge variant="secondary">{config.endpoint}</Badge>
            <CardTitle className="text-2xl">{config.title}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {resource === "payments" ? (
              <Button
                className="cursor-pointer"
                onClick={() => void runPaymentReconciliation()}
                disabled={loading || saving || reconcilingPayments}
              >
                {reconcilingPayments ? "Stripe Senkronu..." : "Stripe Sipariş Senkronu"}
              </Button>
            ) : null}
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

          {hideCreateForm ? null : (
            <Card className="rounded-2xl">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">Yeni Kayıt</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-3">
                {canCreate ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {config.fields
                        .filter((field) => !field.hiddenOnCreate)
                        .map((field) => (
                          <div key={field.key} className={field.type === "textarea" || field.type === "json" ? "md:col-span-2" : ""}>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{field.label}</p>
                            <FieldInput
                              field={field}
                              value={createValues[field.key]}
                              options={getSelectOptions(field)}
                              onChange={setCreateField}
                              disabled={saving || field.readOnlyOnCreate}
                            />
                          </div>
                        ))}
                    </div>
                    <div className="flex justify-end">
                      <Button className="cursor-pointer" onClick={() => void createRow()} disabled={saving}>
                        Kaydet
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">Bu kaynak için manuel create kapalı.</p>
                )}
              </CardContent>
            </Card>
          )}

          <DataTable
            columns={columns}
            data={rows}
            enableSearch
            searchPlaceholder={`${config.title} içinde ara...`}
            emptyMessage={loading ? "Yükleniyor..." : "Kayıt bulunamadı."}
            pageSize={12}
            statusFilterKey={statusFilterKey}
            dateFilterKey={dateFilterKey}
          />
        </CardContent>
      </Card>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Kayıt Düzenle</DialogTitle>
            <DialogDescription>{editingRowId ? `ID: ${editingRowId}` : ""}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-2">
            {config.fields
              .filter((field) => !field.hiddenOnEdit)
              .map((field) => {
                const disabled = field.readOnlyOnEdit || saving;
                return (
                  <div key={field.key} className={field.type === "textarea" || field.type === "json" ? "md:col-span-2" : ""}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{field.label}</p>
                    <FieldInput
                      field={field}
                      value={editValues[field.key]}
                      options={getSelectOptions(field)}
                      onChange={setEditField}
                      disabled={disabled}
                    />
                  </div>
                );
              })}
          </div>

          <DialogFooter>
            <Button className="cursor-pointer" variant="secondary" onClick={() => setEditDialogOpen(false)} disabled={saving}>
              İptal
            </Button>
            <Button className="cursor-pointer" onClick={() => void saveEdit()} disabled={saving}>
              Güncellemeyi Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
