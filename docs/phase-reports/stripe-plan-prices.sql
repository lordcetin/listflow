-- Required for admin-managed Stripe subscription plan sync.
-- Run in Supabase SQL Editor (remote).

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

alter table public.stripe_plan_prices enable row level security;

drop policy if exists admin_all_stripe_plan_prices on public.stripe_plan_prices;
create policy admin_all_stripe_plan_prices
  on public.stripe_plan_prices
  for all
  to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));
