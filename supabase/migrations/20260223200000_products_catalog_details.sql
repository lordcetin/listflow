alter table if exists public.products
  add column if not exists catalog_description text;

alter table if exists public.products
  add column if not exists catalog_youtube_url text;

alter table if exists public.products
  drop constraint if exists products_catalog_youtube_url_format_check;

alter table if exists public.products
  add constraint products_catalog_youtube_url_format_check
  check (
    catalog_youtube_url is null
    or btrim(catalog_youtube_url) = ''
    or catalog_youtube_url ~* '^(https?://)?(www\\.)?(youtube\\.com|youtu\\.be)/.+$'
  );
