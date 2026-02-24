alter table if exists public.profiles
  add column if not exists phone text;

alter table if exists public.profiles
  add column if not exists is_subscriber boolean not null default false;

alter table if exists public.profiles
  add column if not exists subscription_status text;

alter table if exists public.profiles
  add column if not exists subscription_plan text;

alter table if exists public.profiles
  add column if not exists stripe_customer_id text;

alter table if exists public.profiles
  add column if not exists subscription_updated_at timestamptz;

create index if not exists idx_profiles_email_lower on public.profiles (lower(email));
create index if not exists idx_profiles_is_subscriber on public.profiles (is_subscriber);
