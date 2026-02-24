import { NextRequest, NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";

type InputVariation = {
  name?: unknown;
  maliyet?: unknown;
  satisFiyati?: unknown;
};

type InputSubProduct = {
  name?: unknown;
  nameEn?: unknown;
  ornekGorsel?: unknown;
  uretimGorsel?: unknown;
  maliyet?: unknown;
  satisFiyati?: unknown;
  shipping?: unknown;
  cut?: unknown;
  margin?: unknown;
  netProfit?: unknown;
  variations?: unknown;
};

type InputPayload = {
  id?: unknown;
  name?: unknown;
  nameEn?: unknown;
  subProducts?: unknown;
};

type CategoryInsertRow = {
  slug: string;
  title_tr: string;
  title_en: string;
};

type CategoryInsertResult = {
  id: string;
  slug: string;
};

type ProductInsertRow = {
  category_id: string;
  title_tr: string;
  title_en: string;
  image_urls: string[];
  cost: number;
  shipping_cost: number;
  cut_percent: number;
  sale_price: number;
  margin_percent: number;
  net_profit: number;
  variations: Array<{ id: string; name: string; maliyet: number; satisFiyati: number }>;
};

const notFoundResponse = () => NextResponse.json({ error: "Not Found" }, { status: 404 });

const requireAdmin = async (request: NextRequest) => {
  const token = getAccessTokenFromRequest(request);
  if (!token) return null;

  const user = await getUserFromAccessToken(token);
  if (!user) return null;

  const profile = await getProfileByUserId(user.id, token);
  if (!profile || !isAdminRole(profile.role)) return null;

  return { user, profile };
};

const asTrimmedString = (value: unknown) => {
  return typeof value === "string" ? value.trim() : "";
};

const asNumber = (value: unknown, fallback: number, label: string) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} sayısal olmalı.`);
  }

  return parsed;
};

const slugify = (value: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "kategori";
};

const isDuplicateError = (error: PostgrestError | null) => {
  if (!error) {
    return false;
  }

  return error.code === "23505" || error.message.toLowerCase().includes("duplicate");
};

const isMissingColumnError = (error: PostgrestError | null, column: string) => {
  if (!error) {
    return false;
  }

  const pattern = new RegExp(`\\b${column}\\b`, "i");
  return pattern.test(error.message);
};

const hasAnyVariation = (rows: ProductInsertRow[]) => {
  return rows.some((row) => Array.isArray(row.variations) && row.variations.length > 0);
};

const createCategoryWithUniqueSlug = async (row: CategoryInsertRow): Promise<CategoryInsertResult> => {
  for (let index = 0; index < 20; index += 1) {
    const slug = index === 0 ? row.slug : `${row.slug}-${index + 1}`;
    const { data, error } = await supabaseAdmin
      .from("categories")
      .insert({ ...row, slug })
      .select("id, slug")
      .maybeSingle<CategoryInsertResult>();

    if (!error && data) {
      return data;
    }

    if (!isDuplicateError(error)) {
      throw new Error(error?.message || "Kategori oluşturulamadı.");
    }
  }

  throw new Error("Benzersiz kategori kodu oluşturulamadı.");
};

const normalizeVariations = (value: unknown, productName: string, fallbackCost: number, fallbackSalePrice: number) => {
  if (!Array.isArray(value)) {
    return [] as Array<{ id: string; name: string; maliyet: number; satisFiyati: number }>;
  }

  return value
    .filter((item): item is InputVariation => typeof item === "object" && item !== null)
    .map((variation, index) => {
      const name = asTrimmedString(variation.name);
      if (!name) {
        return null;
      }

      const maliyet = asNumber(variation.maliyet, fallbackCost, `${productName} varyasyon maliyeti`);
      const satisFiyati = asNumber(variation.satisFiyati, fallbackSalePrice, `${productName} varyasyon satış fiyatı`);
      return {
        id: `${slugify(productName)}-${index + 1}`,
        name,
        maliyet,
        satisFiyati,
      };
    })
    .filter((item): item is { id: string; name: string; maliyet: number; satisFiyati: number } => Boolean(item));
};

const normalizeSubProducts = (value: unknown): ProductInsertRow[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("En az bir alt ürün zorunlu.");
  }

  return value
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        throw new Error("Alt ürün verisi geçersiz.");
      }

      const subProduct = item as InputSubProduct;
      const name = asTrimmedString(subProduct.name);

      if (!name) {
        throw new Error("Alt ürün adı zorunlu.");
      }

      const nameEn = asTrimmedString(subProduct.nameEn);
      if (!nameEn) {
        throw new Error(`${name} için İngilizce alt ürün adı zorunlu.`);
      }
      const cost = asNumber(subProduct.maliyet, 0, `${name} maliyet`);
      const salePrice = asNumber(subProduct.satisFiyati, 0, `${name} satış fiyatı`);
      const shipping = asNumber(subProduct.shipping, 10, `${name} kargo`);
      const cut = asNumber(subProduct.cut, 24, `${name} komisyon`);
      const margin = asNumber(subProduct.margin, 25, `${name} marj`);
      const netProfit = asNumber(subProduct.netProfit, salePrice - cost - shipping, `${name} net kar`);

      const images = [asTrimmedString(subProduct.ornekGorsel), asTrimmedString(subProduct.uretimGorsel)]
        .filter(Boolean)
        .slice(0, 2);

      return {
        category_id: "",
        title_tr: name,
        title_en: nameEn,
        image_urls: images,
        cost,
        shipping_cost: shipping,
        cut_percent: cut,
        sale_price: salePrice,
        margin_percent: margin,
        net_profit: netProfit,
        variations: normalizeVariations(subProduct.variations, name, cost, salePrice),
      };
    })
    .filter(Boolean);
};

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return notFoundResponse();
  }

  try {
    const body = (await request.json()) as InputPayload;
    const categoryNameTr = asTrimmedString(body.name);
    const categoryNameEn = asTrimmedString(body.nameEn);

    if (!categoryNameTr) {
      return NextResponse.json({ error: "Kategori adı zorunlu." }, { status: 400 });
    }

    if (!categoryNameEn) {
      return NextResponse.json({ error: "Kategori İngilizce adı zorunlu." }, { status: 400 });
    }

    const requestedSlug = asTrimmedString(body.id);
    const categorySlug = slugify(requestedSlug || categoryNameTr);
    const subProducts = normalizeSubProducts(body.subProducts);

    const category = await createCategoryWithUniqueSlug({
      slug: categorySlug,
      title_tr: categoryNameTr,
      title_en: categoryNameEn,
    });

    const insertRows = subProducts.map((product) => ({
      ...product,
      category_id: category.id,
    }));

    const withVariationsResult = await supabaseAdmin
      .from("products")
      .insert(insertRows)
      .select("id");

    let productInsertError = withVariationsResult.error;

    if (isMissingColumnError(productInsertError, "variations")) {
      if (hasAnyVariation(insertRows)) {
        await supabaseAdmin.from("categories").delete().eq("id", category.id);
        return NextResponse.json(
          {
            error:
              "Products tablosunda 'variations' kolonu bulunamadı. Lütfen migration uygulayın (supabase/migrations/20260223003000_products_variations.sql).",
          },
          { status: 500 }
        );
      }

      const fallbackRows = insertRows.map((row) => {
        const nextRow = { ...row } as Omit<ProductInsertRow, "variations"> & {
          variations?: ProductInsertRow["variations"];
        };
        delete nextRow.variations;
        return nextRow;
      });
      const fallbackResult = await supabaseAdmin.from("products").insert(fallbackRows).select("id");
      productInsertError = fallbackResult.error;
    }

    if (productInsertError) {
      await supabaseAdmin.from("categories").delete().eq("id", category.id);
      return NextResponse.json({ error: productInsertError.message }, { status: 500 });
    }

    return NextResponse.json({
      message: "Kategori ve alt ürünler başarıyla kaydedildi.",
      category,
      createdProducts: insertRows.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kategori oluşturulamadı." },
      { status: 400 }
    );
  }
}
