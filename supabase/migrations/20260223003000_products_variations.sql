alter table if exists public.products
  add column if not exists variations jsonb not null default '[]'::jsonb;
