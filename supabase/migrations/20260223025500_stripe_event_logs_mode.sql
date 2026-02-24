alter table if exists public.stripe_event_logs
  add column if not exists stripe_mode text;

update public.stripe_event_logs
set stripe_mode = case
  when lower(coalesce(payload ->> 'livemode', 'false')) = 'true' then 'live'
  else 'test'
end
where stripe_mode is null
   or stripe_mode not in ('live', 'test');

alter table if exists public.stripe_event_logs
  alter column stripe_mode set default 'live';

alter table if exists public.stripe_event_logs
  alter column stripe_mode set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stripe_event_logs_stripe_mode_check'
  ) then
    alter table public.stripe_event_logs
      add constraint stripe_event_logs_stripe_mode_check
      check (stripe_mode in ('live', 'test'));
  end if;
end $$;

create index if not exists idx_stripe_event_logs_mode_processed_at
  on public.stripe_event_logs (stripe_mode, processed_at desc);
