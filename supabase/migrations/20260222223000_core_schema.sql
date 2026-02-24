create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null,
  email text,
  full_name text,
  locale text not null default 'tr',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title_tr text not null,
  title_en text not null,
  parent_id uuid references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  title_tr text not null,
  title_en text not null,
  image_urls text[] not null default '{}',
  cost numeric(12,2) not null default 0,
  shipping_cost numeric(12,2) not null default 10,
  cut_percent numeric(5,2) not null default 24,
  sale_price numeric(12,2) not null default 0,
  margin_percent numeric(5,2) not null default 25,
  net_profit numeric(12,2) not null default 0,
  stripe_product_id text,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_image_urls_max_two check (coalesce(array_length(image_urls, 1), 0) <= 2)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  shop_id text,
  plan text not null default 'standard',
  status text not null default 'pending',
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  shop_id text,
  stripe_session_id text,
  stripe_invoice_id text,
  stripe_subscription_id text,
  amount_cents integer not null default 0,
  currency text not null default 'usd',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_configs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_url text not null,
  method text not null default 'POST',
  headers jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  request_url text,
  request_method text,
  request_headers jsonb,
  request_body jsonb,
  response_status integer,
  response_body text,
  duration_ms integer,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.stripe_event_logs (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  stripe_mode text not null default 'live' check (stripe_mode in ('live', 'test')),
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create table if not exists public.scheduler_jobs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid,
  user_id uuid,
  plan text,
  status text not null default 'processing',
  idempotency_key text unique not null,
  run_at timestamptz not null default now(),
  response_status integer,
  response_payload text,
  error_message text,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  store_name text not null,
  phone text,
  category text,
  status text not null default 'pending',
  price_cents integer not null default 2990,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan text not null check (plan in ('standard', 'pro', 'turbo')),
  interval text not null check (interval in ('month', 'year')),
  stripe_mode text not null default 'live' check (stripe_mode in ('live', 'test')),
  stripe_product_id text not null,
  stripe_price_id text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan, interval, stripe_mode)
);

create index if not exists idx_stripe_plan_prices_plan_interval_stripe_mode
  on public.stripe_plan_prices(plan, interval, stripe_mode);

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = uid
      and p.role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.webhook_configs enable row level security;
alter table public.webhook_logs enable row level security;
alter table public.stripe_event_logs enable row level security;
alter table public.scheduler_jobs enable row level security;
alter table public.stores enable row level security;
alter table public.stripe_plan_prices enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
for select to authenticated
using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists profiles_self_write on public.profiles;
create policy profiles_self_write on public.profiles
for update to authenticated
using (auth.uid() = user_id or public.is_admin(auth.uid()))
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'categories','products','subscriptions','payments','webhook_configs',
    'webhook_logs','stripe_event_logs','scheduler_jobs','stores','stripe_plan_prices'
  ]
  loop
    execute format('drop policy if exists admin_all_%s on public.%I', tbl, tbl);
    execute format(
      'create policy admin_all_%s on public.%I for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))',
      tbl,
      tbl
    );
  end loop;
end $$;

drop policy if exists stores_owner on public.stores;
create policy stores_owner on public.stores
for all to authenticated
using (auth.uid() = user_id or public.is_admin(auth.uid()))
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists subs_owner_read on public.subscriptions;
create policy subs_owner_read on public.subscriptions
for select to authenticated
using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists payments_owner_read on public.payments;
create policy payments_owner_read on public.payments
for select to authenticated
using (auth.uid() = user_id or public.is_admin(auth.uid()));
