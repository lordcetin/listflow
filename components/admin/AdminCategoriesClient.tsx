"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type VariationDraft = {
  localId: string;
  name: string;
  maliyet: string;
  satisFiyati: string;
};

type SubProductDraft = {
  localId: string;
  name: string;
  nameEn: string;
  ornekGorsel: string;
  uretimGorsel: string;
  maliyet: string;
  satisFiyati: string;
  shipping: string;
  cut: string;
  margin: string;
  netProfit: string;
  variations: VariationDraft[];
};

type SubProductTextField = Exclude<keyof SubProductDraft, "localId" | "variations">;

type CategoryRow = {
  id: string;
  slug: string;
  title_tr: string;
  title_en: string;
  created_at: string | null;
  updated_at: string | null;
};

type ProductRow = {
  id: string;
  category_id: string | null;
  title_tr: string;
  title_en: string;
  image_urls: string[];
  cost: number;
  shipping_cost: number;
  cut_percent: number;
  sale_price: number;
  margin_percent: number;
  net_profit: number;
  variations: unknown[];
};

type VariationPreview = {
  id: string;
  name: string;
  maliyet: number;
  satisFiyati: number;
};

type ProductEditDraft = {
  localId: string;
  id: string | null;
  title_tr: string;
  title_en: string;
  image_urls: string;
  cost: string;
  shipping_cost: string;
  cut_percent: string;
  sale_price: string;
  margin_percent: string;
  net_profit: string;
  variationsText: string;
};

type EditCategoryDraft = {
  id: string;
  slug: string;
  title_tr: string;
  title_en: string;
};

type AdminRowsResponse<T> = {
  rows?: T[];
  error?: string;
};

const createLocalId = () => {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2);
};

const createVariationDraft = (): VariationDraft => ({
  localId: createLocalId(),
  name: "",
  maliyet: "",
  satisFiyati: "",
});

const createSubProductDraft = (): SubProductDraft => ({
  localId: createLocalId(),
  name: "",
  nameEn: "",
  ornekGorsel: "",
  uretimGorsel: "",
  maliyet: "",
  satisFiyati: "",
  shipping: "10",
  cut: "24",
  margin: "25",
  netProfit: "",
  variations: [],
});

const createProductEditDraft = (): ProductEditDraft => ({
  localId: createLocalId(),
  id: null,
  title_tr: "",
  title_en: "",
  image_urls: "",
  cost: "0",
  shipping_cost: "10",
  cut_percent: "24",
  sale_price: "0",
  margin_percent: "25",
  net_profit: "0",
  variationsText: "[]",
});

const asTrimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const parseRequiredNumber = (value: string, label: string) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} sayısal olmalı.`);
  }
  return parsed;
};

const normalizeStringArray = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [] as string[];
};

const normalizeVariationPreview = (value: unknown): VariationPreview[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const row = item as Record<string, unknown>;
      const name = asTrimmedString(row.name) || `Varyasyon ${index + 1}`;
      const maliyet = toNumber(row.maliyet ?? row.cost, 0);
      const satisFiyati = toNumber(
        row.satisFiyati ?? row.sale_price ?? row.salePrice ?? row.price,
        0
      );

      return {
        id: asTrimmedString(row.id) || `${name}-${index}`,
        name,
        maliyet,
        satisFiyati,
      };
    })
    .filter((item): item is VariationPreview => Boolean(item));
};

const formatMoney = (value: number) => `$${value.toFixed(2)}`;

const parseNumber = (value: string, label: string) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} sayısal olmalı.`);
  }
  return parsed;
};

const normalizeCategoryRow = (row: Record<string, unknown>): CategoryRow => ({
  id: asTrimmedString(row.id),
  slug: asTrimmedString(row.slug),
  title_tr: asTrimmedString(row.title_tr),
  title_en: asTrimmedString(row.title_en),
  created_at: typeof row.created_at === "string" ? row.created_at : null,
  updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
});

