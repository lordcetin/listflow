# Supabase Migration Workflow (Prisma benzeri)

Bu projede Supabase için Prisma `db push` benzeri akış:

1. `npx supabase init`
2. `npx supabase link --project-ref <PROJECT_REF>`
3. `npx supabase db push`
4. `npx supabase gen types typescript --linked --schema public > lib/supabase/database.types.ts`

`package.json` script kısayolları:

- `npm run db:init`
- `npm run db:link` (önce `SUPABASE_PROJECT_REF` env ver)
- `npm run db:new`
- `npm run db:push`
- `npm run db:pull`
- `npm run db:types`

## Bu hatayı düzeltme

`Could not find the table 'public.subscriptions' in the schema cache`

Bu hata için migration'ı push et:

```bash
npm run db:push
```

Ardından tabloyu doğrula:

```sql
select to_regclass('public.subscriptions');
select to_regclass('public.stripe_plan_prices');
```

> `null` dönmemeli.

## Not

- Supabase'de Prisma `generate` karşılığı: `supabase gen types`.
- Prisma ORM de kullanılabilir ama RLS/policy/function yönetiminde Supabase migration SQL yaklaşımı daha doğrudur.
