export const ADMIN_RESOURCE_MAP = {
  categories: { table: "categories", idColumn: "id" },
  products: { table: "products", idColumn: "id" },
  users: { table: "profiles", idColumn: "user_id" },
  stores: { table: "stores", idColumn: "id" },
  payments: { table: "payments", idColumn: "id" },
  subscriptions: { table: "subscriptions", idColumn: "id" },
  "webhook-configs": { table: "webhook_configs", idColumn: "id" },
  "webhook-logs": { table: "webhook_logs", idColumn: "id" },
  jobs: { table: "scheduler_jobs", idColumn: "id" },
  "automation-transitions": { table: "store_automation_transitions", idColumn: "id" },
  "stripe-events": { table: "stripe_event_logs", idColumn: "id" },
} as const;

export type AdminResource = keyof typeof ADMIN_RESOURCE_MAP;

export const isAdminResource = (value: string): value is AdminResource => {
  return value in ADMIN_RESOURCE_MAP;
};
