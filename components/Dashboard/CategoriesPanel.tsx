"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../../store";
import {
  ChevronLeft,
  ChevronRight,
  Box,
  Info,
  ArrowUpRight,
  TrendingUp,
  Truck,
  Percent,
  Wallet,
  BadgeDollarSign,
  Plus,
  Trash2,
  Save,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useCategoriesRepository } from "@/lib/repositories/categories";
import { calculateFinancials } from "@/lib/repositories/products";
import { supabase } from "@/lib/supabaseClient";
import type { SubProduct } from "@/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type FeedbackMessage = {
  type: "success" | "error";
  text: string;
};

type NewSubProductDraft = {
  titleTr: string;
  titleEn: string;
  imageUrl1: string;
  imageUrl2: string;
  cost: string;
  salePrice: string;
  shipping: string;
  cut: string;
  margin: string;
  description: string;
  youtubeUrl: string;
};

const createNewSubProductDraft = (): NewSubProductDraft => ({
  titleTr: "",
  titleEn: "",
  imageUrl1: "",
  imageUrl2: "",
  cost: "0",
  salePrice: "0",
  shipping: "10",
  cut: "24",
  margin: "25",
  description: "",
  youtubeUrl: "",
});

const parseNumericInput = (value: string, fallback: number) => {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const extractYouTubeVideoId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "youtu.be") {
      const [id] = url.pathname.split("/").filter(Boolean);
      return id || null;
    }

    if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }

      if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/")) {
        const [, , id] = url.pathname.split("/");
        return id || null;
      }
    }
  } catch {
    return null;
  }

  return null;
};

const isValidYoutubeLink = (value: string) => {
  if (!value.trim()) {
    return true;
  }

  return Boolean(extractYouTubeVideoId(value));
};

