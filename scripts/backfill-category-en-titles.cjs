#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { toCategoryEnglish, toProductEnglish, normalizeText } = require("./category-en-map.cjs");

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

const shouldTranslate = (titleTr, titleEn) => {
  const tr = normalizeText(titleTr);
  const en = normalizeText(titleEn);
  return !en || en === tr;
};

const main = async () => {
  loadEnv();

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: categories, error: categoriesError } = await supabase
    .from("categories")
    .select("id, slug, title_tr, title_en");

  if (categoriesError) {
    throw new Error(`categories load failed: ${categoriesError.message}`);
  }

  let categoriesUpdated = 0;
  let categoriesSkipped = 0;

  for (const row of categories || []) {
    const titleTr = String(row.title_tr || "").trim();
    const titleEn = String(row.title_en || "").trim();

    if (!shouldTranslate(titleTr, titleEn)) {
      categoriesSkipped += 1;
      continue;
    }

    const translated = toCategoryEnglish(row.slug, titleTr);
    if (!translated || normalizeText(translated) === normalizeText(titleTr)) {
      categoriesSkipped += 1;
      continue;
    }

    const { error } = await supabase
      .from("categories")
      .update({ title_en: translated, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (error) {
      throw new Error(`category update failed (${row.id}): ${error.message}`);
    }

    categoriesUpdated += 1;
  }

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, title_tr, title_en");

  if (productsError) {
    throw new Error(`products load failed: ${productsError.message}`);
  }

  let productsUpdated = 0;
  let productsSkipped = 0;

  for (const row of products || []) {
    const titleTr = String(row.title_tr || "").trim();
    const titleEn = String(row.title_en || "").trim();

    if (!shouldTranslate(titleTr, titleEn)) {
      productsSkipped += 1;
      continue;
    }

    const translated = toProductEnglish(titleTr);
    if (!translated || normalizeText(translated) === normalizeText(titleTr)) {
      productsSkipped += 1;
      continue;
    }

    const { error } = await supabase
      .from("products")
      .update({ title_en: translated, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (error) {
      throw new Error(`product update failed (${row.id}): ${error.message}`);
    }

    productsUpdated += 1;
  }

  console.log(
    `Backfill completed. Categories updated: ${categoriesUpdated}, skipped: ${categoriesSkipped}. Products updated: ${productsUpdated}, skipped: ${productsSkipped}.`
  );
};

main().catch((error) => {
  console.error(`Backfill failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

