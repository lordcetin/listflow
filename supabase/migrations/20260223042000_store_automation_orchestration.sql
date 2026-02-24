alter table if exists public.webhook_configs
  add column if not exists scope text;

alter table if exists public.webhook_configs
  alter column scope set default 'generic';

update public.webhook_configs
set scope = 'generic'
where scope is null or btrim(scope) = '';

alter table if exists public.webhook_configs
  alter column scope set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'webhook_configs_scope_check'
  ) then
    alter table public.webhook_configs
      add constraint webhook_configs_scope_check
      check (scope in ('generic', 'automation'));
  end if;
end $$;

alter table if exists public.webhook_configs
  add column if not exists description text;

alter table if exists public.stores
  add column if not exists active_webhook_config_id uuid references public.webhook_configs(id) on delete set null;

alter table if exists public.stores
  add column if not exists automation_updated_at timestamptz;

alter table if exists public.stores
  add column if not exists automation_updated_by uuid;

create index if not exists idx_stores_active_webhook_config_id
  on public.stores(active_webhook_config_id);

alter table if exists public.subscriptions
  add column if not exists store_id uuid references public.stores(id) on delete set null;

create index if not exists idx_subscriptions_store_id
  on public.subscriptions(store_id);

update public.subscriptions as sub
set store_id = st.id
from public.stores as st
where sub.store_id is null
  and sub.shop_id is not null
  and sub.shop_id = st.id::text;

alter table if exists public.scheduler_jobs
  add column if not exists store_id uuid references public.stores(id) on delete set null;

alter table if exists public.scheduler_jobs
  add column if not exists webhook_config_id uuid references public.webhook_configs(id) on delete set null;

alter table if exists public.scheduler_jobs
  add column if not exists trigger_type text;

update public.scheduler_jobs
set trigger_type = 'scheduled'
where trigger_type is null or btrim(trigger_type) = '';

alter table if exists public.scheduler_jobs
  alter column trigger_type set default 'scheduled';

alter table if exists public.scheduler_jobs
  alter column trigger_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'scheduler_jobs_trigger_type_check'
  ) then
    alter table public.scheduler_jobs
      add constraint scheduler_jobs_trigger_type_check
      check (trigger_type in ('scheduled', 'manual_switch'));
  end if;
end $$;

alter table if exists public.scheduler_jobs
  add column if not exists request_payload jsonb;

create index if not exists idx_scheduler_jobs_store_id
  on public.scheduler_jobs(store_id);

create index if not exists idx_scheduler_jobs_trigger_type_created_at
  on public.scheduler_jobs(trigger_type, created_at desc);

create table if not exists public.store_automation_transitions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  from_webhook_config_id uuid references public.webhook_configs(id) on delete set null,
  to_webhook_config_id uuid references public.webhook_configs(id) on delete set null,
  month_index integer not null default 1 check (month_index >= 1),
  status text not null default 'processing' check (status in ('processing', 'success', 'failed', 'blocked')),
  trigger_response_status integer,
  trigger_response_body text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_store_automation_transitions_store_created_at
  on public.store_automation_transitions(store_id, created_at desc);

create index if not exists idx_store_automation_transitions_subscription_id
  on public.store_automation_transitions(subscription_id);

alter table if exists public.store_automation_transitions enable row level security;

drop policy if exists admin_all_store_automation_transitions on public.store_automation_transitions;
create policy admin_all_store_automation_transitions on public.store_automation_transitions
for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