const normalizeProductRow = (row: Record<string, unknown>): ProductRow => {
  const imageUrls = normalizeStringArray(row.image_urls ?? row.images).slice(0, 2);
  const variations = Array.isArray(row.variations) ? row.variations : [];

  return {
    id: asTrimmedString(row.id),
    category_id: asTrimmedString(row.category_id) || null,
    title_tr: asTrimmedString(row.title_tr || row.title),
    title_en: asTrimmedString(row.title_en || row.title),
    image_urls: imageUrls,
    cost: toNumber(row.cost, 0),
    shipping_cost: toNumber(row.shipping_cost, 10),
    cut_percent: toNumber(row.cut_percent, 24),
    sale_price: toNumber(row.sale_price, 0),
    margin_percent: toNumber(row.margin_percent, 25),
    net_profit: toNumber(row.net_profit, 0),
    variations,
  };
};

const toProductEditDraft = (product: ProductRow): ProductEditDraft => ({
  localId: createLocalId(),
  id: product.id,
  title_tr: product.title_tr,
  title_en: product.title_en,
  image_urls: product.image_urls.join(", "),
  cost: String(product.cost),
  shipping_cost: String(product.shipping_cost),
  cut_percent: String(product.cut_percent),
  sale_price: String(product.sale_price),
  margin_percent: String(product.margin_percent),
  net_profit: String(product.net_profit),
  variationsText: JSON.stringify(product.variations, null, 2),
});

const fetchAdminRows = async <T extends Record<string, unknown>>(endpoint: string): Promise<T[]> => {
  const response = await fetch(`/api/admin/${endpoint}`, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as AdminRowsResponse<T>;

  if (!response.ok) {
    throw new Error(body.error || `${endpoint} yüklenemedi.`);
  }

  return body.rows ?? [];
};

const requestAdmin = async (url: string, init: RequestInit, fallbackMessage: string) => {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(body.error || fallbackMessage);
  }
};

const isMissingVariationsColumnError = (message: string) => {
  const lower = message.toLowerCase();
  return lower.includes("variations") && lower.includes("column");
};

const getProductPayloadFromDraft = (draft: ProductEditDraft, categoryId: string) => {
  const titleTr = draft.title_tr.trim();
  if (!titleTr) {
    throw new Error("Alt ürün adı (TR) zorunlu.");
  }

  const titleEn = draft.title_en.trim();
  if (!titleEn) {
    throw new Error(`${titleTr} için alt ürün adı (EN) zorunlu.`);
  }
  const cost = parseRequiredNumber(draft.cost, `${titleTr} maliyet`);
  const shippingCost = parseRequiredNumber(draft.shipping_cost, `${titleTr} kargo`);
  const cutPercent = parseRequiredNumber(draft.cut_percent, `${titleTr} komisyon`);
  const salePrice = parseRequiredNumber(draft.sale_price, `${titleTr} satış fiyatı`);
  const marginPercent = parseRequiredNumber(draft.margin_percent, `${titleTr} marj`);
  const netProfit = draft.net_profit.trim()
    ? parseRequiredNumber(draft.net_profit, `${titleTr} net kar`)
    : salePrice - cost - shippingCost;

  const imageUrls = draft.image_urls
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);

  let variations: unknown[] = [];
  if (draft.variationsText.trim()) {
    try {
      const parsed = JSON.parse(draft.variationsText);
      if (!Array.isArray(parsed)) {
        throw new Error();
      }
      variations = parsed;
    } catch {
      throw new Error(`${titleTr} varyasyon alanı geçerli JSON dizi olmalı.`);
    }
  }

  return {
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
  };
};

const formatDate = (value: string | null) => {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("tr-TR");
};

