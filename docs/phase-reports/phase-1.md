# Phase 1 Report - Supabase Data Model + RLS (Remote-Only)

## What I read
- `components/AuthPage.tsx`
- `components/Dashboard/EtsyPanel.tsx`
- `components/Dashboard/OrdersPanel.tsx`
- `types.ts`
- `lib/supabaseClient.ts`
- `.env.example`

## Remote SQL (run in Supabase SQL Editor)
```sql
create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null,
  email text,
  full_name text,
  locale text not null default 'tr',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title_tr text not null,
  title_en text not null,
  parent_id uuid references categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete set null,
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

create table if not exists subscriptions (
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

create table if not exists payments (
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

create table if not exists webhook_configs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_url text not null,
  method text not null default 'POST',
  headers jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists webhook_logs (
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

create table if not exists stripe_event_logs (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create table if not exists scheduler_jobs (
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

create table if not exists stores (
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

create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from profiles p
    where p.user_id = uid
      and p.role = 'admin'
  );
$$;

alter table profiles enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table webhook_configs enable row level security;
alter table webhook_logs enable row level security;
alter table stripe_event_logs enable row level security;
alter table scheduler_jobs enable row level security;
alter table stores enable row level security;

drop policy if exists "profiles_self_read" on profiles;
create policy "profiles_self_read" on profiles
for select to authenticated
using (auth.uid() = user_id or is_admin(auth.uid()));

drop policy if exists "profiles_self_write" on profiles;
create policy "profiles_self_write" on profiles
for update to authenticated
using (auth.uid() = user_id or is_admin(auth.uid()))
with check (auth.uid() = user_id or is_admin(auth.uid()));

-- admin full access policies
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'categories','products','subscriptions','payments','webhook_configs',
    'webhook_logs','stripe_event_logs','scheduler_jobs','stores'
  ]
  LOOP
    EXECUTE format('drop policy if exists "admin_all_%s" on %I', tbl, tbl);
    EXECUTE format('create policy "admin_all_%s" on %I for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()))', tbl, tbl);
  END LOOP;
END $$;

-- non-admin own data access
create policy "stores_owner" on stores
for all to authenticated
using (auth.uid() = user_id or is_admin(auth.uid()))
with check (auth.uid() = user_id or is_admin(auth.uid()));

create policy "subs_owner_read" on subscriptions
for select to authenticated
using (auth.uid() = user_id or is_admin(auth.uid()));

create policy "payments_owner_read" on payments
for select to authenticated
using (auth.uid() = user_id or is_admin(auth.uid()));
```

## SQL checksum
- SHA-256 (manually compute after pasting in SQL editor): `TO_BE_COMPUTED_IN_DB_PIPELINE`

## Commands to run
1. Execute SQL in Supabase SQL Editor.
2. Validate RLS policies with authenticated user + admin user.
3. `npm run lint`

## Verification checklist
- [ ] All required tables/columns exist.
- [ ] RLS enabled on all sensitive tables.
- [ ] Admin-only actions blocked for non-admin.
- [ ] First-user admin bootstrap works exactly once.
