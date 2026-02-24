"use client";

import { useCallback, useEffect, useState } from "react";
import type { Category } from "@/types";
import type { SupportedLocale } from "@/lib/i18n/config";

type CategoriesResponse = {
  categories?: Category[];
  error?: string;
};

export const useCategoriesRepository = (locale: SupportedLocale) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/categories?locale=${locale}`, {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json()) as CategoriesResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Categories endpoint failed");
      }

      setCategories(payload.categories ?? []);
    } catch (err) {
      setCategories([]);
      setError(err instanceof Error ? err.message : "Categories could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  return { categories, loading, error, reload: loadCategories };
};
