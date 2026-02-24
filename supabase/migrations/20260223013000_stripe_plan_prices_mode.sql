alter table if exists public.stripe_plan_prices
  add column if not exists stripe_mode text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stripe_plan_prices'
      and column_name = 'mode'
  ) then
    execute $sql$
      update public.stripe_plan_prices
      set stripe_mode = coalesce(nullif(mode, ''), 'live')
      where stripe_mode is null or btrim(stripe_mode) = ''
    $sql$;
  else
    update public.stripe_plan_prices
    set stripe_mode = 'live'
    where stripe_mode is null or btrim(stripe_mode) = '';
  end if;
end $$;

alter table if exists public.stripe_plan_prices
  alter column stripe_mode set default 'live';

alter table if exists public.stripe_plan_prices
  alter column stripe_mode set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stripe_plan_prices_stripe_mode_check'
  ) then
    alter table public.stripe_plan_prices
      add constraint stripe_plan_prices_stripe_mode_check
      check (stripe_mode in ('live', 'test'));
  end if;
end $$;

alter table if exists public.stripe_plan_prices
  drop constraint if exists stripe_plan_prices_plan_interval_key;

alter table if exists public.stripe_plan_prices
  drop constraint if exists stripe_plan_prices_plan_interval_mode_key;

drop index if exists idx_stripe_plan_prices_plan_interval;
drop index if exists idx_stripe_plan_prices_plan_interval_mode;

create unique index if not exists idx_stripe_plan_prices_plan_interval_stripe_mode
  on public.stripe_plan_prices(plan, interval, stripe_mode);
