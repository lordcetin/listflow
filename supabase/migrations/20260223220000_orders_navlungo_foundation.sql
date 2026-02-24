create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  store_id uuid references public.stores(id) on delete set null,
  category_name text not null,
  sub_product_name text not null,
  variant_name text,
  product_link text not null,
  order_date date not null default (now() at time zone 'utc')::date,
  shipping_address text not null,
  note text,
  ioss text,
  label_number text not null,
  amount_usd numeric(12,2) not null default 0 check (amount_usd >= 0),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_user_created_at
  on public.orders(user_id, created_at desc);

create index if not exists idx_orders_payment_status
  on public.orders(payment_status);

create index if not exists idx_orders_store_id
  on public.orders(store_id);

alter table if exists public.orders enable row level security;

drop policy if exists orders_owner_read on public.orders;
create policy orders_owner_read on public.orders
for select to authenticated
using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists orders_owner_insert on public.orders;
create policy orders_owner_insert on public.orders
for insert to authenticated
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists orders_owner_update on public.orders;
create policy orders_owner_update on public.orders
for update to authenticated
using (auth.uid() = user_id or public.is_admin(auth.uid()))
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists orders_owner_delete on public.orders;
create policy orders_owner_delete on public.orders
for delete to authenticated
using (auth.uid() = user_id or public.is_admin(auth.uid()));