export default function AdminCategoriesClient() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [categoryCode, setCategoryCode] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryNameEn, setCategoryNameEn] = useState("");
  const [subProducts, setSubProducts] = useState<SubProductDraft[]>([createSubProductDraft()]);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<EditCategoryDraft | null>(null);
  const [editProducts, setEditProducts] = useState<ProductEditDraft[]>([]);
  const [deletedProductIds, setDeletedProductIds] = useState<string[]>([]);

  const productsByCategory = useMemo(() => {
    const map = new Map<string, ProductRow[]>();

    for (const product of products) {
      if (!product.category_id) {
        continue;
      }

      const list = map.get(product.category_id) ?? [];
      list.push(product);
      map.set(product.category_id, list);
    }

    return map;
  }, [products]);

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [categories]);

  const totalVariationCount = useMemo(() => {
    return products.reduce((total, product) => total + normalizeVariationPreview(product.variations).length, 0);
  }, [products]);

  const draftVariationCount = useMemo(
    () => subProducts.reduce((total, product) => total + product.variations.length, 0),
    [subProducts]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [categoryRows, productRows] = await Promise.all([
        fetchAdminRows<Record<string, unknown>>("categories"),
        fetchAdminRows<Record<string, unknown>>("products"),
      ]);

      const normalizedCategories = categoryRows
        .map((row) => normalizeCategoryRow(row))
        .filter((row) => Boolean(row.id));

      const normalizedProducts = productRows
        .map((row) => normalizeProductRow(row))
        .filter((row) => Boolean(row.id));

      setCategories(normalizedCategories);
      setProducts(normalizedProducts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kategori verisi yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resetCreateForm = () => {
    setCategoryCode("");
    setCategoryName("");
    setCategoryNameEn("");
    setSubProducts([createSubProductDraft()]);
  };

  const setSubProductField = (localId: string, key: SubProductTextField, value: string) => {
    setSubProducts((prev) =>
      prev.map((item) => {
        if (item.localId !== localId) {
          return item;
        }

        return {
          ...item,
          [key]: value,
        };
      })
    );
  };

  const addSubProduct = () => {
    setSubProducts((prev) => [...prev, createSubProductDraft()]);
  };

  const removeSubProduct = (localId: string) => {
    setSubProducts((prev) => {
      if (prev.length === 1) {
        return prev;
      }

      return prev.filter((item) => item.localId !== localId);
    });
  };

  const addVariation = (subProductLocalId: string) => {
    setSubProducts((prev) =>
      prev.map((item) => {
        if (item.localId !== subProductLocalId) {
          return item;
        }

        return {
          ...item,
          variations: [...item.variations, createVariationDraft()],
        };
      })
    );
  };

  const setVariationField = (
    subProductLocalId: string,
    variationLocalId: string,
    key: keyof VariationDraft,
    value: string
  ) => {
    setSubProducts((prev) =>
      prev.map((item) => {
        if (item.localId !== subProductLocalId) {
          return item;
        }

        return {
          ...item,
          variations: item.variations.map((variation) => {
            if (variation.localId !== variationLocalId) {
              return variation;
            }

            return {
              ...variation,
              [key]: value,
            };
          }),
        };
      })
    );
  };

  const removeVariation = (subProductLocalId: string, variationLocalId: string) => {
    setSubProducts((prev) =>
      prev.map((item) => {
        if (item.localId !== subProductLocalId) {
          return item;
        }

        return {
          ...item,
          variations: item.variations.filter((variation) => variation.localId !== variationLocalId),
        };
      })
    );
  };

  const createStructuredCategory = async () => {
    setSavingCreate(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (!categoryName.trim()) {
        throw new Error("Kategori adı zorunlu.");
      }

      if (!categoryNameEn.trim()) {
        throw new Error("Kategori adı (EN) zorunlu.");
      }

      const hasEmptySubProductName = subProducts.some((product) => !product.name.trim());
      if (hasEmptySubProductName) {
        throw new Error("Tüm alt ürünlerde ad alanı zorunlu.");
      }

      const hasEmptySubProductNameEn = subProducts.some((product) => !product.nameEn.trim());
      if (hasEmptySubProductNameEn) {
        throw new Error("Tüm alt ürünlerde İngilizce ad alanı zorunlu.");
      }

      const payload = {
        id: categoryCode.trim() || undefined,
        name: categoryName.trim(),
        nameEn: categoryNameEn.trim(),
        subProducts: subProducts.map((product) => {
          const maliyet = parseNumber(product.maliyet || "0", `${product.name} maliyet`);
          const satisFiyati = parseNumber(product.satisFiyati || "0", `${product.name} satış fiyatı`);
          const shipping = parseNumber(product.shipping || "10", `${product.name} kargo`);
          const cut = parseNumber(product.cut || "24", `${product.name} komisyon`);
          const margin = parseNumber(product.margin || "25", `${product.name} marj`);
          const netProfit = product.netProfit.trim()
            ? parseNumber(product.netProfit, `${product.name} net kar`)
            : satisFiyati - maliyet - shipping;

          const variations = product.variations
            .filter((variation) => variation.name.trim())
            .map((variation) => ({
              name: variation.name.trim(),
              maliyet: variation.maliyet.trim() ? parseNumber(variation.maliyet, `${variation.name} maliyet`) : maliyet,
              satisFiyati: variation.satisFiyati.trim()
                ? parseNumber(variation.satisFiyati, `${variation.name} satış fiyatı`)
                : satisFiyati,
            }));

          return {
            name: product.name.trim(),
            nameEn: product.nameEn.trim(),
            ornekGorsel: product.ornekGorsel.trim() || undefined,
            uretimGorsel: product.uretimGorsel.trim() || undefined,
            maliyet,
            satisFiyati,
            shipping,
            cut,
            margin,
            netProfit,
            variations,
          };
        }),
      };

      const response = await fetch("/api/admin/categories/structured-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        createdProducts?: number;
      };

      if (!response.ok) {
        throw new Error(body.error || "Kategori oluşturulamadı.");
      }

      setSuccessMessage(body.message || `Kategori oluşturuldu. ${body.createdProducts ?? 0} alt ürün eklendi.`);
      resetCreateForm();
      setCreateModalOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kategori oluşturulamadı.");
    } finally {
      setSavingCreate(false);
    }
  };

  const openEditModal = (category: CategoryRow) => {
    const relatedProducts = productsByCategory.get(category.id) ?? [];

    setEditCategory({
      id: category.id,
      slug: category.slug,
      title_tr: category.title_tr,
      title_en: category.title_en,
    });

    setEditProducts(
      relatedProducts.length > 0
        ? relatedProducts.map((product) => toProductEditDraft(product))
        : [createProductEditDraft()]
    );
    setDeletedProductIds([]);
    setEditModalOpen(true);
  };

  const setEditCategoryField = (key: keyof EditCategoryDraft, value: string) => {
    setEditCategory((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
  };

  const setEditProductField = (localId: string, key: keyof ProductEditDraft, value: string) => {
    setEditProducts((prev) =>
      prev.map((item) => {
        if (item.localId !== localId) {
          return item;
        }

        return {
          ...item,
          [key]: value,
        };
      })
    );
  };

  const addEditProduct = () => {
    setEditProducts((prev) => [...prev, createProductEditDraft()]);
  };

  const removeEditProduct = (localId: string) => {
    setEditProducts((prev) => {
      const target = prev.find((item) => item.localId === localId);
      if (target?.id) {
        setDeletedProductIds((current) => Array.from(new Set([...current, target.id as string])));
      }

      if (prev.length === 1) {
        return prev;
      }

      return prev.filter((item) => item.localId !== localId);
    });
  };

  const saveCategoryAndProducts = async () => {
    if (!editCategory) {
      return;
    }

    setSavingEdit(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const slug = editCategory.slug.trim();
      const titleTr = editCategory.title_tr.trim();
      const titleEn = editCategory.title_en.trim();

      if (!slug) {
        throw new Error("Slug zorunlu.");
      }

      if (!titleTr) {
        throw new Error("Başlık (TR) zorunlu.");
      }

      if (!titleEn) {
        throw new Error("Başlık (EN) zorunlu.");
      }

      await requestAdmin(
        `/api/admin/categories/${editCategory.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            title_tr: titleTr,
            title_en: titleEn,
          }),
        },
        "Kategori güncellenemedi."
      );

      for (const productId of deletedProductIds) {
        await requestAdmin(
          `/api/admin/products/${productId}`,
          { method: "DELETE" },
          "Alt ürün silinemedi."
        );
      }

      for (const draft of editProducts) {
        const payload = getProductPayloadFromDraft(draft, editCategory.id);
        const payloadWithoutVariations = { ...payload };
        delete (payloadWithoutVariations as { variations?: unknown }).variations;

        if (draft.id) {
          try {
            await requestAdmin(
              `/api/admin/products/${draft.id}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              },
              "Alt ürün güncellenemedi."
            );
          } catch (err) {
            if (!(err instanceof Error) || !isMissingVariationsColumnError(err.message)) {
              throw err;
            }

            await requestAdmin(
              `/api/admin/products/${draft.id}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payloadWithoutVariations),
              },
              "Alt ürün güncellenemedi."
            );
          }
        } else {
          try {
            await requestAdmin(
              "/api/admin/products",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              },
              "Alt ürün oluşturulamadı."
            );
          } catch (err) {
            if (!(err instanceof Error) || !isMissingVariationsColumnError(err.message)) {
              throw err;
            }

            await requestAdmin(
              "/api/admin/products",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payloadWithoutVariations),
              },
              "Alt ürün oluşturulamadı."
            );
          }
        }
      }

      setSuccessMessage("Kategori ve alt ürünler güncellendi.");
      setEditModalOpen(false);
      setEditCategory(null);
      setEditProducts([]);
      setDeletedProductIds([]);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kategori güncellenemedi.");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteCategory = async (category: CategoryRow) => {
    const confirmed = window.confirm(
      `${category.title_tr} kategorisini ve alt ürünlerini silmek istediğine emin misin?`
    );
    if (!confirmed) {
      return;
    }

    setDeletingCategoryId(category.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const relatedProducts = productsByCategory.get(category.id) ?? [];

      for (const product of relatedProducts) {
        await requestAdmin(
          `/api/admin/products/${product.id}`,
          { method: "DELETE" },
          "Alt ürün silinemedi."
        );
      }

      await requestAdmin(
        `/api/admin/categories/${category.id}`,
        { method: "DELETE" },
        "Kategori silinemedi."
      );

      setSuccessMessage("Kategori ve alt ürünler silindi.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kategori silinemedi.");
    } finally {
      setDeletingCategoryId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="glass-card-pro rounded-[32px]">
        <CardHeader className="space-y-2">
          <Badge className="w-fit">Categories</Badge>
          <CardTitle>Kategori ve Alt Ürün Yönetimi</CardTitle>
          <CardDescription>
            Ürünler ayrı sayfada değil, kategori kartlarının altında yönetilir.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {categories.length} kategori / {products.length} alt ürün / {totalVariationCount} varyasyon
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="cursor-pointer" onClick={() => void loadData()} disabled={loading}>
              Yenile
            </Button>
            <Button className="cursor-pointer" onClick={() => setCreateModalOpen(true)}>Kategori Ekle</Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Hata</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert variant="success">
          <AlertTitle>Başarılı</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {sortedCategories.map((category) => {
        const categoryProducts = productsByCategory.get(category.id) ?? [];

        return (
          <Card key={category.id} className="glass-card-pro rounded-[32px]">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{category.slug || "-"}</Badge>
                  <Badge variant="outline">{categoryProducts.length} alt ürün</Badge>
                </div>
                <CardTitle className="text-xl">{category.title_tr || "-"}</CardTitle>
                <CardDescription>
                  EN: {category.title_en || "-"} • Güncelleme: {formatDate(category.updated_at)}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" className="cursor-pointer" size="sm" onClick={() => openEditModal(category)}>
                  Düzenle
                </Button>
                <Button
                  variant="destructive"
                  className="cursor-pointer"
                  size="sm"
                  onClick={() => void deleteCategory(category)}
                  disabled={deletingCategoryId === category.id}
                >
                  {deletingCategoryId === category.id ? "Siliniyor..." : "Sil"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {categoryProducts.length === 0 ? (
                <p className="text-sm text-slate-500">Bu kategori altında henüz alt ürün yok.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alt Ürün</TableHead>
                      <TableHead>Fiyatlar</TableHead>
                      <TableHead>Varyasyonlar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryProducts.map((product) => {
                      const variations = normalizeVariationPreview(product.variations);
                      return (
                        <TableRow key={product.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-black text-white">{product.title_tr || "-"}</p>
                              <p className="text-xs text-slate-400">{product.title_en || "-"}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-xs">
                              <p className="text-slate-300">Maliyet: {formatMoney(product.cost)}</p>
                              <p className="text-slate-300">Satış: {formatMoney(product.sale_price)}</p>
                              <p className="text-slate-400">
                                Kargo: {formatMoney(product.shipping_cost)} • Net: {formatMoney(product.net_profit)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            {variations.length === 0 ? (
                              <span className="text-xs text-slate-500">Varyasyon yok</span>
                            ) : (
                              <div className="space-y-1">
                                {variations.map((variation) => (
                                  <div key={variation.id} className="text-xs text-slate-300">
                                    {variation.name}: {formatMoney(variation.maliyet)} / {formatMoney(variation.satisFiyati)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-none w-[96vw] h-[94vh] p-0 overflow-hidden">
          <div className="flex h-full flex-col">
            <DialogHeader className="px-6 py-4 border-b border-white/10">
              <DialogTitle>Kategori Ekle</DialogTitle>
              <DialogDescription>
                Kategori, alt ürünler ve varyasyonlar tek adımda oluşturulur.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <Card className="rounded-2xl">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm">Kategori Bilgisi</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Kategori Kodu</p>
                    <Input value={categoryCode} onChange={(event) => setCategoryCode(event.target.value)} placeholder="tig-isi" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Başlık (TR)</p>
                    <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Tığ İşi" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Başlık (EN)</p>
                    <Input value={categoryNameEn} onChange={(event) => setCategoryNameEn(event.target.value)} placeholder="Crochet" />
                  </div>
                </CardContent>
              </Card>

              {subProducts.map((product, productIndex) => (
                <Card key={product.localId} className="rounded-2xl">
                  <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-sm">Alt Ürün {productIndex + 1}</CardTitle>
                    <Button
                      variant="destructive"
                      className="cursor-pointer"
                      size="sm"
                      onClick={() => removeSubProduct(product.localId)}
                      disabled={savingCreate || subProducts.length === 1}
                    >
                      Alt Ürünü Sil
                    </Button>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Input value={product.name} onChange={(event) => setSubProductField(product.localId, "name", event.target.value)} placeholder="Alt Ürün Adı (TR)" />
                      <Input value={product.nameEn} onChange={(event) => setSubProductField(product.localId, "nameEn", event.target.value)} placeholder="Alt Ürün Adı (EN)" />
                      <Input value={product.ornekGorsel} onChange={(event) => setSubProductField(product.localId, "ornekGorsel", event.target.value)} placeholder="Örnek Görsel URL" />
                      <Input value={product.uretimGorsel} onChange={(event) => setSubProductField(product.localId, "uretimGorsel", event.target.value)} placeholder="Üretim Görsel URL" />
                      <Input type="number" step="0.01" value={product.maliyet} onChange={(event) => setSubProductField(product.localId, "maliyet", event.target.value)} placeholder="Maliyet" />
                      <Input type="number" step="0.01" value={product.satisFiyati} onChange={(event) => setSubProductField(product.localId, "satisFiyati", event.target.value)} placeholder="Satış Fiyatı" />
                      <Input type="number" step="0.01" value={product.shipping} onChange={(event) => setSubProductField(product.localId, "shipping", event.target.value)} placeholder="Kargo" />
                      <Input type="number" step="0.01" value={product.cut} onChange={(event) => setSubProductField(product.localId, "cut", event.target.value)} placeholder="Komisyon %" />
                      <Input type="number" step="0.01" value={product.margin} onChange={(event) => setSubProductField(product.localId, "margin", event.target.value)} placeholder="Marj %" />
                      <Input type="number" step="0.01" value={product.netProfit} onChange={(event) => setSubProductField(product.localId, "netProfit", event.target.value)} placeholder="Net Kar" />
                    </div>

                    <Card className="rounded-xl">
                      <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between space-y-0">
                        <CardTitle className="text-xs">Varyasyonlar</CardTitle>
                        <Button size="sm" variant="secondary" className="cursor-pointer" onClick={() => addVariation(product.localId)} disabled={savingCreate}>
                          Varyasyon Ekle
                        </Button>
                      </CardHeader>
                      <CardContent className="p-3 pt-0 space-y-2">
                        {product.variations.length === 0 ? (
                          <p className="text-xs text-slate-500">Henüz varyasyon eklenmedi.</p>
                        ) : null}
                        {product.variations.map((variation) => (
                          <div key={variation.localId} className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px_auto] gap-2">
                            <Input
                              value={variation.name}
                              onChange={(event) =>
                                setVariationField(product.localId, variation.localId, "name", event.target.value)
                              }
                              placeholder="Varyasyon Adı"
                            />
                            <Input
                              type="number"
                              step="0.01"
                              value={variation.maliyet}
                              onChange={(event) =>
                                setVariationField(product.localId, variation.localId, "maliyet", event.target.value)
                              }
                              placeholder="Maliyet"
                            />
                            <Input
                              type="number"
                              step="0.01"
                              value={variation.satisFiyati}
                              onChange={(event) =>
                                setVariationField(product.localId, variation.localId, "satisFiyati", event.target.value)
                              }
                              placeholder="Satış"
                            />
                            <Button
                              variant="destructive"
                              className="cursor-pointer"
                              size="sm"
                              onClick={() => removeVariation(product.localId, variation.localId)}
                              disabled={savingCreate}
                            >
                              Sil
                            </Button>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </CardContent>
                </Card>
              ))}
            </div>

            <DialogFooter className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
              <div className="text-xs text-slate-400">
                {subProducts.length} alt ürün / {draftVariationCount} varyasyon
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" className="cursor-pointer" onClick={resetCreateForm} disabled={savingCreate}>
                  Formu Sıfırla
                </Button>
                <Button variant="outline" className="cursor-pointer" onClick={addSubProduct} disabled={savingCreate}>
                  Alt Ürün Ekle
                </Button>
                <Button className="cursor-pointer" onClick={() => void createStructuredCategory()} disabled={savingCreate}>
                  {savingCreate ? "Kaydediliyor..." : "Kategoriyi Kaydet"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-none w-[96vw] h-[94vh] p-0 overflow-hidden">
          <div className="flex h-full flex-col">
            <DialogHeader className="px-6 py-4 border-b border-white/10">
              <DialogTitle>Kategoriyi Düzenle</DialogTitle>
              <DialogDescription>
                Bu bölümde kategori alanlarını ve alt ürünleri birlikte güncelleyebilirsin.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <Card className="rounded-2xl">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm">Kategori Bilgisi</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Slug</p>
                    <Input
                      value={editCategory?.slug ?? ""}
                      onChange={(event) => setEditCategoryField("slug", event.target.value)}
                      placeholder="tig-isi"
                      disabled={savingEdit}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Başlık (TR)</p>
                    <Input
                      value={editCategory?.title_tr ?? ""}
                      onChange={(event) => setEditCategoryField("title_tr", event.target.value)}
                      placeholder="Tığ İşi"
                      disabled={savingEdit}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Başlık (EN)</p>
                    <Input
                      value={editCategory?.title_en ?? ""}
                      onChange={(event) => setEditCategoryField("title_en", event.target.value)}
                      placeholder="Crochet"
                      disabled={savingEdit}
                    />
                  </div>
                </CardContent>
              </Card>

              {editProducts.map((product, index) => (
                <Card key={product.localId} className="rounded-2xl">
                  <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-sm">
                      Alt Ürün {index + 1} {product.id ? `(ID: ${product.id})` : "(Yeni)"}
                    </CardTitle>
                    <Button
                      variant="destructive"
                      className="cursor-pointer"
                      size="sm"
                      onClick={() => removeEditProduct(product.localId)}
                      disabled={savingEdit || editProducts.length === 1}
                    >
                      Alt Ürünü Sil
                    </Button>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Input
                        value={product.title_tr}
                        onChange={(event) => setEditProductField(product.localId, "title_tr", event.target.value)}
                        placeholder="Alt Ürün (TR)"
                        disabled={savingEdit}
                      />
                      <Input
                        value={product.title_en}
                        onChange={(event) => setEditProductField(product.localId, "title_en", event.target.value)}
                        placeholder="Alt Ürün (EN)"
                        disabled={savingEdit}
                      />
                      <Input
                        value={product.image_urls}
                        onChange={(event) => setEditProductField(product.localId, "image_urls", event.target.value)}
                        placeholder="Görseller (virgül ile, max 2)"
                        disabled={savingEdit}
                      />
                      <Input
                        value={product.cost}
                        onChange={(event) => setEditProductField(product.localId, "cost", event.target.value)}
                        placeholder="Maliyet"
                        type="number"
                        step="0.01"
                        disabled={savingEdit}
                      />
                      <Input
                        value={product.shipping_cost}
                        onChange={(event) => setEditProductField(product.localId, "shipping_cost", event.target.value)}
                        placeholder="Kargo"
                        type="number"
                        step="0.01"
                        disabled={savingEdit}
                      />
                      <Input
                        value={product.cut_percent}
                        onChange={(event) => setEditProductField(product.localId, "cut_percent", event.target.value)}
                        placeholder="Komisyon %"
                        type="number"
                        step="0.01"
                        disabled={savingEdit}
                      />
                      <Input
                        value={product.sale_price}
                        onChange={(event) => setEditProductField(product.localId, "sale_price", event.target.value)}
                        placeholder="Satış Fiyatı"
                        type="number"
                        step="0.01"
                        disabled={savingEdit}
                      />
                      <Input
                        value={product.margin_percent}
                        onChange={(event) => setEditProductField(product.localId, "margin_percent", event.target.value)}
                        placeholder="Marj %"
                        type="number"
                        step="0.01"
                        disabled={savingEdit}
                      />
                      <Input
                        value={product.net_profit}
                        onChange={(event) => setEditProductField(product.localId, "net_profit", event.target.value)}
                        placeholder="Net Kar"
                        type="number"
                        step="0.01"
                        disabled={savingEdit}
                      />
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Varyasyonlar (JSON)</p>
                      <Textarea
                        value={product.variationsText}
                        onChange={(event) => setEditProductField(product.localId, "variationsText", event.target.value)}
                        rows={6}
                        placeholder='[{"name":"Small","maliyet":5,"satisFiyati":12}]'
                        disabled={savingEdit}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <DialogFooter className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
              <Button variant="outline" className="cursor-pointer"   onClick={addEditProduct} disabled={savingEdit}>
                Alt Ürün Ekle
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="secondary" className="cursor-pointer"   onClick={() => setEditModalOpen(false)} disabled={savingEdit}>
                  İptal
                </Button>
                <Button className="cursor-pointer"   onClick={() => void saveCategoryAndProducts()} disabled={savingEdit}>
                  {savingEdit ? "Kaydediliyor..." : "Kategori ve Alt Ürünleri Kaydet"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
