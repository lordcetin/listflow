import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadCatalogFallbackMap } from "@/lib/catalog/fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CategoryRow = {
  id: string;
  slug?: string | null;
  title_tr?: string | null;
  title_en?: string | null;
  name?: string | null;
  parent_id?: string | null;
};

type ProductRow = {
  id: string;
  category_id?: string | null;
  title_tr?: string | null;
  title_en?: string | null;
  title?: string | null;
  image_urls?: string[] | null;
  images?: string[] | null;
  catalog_description?: string | null;
  catalog_youtube_url?: string | null;
  cost?: number | null;
  sale_price?: number | null;
  margin_percent?: number | null;
  shipping_cost?: number | null;
  cut_percent?: number | null;
  net_profit?: number | null;
  variations?: unknown;
};

type VariationRow = {
  id?: unknown;
  name?: unknown;
  maliyet?: unknown;
  satisFiyati?: unknown;
  salePrice?: unknown;
};

type QueryError = {
  message: string;
  code?: string | null;
};

const CATEGORY_SELECT_CANDIDATES = [
  "id, slug, title_tr, title_en, parent_id",
  "id, slug, title_tr, title_en",
  "id, slug, name, parent_id",
  "id, slug, name",
  "id, title_tr, title_en, parent_id",
  "id, title_tr, title_en",
  "id, name",
] as const;

const PRODUCT_SELECT_CANDIDATES = [
  "id, category_id, title_tr, title_en, image_urls, catalog_description, catalog_youtube_url, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit, variations",
  "id, category_id, title_tr, title_en, images, catalog_description, catalog_youtube_url, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit, variations",
  "id, category_id, title_tr, title_en, image_urls, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit, variations",
  "id, category_id, title_tr, title_en, images, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit, variations",
  "id, category_id, title, image_urls, catalog_description, catalog_youtube_url, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit, variations",
  "id, category_id, title, images, catalog_description, catalog_youtube_url, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit, variations",
  "id, category_id, title, image_urls, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit, variations",
  "id, category_id, title, images, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit, variations",
  "id, category_id, title_tr, title_en, image_urls, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit",
  "id, category_id, title_tr, title_en, images, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit",
  "id, category_id, title, image_urls, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit",
  "id, category_id, title, images, cost, sale_price, margin_percent, shipping_cost, cut_percent, net_profit",
] as const;
const ORDER_BY_CANDIDATES = ["created_at", "id"] as const;

const isRecoverableSelectError = (error: QueryError | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("column") ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("failed to parse select")
  );
};

const selectWithFallback = async <T>(
  table: "categories" | "products",
  selectCandidates: readonly string[]
): Promise<T[]> => {
  let lastError: QueryError | null = null;

  outer:
  for (const select of selectCandidates) {
    for (const orderBy of ORDER_BY_CANDIDATES) {
      let query = supabaseAdmin
        .from(table)
        .select(select)
        .order(orderBy, { ascending: true });

      if (orderBy !== "id") {
        query = query.order("id", { ascending: true });
      }

      const { data, error } = await query;

      if (!error) {
        return (data as T[]) ?? [];
      }

      lastError = error;

      if (!isRecoverableSelectError(error)) {
        break outer;
      }
    }
  }

  throw new Error(lastError?.message || `${table} select failed`);
};

