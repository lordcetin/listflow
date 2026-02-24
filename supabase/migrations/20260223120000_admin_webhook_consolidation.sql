alter table if exists public.webhook_configs
  add column if not exists product_id uuid references public.products(id) on delete set null;

create index if not exists idx_webhook_configs_product_id
  on public.webhook_configs(product_id);

alter table if exists public.stores
  add column if not exists product_id uuid references public.products(id) on delete set null;

create index if not exists idx_stores_product_id
  on public.stores(product_id);

-- scope=automation ve enabled=true olan config'lerde product başına tek aktif webhook.
create unique index if not exists uniq_webhook_configs_active_automation_product
  on public.webhook_configs(product_id)
  where product_id is not null and enabled = true and scope = 'automation';

-- scheduler trigger type kapsamını genişlet.
alter table if exists public.scheduler_jobs
  alter column trigger_type drop default;

update public.scheduler_jobs
set trigger_type = 'scheduled'
where trigger_type is null or btrim(trigger_type) = '';

alter table if exists public.scheduler_jobs
  drop constraint if exists scheduler_jobs_trigger_type_check;

alter table if exists public.scheduler_jobs
  add constraint scheduler_jobs_trigger_type_check
  check (trigger_type in ('scheduled', 'manual_switch', 'activation'));

alter table if exists public.scheduler_jobs
  alter column trigger_type set default 'scheduled';

alter table if exists public.scheduler_jobs
  alter column trigger_type set not null;

create index if not exists idx_scheduler_jobs_store_trigger_run_at
  on public.scheduler_jobs(store_id, trigger_type, run_at desc);

-- Kolon yoksa normalize et.
alter table if exists public.webhook_configs
  add column if not exists description text;

alter table if exists public.scheduler_jobs
  add column if not exists request_payload jsonb;

alter table if exists public.stores
  add column if not exists active_webhook_config_id uuid references public.webhook_configs(id) on delete set null;
