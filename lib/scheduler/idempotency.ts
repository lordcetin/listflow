const PLAN_WINDOW_HOURS: Record<string, number> = {
  turbo: 2,
  pro: 4,
  standard: 8,
};

export const getPlanWindowHours = (plan: string) => PLAN_WINDOW_HOURS[(plan ?? "").toLowerCase()] ?? 8;

type CreateScheduledSlotIdempotencyKeyInput = {
  subscriptionId: string;
  storeId: string;
  plan: string;
  slotDueAtIso: string;
};

export const createScheduledSlotIdempotencyKey = ({
  subscriptionId,
  storeId,
  plan,
  slotDueAtIso,
}: CreateScheduledSlotIdempotencyKeyInput) =>
  `scheduled:${subscriptionId}:${storeId}:${plan}:${slotDueAtIso}`;

export const extractScheduledSlotDueIso = (idempotencyKey: string | null | undefined) => {
  if (!idempotencyKey || !idempotencyKey.startsWith("scheduled:")) {
    return null;
  }

  const parts = idempotencyKey.split(":");
  if (parts.length < 5) {
    return null;
  }

  const candidate = parts.slice(4).join(":");

  // Legacy key format used numeric bucket.
  if (/^\d+$/.test(candidate)) {
    return null;
  }

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

export const createManualSwitchIdempotencyKey = (storeId: string, webhookConfigId: string, now = new Date()) => {
  const minuteBucket = Math.floor(now.getTime() / 60_000);
  return `manual_switch:${storeId}:${webhookConfigId}:${minuteBucket}`;
};

export const createActivationIdempotencyKey = (
  subscriptionId: string,
  storeId: string,
  currentPeriodEndIso: string | null | undefined
) => {
  const periodBucket = currentPeriodEndIso ? new Date(currentPeriodEndIso).toISOString() : "no_period";
  return `activation:${subscriptionId}:${storeId}:${periodBucket}`;
};