const CategoriesPanel: React.FC = () => {
  const { selectedCategoryId, setSelectedCategory } = useStore();
  const { t, locale } = useI18n();
  const { categories, error, reload } = useCategoriesRepository(locale);

  const [isAdmin, setIsAdmin] = useState(false);
  const [panelMessage, setPanelMessage] = useState<FeedbackMessage | null>(null);

  const [selectedSubProduct, setSelectedSubProduct] = useState<SubProduct | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [youtubeDraft, setYoutubeDraft] = useState("");
  const [catalogMessage, setCatalogMessage] = useState<FeedbackMessage | null>(null);
  const [isCatalogSaving, setIsCatalogSaving] = useState(false);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newSubProduct, setNewSubProduct] = useState<NewSubProductDraft>(createNewSubProductDraft());
  const [createMessage, setCreateMessage] = useState<FeedbackMessage | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window === "undefined" ? 1920 : window.innerWidth
  );
  const [mobileSelectedCategoryId, setMobileSelectedCategoryId] = useState<string | null>(null);

  const isMobile = viewportWidth < 768;

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!categories.length) {
      return;
    }

    if (isMobile) {
      if (mobileSelectedCategoryId && !categories.find((category) => category.id === mobileSelectedCategoryId)) {
        setMobileSelectedCategoryId(null);
      }
      return;
    }

    if (!selectedCategoryId && categories[0]) {
      setSelectedCategory(categories[0].id);
      return;
    }

    if (selectedCategoryId && !categories.find((category) => category.id === selectedCategoryId) && categories[0]) {
      setSelectedCategory(categories[0].id);
    }
  }, [categories, isMobile, mobileSelectedCategoryId, selectedCategoryId, setSelectedCategory]);

  useEffect(() => {
    if (isMobile) {
      setMobileSelectedCategoryId(null);
    }
  }, [isMobile]);

  useEffect(() => {
    let mounted = true;

    const resolveAdminRole = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!mounted || !user) {
          setIsAdmin(false);
          return;
        }

        const { data } = await supabase
          .from("profiles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle<{ role?: string | null }>();

        if (mounted) {
          setIsAdmin(data?.role === "admin");
        }
      } catch {
        if (mounted) {
          setIsAdmin(false);
        }
      }
    };

    void resolveAdminRole();

    return () => {
      mounted = false;
    };
  }, []);

  const activeCategoryId = isMobile ? mobileSelectedCategoryId : selectedCategoryId;
  const selectedCategory = categories.find((category) => category.id === activeCategoryId) ?? (isMobile ? undefined : categories[0]);
  const showMobileCategoryList = isMobile && !mobileSelectedCategoryId;

  const selectedVideoId = useMemo(() => extractYouTubeVideoId(youtubeDraft), [youtubeDraft]);

  const openCatalogModal = (subProduct: SubProduct) => {
    setSelectedSubProduct(subProduct);
    setDescriptionDraft(subProduct.catalogDescription ?? "");
    setYoutubeDraft(subProduct.catalogYoutubeUrl ?? "");
    setCatalogMessage(null);
  };

  const closeCatalogModal = () => {
    setSelectedSubProduct(null);
    setDescriptionDraft("");
    setYoutubeDraft("");
    setCatalogMessage(null);
    setIsCatalogSaving(false);
  };

  const handleSaveCatalogDetails = async () => {
    if (!selectedSubProduct || !isAdmin) {
      return;
    }

    if (!isValidYoutubeLink(youtubeDraft)) {
      setCatalogMessage({ type: "error", text: t("categories.invalidYoutube") });
      return;
    }

    setIsCatalogSaving(true);
    setCatalogMessage(null);

    try {
      const response = await fetch(`/api/admin/products/${selectedSubProduct.id}/catalog`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          catalog_description: descriptionDraft.trim() || null,
          catalog_youtube_url: youtubeDraft.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        code?: string;
        action?: string;
      };

      if (!response.ok) {
        if (payload.code === "CATALOG_COLUMNS_MISSING") {
          throw new Error(`${t("categories.catalogSaveFailed")} (${payload.action ?? "migration_required"})`);
        }

        throw new Error(payload.message || payload.error || t("categories.catalogSaveFailed"));
      }

      setCatalogMessage({ type: "success", text: t("categories.catalogSaved") });
      setSelectedSubProduct((prev) =>
        prev
          ? {
              ...prev,
              catalogDescription: descriptionDraft.trim(),
              catalogYoutubeUrl: youtubeDraft.trim(),
            }
          : prev
      );
      await reload();
    } catch (saveError) {
      setCatalogMessage({
        type: "error",
        text: saveError instanceof Error ? saveError.message : t("categories.catalogSaveFailed"),
      });
    } finally {
      setIsCatalogSaving(false);
    }
  };

  const handleDeleteSubProduct = async (subProductId: string) => {
    if (!isAdmin) {
      return;
    }

    if (!window.confirm(t("categories.deleteSubProductConfirm"))) {
      return;
    }

    setPanelMessage(null);

    try {
      const response = await fetch(`/api/admin/products/${subProductId}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || t("categories.subProductDeleteFailed"));
      }

      if (selectedSubProduct?.id === subProductId) {
        closeCatalogModal();
      }

      setPanelMessage({ type: "success", text: t("categories.subProductDeleted") });
      await reload();
    } catch (deleteError) {
      setPanelMessage({
        type: "error",
        text: deleteError instanceof Error ? deleteError.message : t("categories.subProductDeleteFailed"),
      });
    }
  };

  const handleCreateSubProduct = async () => {
    if (!isAdmin || !selectedCategory?.dbId) {
      return;
    }

    const titleTr = newSubProduct.titleTr.trim();
    const titleEn = newSubProduct.titleEn.trim();

    if (!titleTr || !titleEn) {
      setCreateMessage({ type: "error", text: `${t("categories.productNameTr")} / ${t("categories.productNameEn")}` });
      return;
    }

    if (!isValidYoutubeLink(newSubProduct.youtubeUrl)) {
      setCreateMessage({ type: "error", text: t("categories.invalidYoutube") });
      return;
    }

    const cost = parseNumericInput(newSubProduct.cost, 0);
    const salePrice = parseNumericInput(newSubProduct.salePrice, 0);
    const shipping = parseNumericInput(newSubProduct.shipping, 10);
    const cut = parseNumericInput(newSubProduct.cut, 24);
    const margin = parseNumericInput(newSubProduct.margin, 25);
    const fee = salePrice * (cut / 100);
    const netProfit = salePrice - cost - shipping - fee;

    setIsCreating(true);
    setCreateMessage(null);

    try {
      const response = await fetch("/api/admin/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category_id: selectedCategory.dbId,
          title_tr: titleTr,
          title_en: titleEn,
          image_urls: [newSubProduct.imageUrl1.trim(), newSubProduct.imageUrl2.trim()].filter(Boolean).slice(0, 2),
          cost,
          shipping_cost: shipping,
          cut_percent: cut,
          sale_price: salePrice,
          margin_percent: margin,
          net_profit: netProfit,
          catalog_description: newSubProduct.description.trim() || null,
          catalog_youtube_url: newSubProduct.youtubeUrl.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || t("categories.subProductCreateFailed"));
      }

      setCreateMessage({ type: "success", text: t("categories.subProductCreated") });
      setPanelMessage({ type: "success", text: t("categories.subProductCreated") });
      setNewSubProduct(createNewSubProductDraft());
      await reload();
      setIsCreateDialogOpen(false);
    } catch (createError) {
      setCreateMessage({
        type: "error",
        text: createError instanceof Error ? createError.message : t("categories.subProductCreateFailed"),
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateDialogToggle = (open: boolean) => {
    setIsCreateDialogOpen(open);
    if (!open) {
      setCreateMessage(null);
      setNewSubProduct(createNewSubProductDraft());
    }
  };

  const handleSelectCategory = (categoryId: string) => {
    setSelectedCategory(categoryId);
    if (isMobile) {
      setMobileSelectedCategoryId(categoryId);
    }
  };

  const renderCategoryRail = (onAfterSelect?: () => void) => (
    <div className="w-full flex flex-col gap-3 overflow-y-auto pr-1 custom-scrollbar shrink-0">
      <div className="px-2 mb-2">
        <h2 className="text-[10px] font-black text-indigo-400/60 uppercase tracking-[0.3em]">
          {t("categories.productionLines")}
        </h2>
      </div>

      {categories.map((cat) => {
        const isActive = activeCategoryId === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => {
              handleSelectCategory(cat.id);
              onAfterSelect?.();
            }}
            className={`px-5 py-4 min-h-[64px] rounded-[20px] text-left transition-all relative group flex items-center justify-between border cursor-pointer ${
              isActive
                ? "bg-indigo-600/20 border-indigo-500/60 text-white shadow-lg shadow-indigo-500/10"
                : "bg-white/5 border-white/5 hover:border-indigo-500/30 text-slate-400 hover:text-slate-200"
            }`}
          >
            <span className="font-bold text-[14px] tracking-tight transition-colors">{cat.name}</span>

            <ChevronRight
              className={`w-4 h-4 transition-all duration-300 shrink-0 ${
                isActive
                  ? "translate-x-0 opacity-100 text-indigo-400"
                  : "opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0"
              }`}
            />
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="relative h-full min-h-0">
        {showMobileCategoryList ? (
          <div className="h-full rounded-[32px] glass-card-pro p-4 sm:p-6 overflow-y-auto custom-scrollbar">
            {renderCategoryRail()}
          </div>
        ) : (
          <div className="flex h-full min-h-0 gap-4">
            {!isMobile && (
              <div className="w-72 h-full rounded-[32px] glass-card-pro p-4 overflow-y-auto custom-scrollbar shrink-0">
                {renderCategoryRail()}
              </div>
            )}

            <div className="flex-1 min-h-0 glass-card-pro rounded-[32px] p-5 sm:p-6 lg:p-8 overflow-y-auto custom-scrollbar relative">
              {isMobile && (
                <div className="mb-6 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileSelectedCategoryId(null);
                      setSelectedCategory("");
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-200 hover:bg-white/10 transition-all cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t("common.back")}
                  </button>
                </div>
              )}

              {!selectedCategory ? (
                <div className="h-full min-h-[320px] flex items-center justify-center text-slate-400 text-sm">
                  {t("categories.productionLines")}
                </div>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedCategory.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                  >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 mb-10">
                <div className="flex items-center gap-6">
                  <div className="w-14 h-14 bg-indigo-600 rounded-[18px] flex items-center justify-center shadow-xl shadow-indigo-500/20 shrink-0 border border-indigo-400/30">
                    <Box className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black tracking-tight text-white">{selectedCategory?.name}</h2>
                    <p className="text-indigo-400/60 font-bold uppercase tracking-widest text-[10px] mt-1">
                      {selectedCategory?.subProducts.length} {t("categories.optionsAvailable")} • {t("categories.allPricesUsd")}
                    </p>
                  </div>
                </div>

                {isAdmin && selectedCategory?.dbId && (
                  <button
                    onClick={() => handleCreateDialogToggle(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-indigo-200 transition hover:bg-indigo-500/30 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" /> {t("categories.addSubProduct")}
                  </button>
                )}
              </div>

              {(error || panelMessage) && (
                <div className={`mb-8 rounded-2xl border px-4 py-3 text-sm ${
                  (panelMessage?.type === "error" || error)
                    ? "border-red-500/30 bg-red-500/10 text-red-200"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                }`}>
                  {panelMessage?.text || error}
                </div>
              )}

              {(selectedCategory?.id === "aliexpress" || selectedCategory?.id === "kendi-urunlerin") && (
                <div className="mb-8 p-6 rounded-[28px] bg-indigo-600/5 border border-indigo-500/20 text-slate-300">
                  <div className="flex items-center gap-2 mb-3 text-indigo-400">
                    <Info className="w-5 h-5" />
                    <span className="font-black uppercase tracking-widest text-[9px]">{t("categories.processNote")}</span>
                  </div>
                  <p className="text-md leading-relaxed font-medium opacity-80">
                    {selectedCategory.id === "aliexpress"
                      ? "Aliexpress otomasyonunda kâr oranları seçeceğiniz tedarikçiye göre anlık hesaplanır."
                      : "Telegram botu üzerinden gönderdiğiniz ürünler için maliyet analizi otomatik yapılır."}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-5">
                {selectedCategory?.subProducts.map((sub, index) => {
                  const shipping = sub.shipping ?? 10;
                  const cutPercent = sub.cut ?? 24;
                  const { fee, profit, margin } = calculateFinancials(sub.maliyet, sub.satisFiyati, shipping, cutPercent);
                  const isCalculatable = sub.satisFiyati > 0;

                  return (
                    <motion.div
                      key={sub.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="bg-white/5 rounded-[32px] p-6 flex flex-col 2xl:flex-row 2xl:items-start gap-6 group border border-white/5 hover:border-indigo-500/40 transition-all duration-500"
                    >
                      <div className="flex gap-4 shrink-0 mt-1">
                        <div className="relative group/img">
                          <img
                            src={sub.ornekGorsel}
                            alt={`${sub.name} ${t("categories.reference")}`}
                            className="w-24 h-24 rounded-2xl object-cover filter brightness-75 group-hover/img:brightness-100 transition-all border border-white/5"
                          />
                          <div className="absolute top-1 left-1 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-lg text-[7px] font-black uppercase text-slate-300">
                            {t("categories.reference")}
                          </div>
                        </div>
                        <div className="relative group/img">
                          <img
                            src={sub.uretimGorsel}
                            alt={`${sub.name} ${t("categories.production")}`}
                            className="w-24 h-24 rounded-2xl object-cover border border-indigo-500/20"
                          />
                          <div className="absolute top-1 left-1 bg-indigo-600/80 backdrop-blur-md px-2 py-0.5 rounded-lg text-[7px] font-black uppercase text-white">
                            {t("categories.production")}
                          </div>
                        </div>
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-5 gap-3">
                          <h3 className="font-bold text-xl text-white group-hover:text-indigo-400 transition-colors tracking-tight">
                            {sub.name}
                          </h3>
                          {isCalculatable && (
                            <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5">
                              <TrendingUp className="w-3 h-3" /> %{margin.toFixed(0)} {t("categories.margin")}
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
                          <div className="flex flex-col justify-center items-center">
                            <span className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                              <Wallet className="w-4 h-4" /> {t("categories.cost")}
                            </span>
                            <div className="text-md font-bold text-slate-200">${sub.maliyet}</div>
                          </div>

                          {isCalculatable && (
                            <>
                              <div className="flex flex-col justify-center items-center">
                                <span className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                  <Truck className="w-4 h-4" /> {t("categories.shipping")}
                                </span>
                                <div className="text-md font-bold text-slate-200">${shipping}</div>
                              </div>
                              <div className="flex flex-col justify-center items-center">
                                <span className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                  <Percent className="w-4 h-4" /> {t("categories.cut")}
                                </span>
                                <div className="text-md font-bold text-slate-400">-${fee.toFixed(1)}</div>
                              </div>
                              <div className="flex flex-col justify-center items-center">
                                <span className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-1.5">{t("categories.salePrice")}</span>
                                <div className="text-md font-black text-indigo-400">${sub.satisFiyati}</div>
                              </div>
                              <div className="flex flex-col bg-emerald-500/5 p-2 rounded-xl border border-emerald-500/10 scale-110 ml-2 justify-center items-center">
                                <span className="text-xs font-black text-emerald-500 uppercase tracking-widest mb-1">{t("categories.netProfit")}</span>
                                <div className="text-lg font-black text-emerald-400">${profit.toFixed(1)}</div>
                              </div>
                            </>
                          )}
                        </div>

                        {sub.variations && (
                          <div className="flex-col items-center w-full py-2 mt-6">
                            <p className="text-md text-white/40 font-semibold">{t("categories.variantsTitle")}:</p>

                            <div className="mt-2 flex flex-wrap gap-2">
                              {sub.variations.map((variation) => {
                                return (
                                  <div
                                    key={variation.id}
                                    className="grid grid-cols-3 gap-x-2 gap-y-2 py-3 px-4 rounded-xl bg-white/2 border border-white/5 text-slate-400"
                                  >
                                    <div />
                                    <div className="flex items-center gap-x-1 font-semibold text-sm justify-center">
                                      <Wallet className="w-4 h-4" />
                                      {t("categories.cost")}
                                    </div>
                                    <div className="flex justify-center items-center gap-x-1 text-sm font-semibold">
                                      <BadgeDollarSign className="w-4 h-4" />
                                      {t("categories.salePrice")}
                                    </div>

                                    <div className="relative bottom-4 font-semibold">{variation.name}</div>
                                    <div className="flex justify-center items-center">
                                      {variation.maliyet ? ` -$${variation.maliyet}` : ""}
                                    </div>
                                    <div className="flex justify-center items-center">
                                      {variation.satisFiyati ? `$${variation.satisFiyati}` : ""}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="mt-6 flex flex-col gap-2">
                          <button
                            onClick={() => openCatalogModal(sub)}
                            className="px-6 py-3 rounded-xl bg-indigo-500 text-white/90 font-black text-[9px] uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 hover:bg-indigo-600 hover:text-white transition-all active:scale-95 border-none cursor-pointer"
                          >
                            {t("categories.viewCatalog")} <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>

                          {isAdmin && (
                            <button
                              onClick={() => void handleDeleteSubProduct(sub.id)}
                              className="px-4 py-2 rounded-xl bg-red-500/10 text-red-200 border border-red-500/30 font-black text-[9px] uppercase tracking-widest hover:bg-red-500/20 transition-all cursor-pointer"
                            >
                              <span className="inline-flex items-center gap-2">
                                <Trash2 className="h-3.5 w-3.5" />
                                {t("categories.deleteSubProduct")}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog open={Boolean(selectedSubProduct)} onOpenChange={(open) => !open && closeCatalogModal()}>
        <DialogContent className="h-screen w-screen max-w-none translate-x-[-50%] translate-y-[-50%] rounded-none border-0 bg-[#0a0a0c] p-0">
          <div className="h-full w-full overflow-y-auto custom-scrollbar px-5 py-8 sm:px-10 sm:py-10 lg:px-16 lg:py-14">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-3xl font-black text-white tracking-tight">
                {selectedSubProduct?.name} · {t("categories.catalogModalTitle")}
              </DialogTitle>
              <DialogDescription className="text-slate-400 font-medium">
                {t("categories.reference")} / {t("categories.production")}
              </DialogDescription>
            </DialogHeader>

            {catalogMessage && (
              <div
                className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
                  catalogMessage.type === "error"
                    ? "border-red-500/30 bg-red-500/10 text-red-200"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                }`}
              >
                {catalogMessage.text}
              </div>
            )}

            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-3xl overflow-hidden border border-white/10 bg-white/5">
                {selectedSubProduct?.ornekGorsel ? (
                  <img
                    src={selectedSubProduct.ornekGorsel}
                    alt={`${selectedSubProduct.name} ${t("categories.reference")}`}
                    className="h-[380px] w-full object-cover"
                  />
                ) : (
                  <div className="h-[380px] w-full bg-white/5" />
                )}
              </div>
              <div className="rounded-3xl overflow-hidden border border-white/10 bg-white/5">
                {selectedSubProduct?.uretimGorsel ? (
                  <img
                    src={selectedSubProduct.uretimGorsel}
                    alt={`${selectedSubProduct.name} ${t("categories.production")}`}
                    className="h-[380px] w-full object-cover"
                  />
                ) : (
                  <div className="h-[380px] w-full bg-white/5" />
                )}
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{t("categories.cost")}</p>
                <p className="mt-2 text-xl font-black text-white">${selectedSubProduct?.maliyet ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{t("categories.salePrice")}</p>
                <p className="mt-2 text-xl font-black text-indigo-300">${selectedSubProduct?.satisFiyati ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{t("categories.shipping")}</p>
                <p className="mt-2 text-xl font-black text-white">${selectedSubProduct?.shipping ?? 10}</p>
              </div>
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">{t("categories.netProfit")}</p>
                <p className="mt-2 text-xl font-black text-emerald-300">${(selectedSubProduct?.netProfit ?? 0).toFixed(2)}</p>
              </div>
            </div>

            {selectedSubProduct?.variations && selectedSubProduct.variations.length > 0 && (
              <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
                <h4 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-indigo-300">
                  {t("categories.variantsTitle")}
                </h4>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-slate-200">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.2em] text-slate-400">
                        <th className="px-3 py-2">{t("categories.variationName")}</th>
                        <th className="px-3 py-2">{t("categories.cost")}</th>
                        <th className="px-3 py-2">{t("categories.salePrice")}</th>
                        <th className="px-3 py-2">{t("categories.shipping")}</th>
                        <th className="px-3 py-2">{t("categories.cut")}</th>
                        <th className="px-3 py-2">{t("categories.netProfit")}</th>
                        <th className="px-3 py-2">{t("categories.margin")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSubProduct.variations.map((variation) => {
                        const shipping = selectedSubProduct.shipping ?? 10;
                        const cutPercent = selectedSubProduct.cut ?? 24;
                        const salePrice = variation.satisFiyati ?? selectedSubProduct.satisFiyati ?? 0;
                        const { fee, profit, margin } = calculateFinancials(
                          variation.maliyet ?? 0,
                          salePrice,
                          shipping,
                          cutPercent
                        );

                        return (
                          <tr key={variation.id} className="border-b border-white/5 last:border-b-0">
                            <td className="px-3 py-3 font-semibold text-white">{variation.name}</td>
                            <td className="px-3 py-3">${variation.maliyet.toFixed(2)}</td>
                            <td className="px-3 py-3 text-indigo-300">${salePrice.toFixed(2)}</td>
                            <td className="px-3 py-3">${shipping.toFixed(2)}</td>
                            <td className="px-3 py-3 text-slate-400">-${fee.toFixed(2)}</td>
                            <td className="px-3 py-3 text-emerald-300">${profit.toFixed(2)}</td>
                            <td className="px-3 py-3 text-emerald-300">%{margin.toFixed(1)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-6">
              <h4 className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-indigo-300">{t("categories.catalogDescription")}</h4>

              {isAdmin ? (
                <Textarea
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  placeholder={t("categories.catalogDescriptionPlaceholder")}
                  className="min-h-[140px] border-white/20 bg-black/30 text-slate-100 placeholder:text-slate-500"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                  {descriptionDraft.trim() || t("categories.catalogNoDescription")}
                </p>
              )}
            </div>

            <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
              <h4 className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-indigo-300">{t("categories.catalogYoutube")}</h4>

              {isAdmin && (
                <>
                  <Input
                    value={youtubeDraft}
                    onChange={(event) => setYoutubeDraft(event.target.value)}
                    placeholder={t("categories.catalogYoutubePlaceholder")}
                    className="border-white/20 bg-black/30 text-slate-100 placeholder:text-slate-500"
                  />
                  <p className="mt-2 text-xs text-slate-500">{t("categories.catalogYoutubeHelp")}</p>
                </>
              )}

              {!isAdmin && !youtubeDraft.trim() && (
                <p className="text-sm text-slate-400">{t("categories.catalogVideoUnavailable")}</p>
              )}

              {selectedVideoId && (
                <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
                  <div className="aspect-video bg-black">
                    <iframe
                      className="h-full w-full"
                      src={`https://www.youtube.com/embed/${selectedVideoId}`}
                      title="YouTube video player"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="mt-10 gap-3 sm:justify-end">
              {isAdmin && (
                <button
                  onClick={() => void handleSaveCatalogDetails()}
                  disabled={isCatalogSaving}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-500/20 px-5 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-60 cursor-pointer"
                >
                  <Save className="h-4 w-4" /> {isCatalogSaving ? t("categories.savingCatalog") : t("categories.saveCatalog")}
                </button>
              )}

              <button
                onClick={closeCatalogModal}
                className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-5 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-100 transition hover:bg-white/10 cursor-pointer"
              >
                {t("categories.closeCatalog")}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateDialogOpen} onOpenChange={handleCreateDialogToggle}>
        <DialogContent className="max-w-3xl border border-white/10 bg-[#10131a] text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl">{t("categories.createSubProduct")}</DialogTitle>
            <DialogDescription className="text-slate-400">{selectedCategory?.name}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">{t("categories.productNameTr")}</label>
              <Input
                value={newSubProduct.titleTr}
                onChange={(event) => setNewSubProduct((prev) => ({ ...prev, titleTr: event.target.value }))}
                className="border-white/20 bg-black/30 text-slate-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">{t("categories.productNameEn")}</label>
              <Input
                value={newSubProduct.titleEn}
                onChange={(event) => setNewSubProduct((prev) => ({ ...prev, titleEn: event.target.value }))}
                className="border-white/20 bg-black/30 text-slate-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">{t("categories.imageUrl1")}</label>
              <Input
                value={newSubProduct.imageUrl1}
                onChange={(event) => setNewSubProduct((prev) => ({ ...prev, imageUrl1: event.target.value }))}
                className="border-white/20 bg-black/30 text-slate-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">{t("categories.imageUrl2")}</label>
              <Input
                value={newSubProduct.imageUrl2}
                onChange={(event) => setNewSubProduct((prev) => ({ ...prev, imageUrl2: event.target.value }))}
                className="border-white/20 bg-black/30 text-slate-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">{t("categories.cost")}</label>
              <Input
                value={newSubProduct.cost}
                onChange={(event) => setNewSubProduct((prev) => ({ ...prev, cost: event.target.value }))}
                className="border-white/20 bg-black/30 text-slate-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">{t("categories.salePrice")}</label>
              <Input
                value={newSubProduct.salePrice}
                onChange={(event) => setNewSubProduct((prev) => ({ ...prev, salePrice: event.target.value }))}
                className="border-white/20 bg-black/30 text-slate-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">{t("categories.shipping")}</label>
              <Input
                value={newSubProduct.shipping}
                onChange={(event) => setNewSubProduct((prev) => ({ ...prev, shipping: event.target.value }))}
                className="border-white/20 bg-black/30 text-slate-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">{t("categories.cut")}</label>
              <Input
                value={newSubProduct.cut}
                onChange={(event) => setNewSubProduct((prev) => ({ ...prev, cut: event.target.value }))}
                className="border-white/20 bg-black/30 text-slate-100"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">{t("categories.catalogDescription")}</label>
              <Textarea
                value={newSubProduct.description}
                onChange={(event) => setNewSubProduct((prev) => ({ ...prev, description: event.target.value }))}
                className="min-h-[100px] border-white/20 bg-black/30 text-slate-100"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">{t("categories.catalogYoutube")}</label>
              <Input
                value={newSubProduct.youtubeUrl}
                onChange={(event) => setNewSubProduct((prev) => ({ ...prev, youtubeUrl: event.target.value }))}
                placeholder={t("categories.catalogYoutubePlaceholder")}
                className="border-white/20 bg-black/30 text-slate-100"
              />
            </div>
          </div>

          {createMessage && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                createMessage.type === "error"
                  ? "border-red-500/30 bg-red-500/10 text-red-200"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              }`}
            >
              {createMessage.text}
            </div>
          )}

          <DialogFooter className="gap-3">
            <button
              onClick={() => void handleCreateSubProduct()}
              disabled={isCreating}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-500/50 bg-indigo-500/20 px-5 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-100 transition hover:bg-indigo-500/30 disabled:opacity-60 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              {isCreating ? t("categories.creatingSubProduct") : t("categories.createSubProduct")}
            </button>
            <button
              onClick={() => handleCreateDialogToggle(false)}
              className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-5 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-100 transition hover:bg-white/10 cursor-pointer"
            >
              {t("categories.closeCatalog")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CategoriesPanel;
