#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createClient } = require("@supabase/supabase-js");
const { toCategoryEnglish, toProductEnglish } = require("./category-en-map.cjs");

const ENV_FILES = [".env", ".env.local"];

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length) : trimmed;
    const equalsIndex = withoutExport.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, equalsIndex).trim();
    if (!key) {
      continue;
    }

    let value = withoutExport.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
};

const loadEnv = () => {
  for (const file of ENV_FILES) {
    loadEnvFile(path.resolve(process.cwd(), file));
  }
};

const requireEnv = (key) => {
  const value = process.env[key];

  if (!value || !value.trim()) {
    throw new Error(`Missing required env variable: ${key}`);
  }

  return value.trim();
};

const normalizeSlug = (value) => {
  const normalized = String(value ?? "")
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

const getProjectRefFromUrl = (url) => {
  const match = String(url || "").match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match ? match[1] : "unknown";
};

const loadStaticCategories = () => {
  const filePath = path.resolve(process.cwd(), "data/categories.ts");
  const raw = fs.readFileSync(filePath, "utf8");

  const transformed = raw
    .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
    .replace(/export\s+const\s+CATEGORIES\s*:\s*Category\[\]\s*=\s*/, "const CATEGORIES = ");

  const wrapped = `"use strict";\n${transformed}\nmodule.exports = { CATEGORIES };`;
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(wrapped, sandbox, { filename: filePath, timeout: 1000 });

  const categories = sandbox.module.exports.CATEGORIES;

  if (!Array.isArray(categories)) {
    throw new Error("Could not parse CATEGORIES from data/categories.ts");
  }

  return categories;
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const computeNetProfit = (cost, salePrice, shippingCost, cutPercent) => {
  if (salePrice <= 0) {
    return 0;
  }

  const fee = salePrice * (cutPercent / 100);
  return Number((salePrice - (cost + shippingCost + fee)).toFixed(2));
};

const buildVariations = (subProduct, fallbackCost, fallbackSalePrice) => {
  if (!Array.isArray(subProduct.variations)) {
    return [];
  }

  const productSlug = normalizeSlug(subProduct.name || "urun");

  return subProduct.variations
    .map((variation, index) => {
      const name = String(variation?.name ?? "").trim();
      if (!name) {
        return null;
      }

      return {
        id: typeof variation?.id === "string" && variation.id.trim() ? variation.id : `${productSlug}-${index + 1}`,
        name,
        maliyet: toNumber(variation?.maliyet, fallbackCost),
        satisFiyati: toNumber(variation?.satisFiyati, fallbackSalePrice),
      };
    })
    .filter(Boolean);
};

const upsertCategory = async (supabase, category) => {
  const now = new Date().toISOString();
  const slug = normalizeSlug(category.id || category.name);
  const title = String(category.name || slug).trim() || slug;
  const titleEn = toCategoryEnglish(slug, title) || title;

  const { data, error } = await supabase
    .from("categories")
    .upsert(
      {
        slug,
        title_tr: title,
        title_en: titleEn,
        updated_at: now,
      },
      { onConflict: "slug" }
    )
    .select("id, slug")
    .maybeSingle();

  if (error) {
    throw new Error(`Category upsert failed (${slug}): ${error.message}`);
  }

  if (!data?.id) {
    const fallback = await supabase
      .from("categories")
      .select("id, slug")
      .eq("slug", slug)
      .maybeSingle();

    if (fallback.error || !fallback.data?.id) {
      throw new Error(`Category lookup failed (${slug}): ${fallback.error?.message || "not found"}`);
    }

    return fallback.data;
  }

  return data;
};

const upsertProduct = async (supabase, categoryId, subProduct) => {
  const now = new Date().toISOString();
  const titleTr = String(subProduct.name || "").trim();

  if (!titleTr) {
    return "skipped";
  }

  const titleEn = String(subProduct.nameEn || "").trim() || toProductEnglish(titleTr) || titleTr;
  const cost = toNumber(subProduct.maliyet, 0);
  const salePrice = toNumber(subProduct.satisFiyati, 0);
  const shippingCost = toNumber(subProduct.shipping, 10);
  const cutPercent = toNumber(subProduct.cut, 24);
  const marginPercent = toNumber(subProduct.margin, 25);
  const netProfit = toNumber(
    subProduct.netProfit,
    computeNetProfit(cost, salePrice, shippingCost, cutPercent)
  );

  const imageUrls = [subProduct.ornekGorsel, subProduct.uretimGorsel]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 2);

  const variations = buildVariations(subProduct, cost, salePrice);

  const payload = {
    category_id: categoryId,
    title_tr: titleTr,
    title_en: titleEn,
    image_urls: imageUrls,
    cost,
    shipping_cost: shippingCost,
    cut_percent: cutPercent,
    sale_price: salePrice,
    margin_percent: marginPercent,
    net_profit: netProfit,
    variations,
    updated_at: now,
  };

  const updateAttempt = await supabase
    .from("products")
    .update(payload)
    .eq("category_id", categoryId)
    .eq("title_tr", titleTr)
    .select("id");

  if (updateAttempt.error) {
    if ((updateAttempt.error.message || "").toLowerCase().includes("variations")) {
      throw new Error(
        "Missing products.variations column. Run migrations first (npm run db:push) and retry."
      );
    }

    throw new Error(`Product update failed (${titleTr}): ${updateAttempt.error.message}`);
  }

  if (Array.isArray(updateAttempt.data) && updateAttempt.data.length > 0) {
    return "updated";
  }

  const insertAttempt = await supabase.from("products").insert(payload);

  if (insertAttempt.error) {
    if ((insertAttempt.error.message || "").toLowerCase().includes("variations")) {
      throw new Error(
        "Missing products.variations column. Run migrations first (npm run db:push) and retry."
      );
    }

    throw new Error(`Product insert failed (${titleTr}): ${insertAttempt.error.message}`);
  }

  return "inserted";
};

const main = async () => {
  loadEnv();

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const categories = loadStaticCategories();
  const projectRef = getProjectRefFromUrl(supabaseUrl);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log(`Seeding target Supabase project: ${projectRef}`);

  const preflight = await supabase
    .from("products")
    .select("id, variations")
    .limit(1);

  if (preflight.error) {
    if ((preflight.error.message || "").toLowerCase().includes("variations")) {
      throw new Error(
        `Missing products.variations column on project ${projectRef}. Add it first, then retry.`
      );
    }

    throw new Error(`Preflight failed on project ${projectRef}: ${preflight.error.message}`);
  }

  let categoryCount = 0;
  let productInserted = 0;
  let productUpdated = 0;
  let productSkipped = 0;

  for (const category of categories) {
    const savedCategory = await upsertCategory(supabase, category);
    categoryCount += 1;

    const subProducts = Array.isArray(category.subProducts) ? category.subProducts : [];

    for (const subProduct of subProducts) {
      const result = await upsertProduct(supabase, savedCategory.id, subProduct);

      if (result === "inserted") productInserted += 1;
      if (result === "updated") productUpdated += 1;
      if (result === "skipped") productSkipped += 1;
    }
  }

  console.log(
    `Seed completed. Categories: ${categoryCount}, Products inserted: ${productInserted}, Products updated: ${productUpdated}, Products skipped: ${productSkipped}`
  );
};

main().catch((error) => {
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