const normalizeVariations = (value: unknown, productId: string, fallbackSalePrice: number) => {
  let rowsValue = value;

  if (typeof rowsValue === "string") {
    try {
      rowsValue = JSON.parse(rowsValue);
    } catch {
      rowsValue = null;
    }
  }

  if (!Array.isArray(rowsValue)) {
    return undefined;
  }

  const rows = rowsValue
    .filter((item): item is VariationRow => typeof item === "object" && item !== null)
    .map((variation, index) => {
      const name = typeof variation.name === "string" ? variation.name.trim() : "";
      if (!name) {
        return null;
      }

      const maliyet = Number((variation as { cost?: unknown }).cost ?? variation.maliyet ?? 0);
      const rawSale =
        (variation as { sale_price?: unknown; price?: unknown }).sale_price ??
        (variation as { salePrice?: unknown }).salePrice ??
        (variation as { satisFiyati?: unknown }).satisFiyati ??
        (variation as { price?: unknown }).price ??
        fallbackSalePrice;
      const satisFiyati = Number(rawSale);
      return {
        id: typeof variation.id === "string" && variation.id.trim() ? variation.id : `${productId}-variation-${index + 1}`,
        name,
        maliyet: Number.isNaN(maliyet) ? 0 : maliyet,
        satisFiyati: Number.isNaN(satisFiyati) ? fallbackSalePrice : satisFiyati,
      };
    })
    .filter((item): item is { id: string; name: string; maliyet: number; satisFiyati: number } => Boolean(item));

  return rows.length ? rows : undefined;
};

export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") === "en" ? "en" : "tr";

  try {
    const categoriesRows = await selectWithFallback<CategoryRow>("categories", CATEGORY_SELECT_CANDIDATES);
    const productRows = await selectWithFallback<ProductRow>("products", PRODUCT_SELECT_CANDIDATES);
    const hasCatalogColumns = productRows.some(
      (product) =>
        Object.prototype.hasOwnProperty.call(product, "catalog_description") ||
        Object.prototype.hasOwnProperty.call(product, "catalog_youtube_url")
    );
    const catalogFallbackMap = hasCatalogColumns
      ? new Map<string, { catalogDescription: string | null; catalogYoutubeUrl: string | null }>()
      : await loadCatalogFallbackMap(productRows.map((product) => product.id));

    const categories = categoriesRows.map((category) => {
      const categoryId = category.slug || category.id;
      const title =
        locale === "en"
          ? category.title_en || category.title_tr || category.name || category.slug || category.id
          : category.title_tr || category.title_en || category.name || category.slug || category.id;

      const subProducts = productRows
        .filter(
          (product) =>
            product.category_id === category.id ||
            product.category_id === category.slug ||
            product.category_id === categoryId
        )
        .map((product) => {
          const images = (product.image_urls || product.images || []).slice(0, 2);
          const cost = Number(product.cost ?? 0);
          const salePrice = Number(product.sale_price ?? 0);
          const variations = normalizeVariations(product.variations, product.id, salePrice);
          const fallbackCatalog = catalogFallbackMap.get(product.id);
          const descriptionFromProduct =
            typeof product.catalog_description === "string" ? product.catalog_description : "";
          const youtubeFromProduct =
            typeof product.catalog_youtube_url === "string" ? product.catalog_youtube_url : "";
          const catalogDescription = hasCatalogColumns
            ? descriptionFromProduct
            : fallbackCatalog?.catalogDescription ?? "";
          const catalogYoutubeUrl = hasCatalogColumns ? youtubeFromProduct : fallbackCatalog?.catalogYoutubeUrl ?? "";

          return {
            id: product.id,
            name:
              locale === "en"
                ? product.title_en || product.title_tr || product.title || product.id
                : product.title_tr || product.title_en || product.title || product.id,
            ornekGorsel: images[0] || "https://picsum.photos/seed/default-ref/200",
            uretimGorsel: images[1] || images[0] || "https://picsum.photos/seed/default-prod/200",
            maliyet: cost,
            satisFiyati: salePrice,
            shipping: Number(product.shipping_cost ?? 10),
            cut: Number(product.cut_percent ?? 24),
            margin: Number(product.margin_percent ?? 25),
            netProfit: Number(product.net_profit ?? salePrice - cost),
            catalogDescription,
            catalogYoutubeUrl,
            variations,
          };
        });

      return {
        id: categoryId,
        dbId: category.id,
        slug: category.slug || null,
        name: title,
        subProducts,
      };
    });

    return NextResponse.json(
      { categories, source: "database" },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Categories could not be loaded";
    return NextResponse.json(
      { categories: [], source: "database_error", error: message },
      { status: 500 }
    );
  }
}
