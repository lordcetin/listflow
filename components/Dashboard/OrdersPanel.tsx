"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabaseClient';
import {
  Package,
  Send,
  Search,
  Filter,
  MapPin,
  Calendar,
  CreditCard,
  PlayCircle,
  Tag,
  FileText,
  Hash,
  CheckCircle2,
  Clock,
  Loader2,
  Link as LinkIcon,
  Layers,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { useCategoriesRepository } from '@/lib/repositories/categories';
import { useOrdersRepository } from '@/lib/repositories/orders';

const OrdersPanel: React.FC = () => {
  const { orders, loading, error, createOrder, deleteOrder } = useOrdersRepository();
  const [showModal, setShowModal] = useState(false);
  const { t, locale } = useI18n();
  const { categories } = useCategoriesRepository(locale);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<{ id: string; label: string } | null>(null);

  const [selectedCatId, setSelectedCatId] = useState(categories[0]?.id ?? '');
  const [selectedSubId, setSelectedSubId] = useState('');
  const [selectedVarId, setSelectedVarId] = useState('');
  const [productLink, setProductLink] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [ioss, setIoss] = useState('');
  const [labelNumber, setLabelNumber] = useState('');

  const currentCategory = useMemo(() => categories.find((category) => category.id === selectedCatId), [categories, selectedCatId]);
  const currentSubProduct = useMemo(() => currentCategory?.subProducts.find((subProduct) => subProduct.id === selectedSubId), [currentCategory, selectedSubId]);
  const currentVariation = useMemo(() => currentSubProduct?.variations?.find((variation) => variation.id === selectedVarId), [currentSubProduct, selectedVarId]);

  useEffect(() => {
    if (categories.length === 0) {
      if (selectedCatId) {
        setSelectedCatId('');
        setSelectedSubId('');
        setSelectedVarId('');
      }
      return;
    }

    const selectedCategoryStillExists = categories.some((category) => category.id === selectedCatId);

    if (!selectedCatId || !selectedCategoryStillExists) {
      setSelectedCatId(categories[0].id);
      setSelectedSubId('');
      setSelectedVarId('');
    }
  }, [categories, selectedCatId]);

  const calculatedPrice = useMemo(() => {
    const baseMaliyet = currentVariation?.maliyet ?? currentSubProduct?.maliyet ?? 0;
    return baseMaliyet + 1.5;
  }, [currentSubProduct, currentVariation]);

  const filteredOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) {
      return orders;
    }

    return orders.filter((order) => {
      return [
        order.subProductName,
        order.variantName,
        order.category,
        order.address,
        order.labelNumber,
        order.productLink,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [orders, searchTerm]);

  const handleSendOrder = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!currentCategory || !currentSubProduct) {
      alert('Kategori ve ürün seçimi zorunlu.');
      return;
    }

    setIsSubmitting(true);

    try {
      await createOrder({
        category: currentCategory.name,
        subProductName: currentSubProduct.name,
        variantName: currentVariation?.name ?? null,
        productLink,
        date: new Date().toISOString().split('T')[0],
        address,
        note,
        ioss,
        labelNumber,
        price: calculatedPrice,
      });

      setAddress('');
      setNote('');
      setIoss('');
      setLabelNumber('');
      setSelectedSubId('');
      setSelectedVarId('');
      setProductLink('');
      setShowModal(false);
    } catch (saveError) {
      alert(saveError instanceof Error ? saveError.message : 'Sipariş kaydedilemedi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayment = async (orderId: string) => {
    try {
      const order = orders.find((item) => item.id === orderId);
      if (!order) {
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Oturum bulunamadı.');
      }

      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'payment',
          amount: order.price,
          shopId: `order_${orderId}`,
          orderId,
          plan: 'standard',
        }),
      });

      const data = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Ödeme linki alınamadı.');
      }

      window.location.href = data.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ödeme başlatılamadı.';
      alert(message);
    }
  };

  const handleConfirmDeleteOrder = async () => {
    if (!deleteTargetOrder) {
      return;
    }

    setDeletingOrderId(deleteTargetOrder.id);

    try {
      await deleteOrder(deleteTargetOrder.id);
      setDeleteTargetOrder(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('orders.deleteFailed');
      alert(message);
    } finally {
      setDeletingOrderId(null);
    }
  };

  return (
    <div className="w-full container mx-auto h-full flex flex-col">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-black tracking-tight">{t('orders.title')}</h1>
          <p className="text-zinc-500 text-sm font-medium">{t('orders.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-indigo-600 text-white font-bold flex items-center justify-center gap-3 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 transition-all shadow-xl cursor-pointer"
        >
          <Send className="w-5 h-5" /> {t('orders.sendOrder')}
        </button>
      </div>

      <div className="flex gap-4 mb-6 shrink-0">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-3 w-5 h-5 text-zinc-400" />
          <input
            type="text"
            placeholder={t('orders.searchPlaceholder')}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full pl-12 pr-4 py-3 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
          />
        </div>
        <button className="px-5 py-3 rounded-2xl glass border border-zinc-200 dark:border-white/10 flex items-center gap-2 font-bold text-xs hover:bg-zinc-100 dark:hover:bg-white/5 transition-all uppercase tracking-wider cursor-pointer">
          <Filter className="w-4 h-4" /> {t('orders.filter')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 p-5 custom-scrollbar">
        {error && (
          <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-16 glass rounded-[32px] text-center border-2 border-dashed border-zinc-200 dark:border-white/10">
            <p className="text-zinc-400 font-medium">{t('common.loading')}...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-16 glass rounded-[32px] text-center border-2 border-dashed border-zinc-200 dark:border-white/10">
            <p className="text-zinc-400 font-medium">{t('orders.empty')}</p>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative p-5 rounded-[28px] glass-card border border-zinc-200 dark:border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:shadow-lg transition-all group"
            >
              <button
                type="button"
                onClick={() =>
                  setDeleteTargetOrder({
                    id: order.id,
                    label: order.variantName ? `${order.subProductName} (${order.variantName})` : order.subProductName,
                  })
                }
                disabled={deletingOrderId === order.id}
                aria-label={t('orders.delete')}
                className="absolute -top-3 -right-3 z-20 h-8 w-8 rounded-full border border-red-200/80 bg-white text-red-500 shadow-md hover:bg-red-50 hover:text-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-900 dark:border-red-400/30 cursor-pointer"
              >
                <X className="mx-auto h-4 w-4" />
              </button>

              <div className="flex items-center gap-5 flex-1">
                <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center shrink-0">
                  <Package className="w-7 h-7 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-black truncate">
                    {order.subProductName}
                    {order.variantName ? ` (${order.variantName})` : ''}
                  </h3>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500 font-bold uppercase tracking-wider mt-1">
                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {order.date}</span>
                    <span className="flex items-center gap-1.5 text-indigo-500"><Tag className="w-3.5 h-3.5" /> {order.labelNumber}</span>
                    <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {order.address.length > 30 ? `${order.address.substring(0, 30)}...` : order.address}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-black text-zinc-400 uppercase tracking-widest mb-0.5">{t('orders.total')}</p>
                  <p className="font-black text-indigo-400 text-lg">${order.price.toFixed(2)}</p>
                </div>

                <div className="flex items-center gap-3">
                  {order.isPaid ? (
                    <div className="px-4 py-2 rounded-xl bg-green-500/10 text-green-600 text-lg font-black uppercase tracking-wider flex items-center gap-2">
                      <CheckCircle2 className="w-6 h-6" />
                      {t('orders.paid')}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="px-4 py-2 rounded-xl bg-orange-500/10 text-orange-600 text-lg font-semibold uppercase tracking-wider flex items-center gap-2">
                        <Clock className="w-6 h-6" />
                        {t('orders.pending')}
                      </div>
                      <button
                        onClick={() => handlePayment(order.id)}
                        className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-lg font-semibold uppercase tracking-wider flex items-center gap-2 hover:scale-105 transition-all shadow-md cursor-pointer"
                      >
                        <CreditCard className="w-6 h-6" />
                        {t('orders.pay')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      <AnimatePresence>
        {deleteTargetOrder && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => deletingOrderId === null && setDeleteTargetOrder(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-lg p-8 rounded-[32px] glass-card-pro border border-white/10 shadow-2xl"
            >
              <h3 className="text-2xl font-black text-white mb-2">{t('orders.deleteConfirmTitle')}</h3>
              <p className="text-slate-300 text-sm mb-6">{t('orders.deleteConfirm')}</p>

              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white mb-6">
                {deleteTargetOrder.label}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTargetOrder(null)}
                  disabled={deletingOrderId === deleteTargetOrder.id}
                  className="flex-1 py-3 rounded-xl glass-pro border border-white/10 text-slate-300 font-black text-xs uppercase tracking-widest hover:text-white transition-all cursor-pointer disabled:opacity-60"
                >
                  {t('orders.deleteCancel')}
                </button>
                <button
                  onClick={() => void handleConfirmDeleteOrder()}
                  disabled={deletingOrderId === deleteTargetOrder.id}
                  className="flex-1 py-3 rounded-xl bg-red-600/90 text-white font-black text-xs uppercase tracking-widest hover:bg-red-500 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {deletingOrderId === deleteTargetOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {t('orders.deleteApprove')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.95 }}
              className="relative w-full max-w-2xl p-6 lg:p-10 rounded-[40px] glass-card shadow-2xl overflow-y-auto max-h-full custom-scrollbar bg-[#0a0a0c]"
            >
              <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-500/30">
                  <Send className="text-white w-6 h-6" />
                </div>
                <h2 className="text-3xl font-black tracking-tight">{t('orders.newOrder')}</h2>
              </div>

              <form onSubmit={handleSendOrder} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Kategori Seç</label>
                    <select
                      value={selectedCatId}
                      onChange={(e) => {
                        setSelectedCatId(e.target.value);
                        setSelectedSubId('');
                        setSelectedVarId('');
                      }}
                      className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none text-sm appearance-none bg-transparent"
                    >
                      {categories.map((category) => (
                        <option key={category.id} value={category.id} className="dark:bg-zinc-900">{category.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Ürün Seç</label>
                    <select
                      required
                      value={selectedSubId}
                      onChange={(e) => {
                        setSelectedSubId(e.target.value);
                        setSelectedVarId('');
                      }}
                      className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none text-sm appearance-none bg-transparent"
                    >
                      <option value="" className="dark:bg-zinc-900">Seçiniz...</option>
                      {currentCategory?.subProducts.map((subProduct) => (
                        <option key={subProduct.id} value={subProduct.id} className="dark:bg-zinc-900">{subProduct.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className={`space-y-2 transition-opacity duration-300 ${currentSubProduct?.variations ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Varyasyon / Boyut</label>
                    <div className="relative">
                      <Layers className="absolute left-4 top-3.5 w-4 h-4 text-zinc-400" />
                      <select
                        required={Boolean(currentSubProduct?.variations)}
                        value={selectedVarId}
                        onChange={(e) => setSelectedVarId(e.target.value)}
                        className="w-full pl-10 pr-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none text-sm appearance-none bg-transparent"
                      >
                        <option value="" className="dark:bg-zinc-900">Varyasyon...</option>
                        {currentSubProduct?.variations?.map((variation) => (
                          <option key={variation.id} value={variation.id} className="dark:bg-zinc-900">{variation.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Ürün Etsy Linki (Zorunlu)</label>
                  <div className="relative">
                    <LinkIcon className="absolute left-4 top-3.5 w-4 h-4 text-zinc-400" />
                    <input
                      required
                      type="url"
                      value={productLink}
                      onChange={(e) => setProductLink(e.target.value)}
                      placeholder="https://www.etsy.com/listing/..."
                      className="w-full pl-10 pr-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Teslimat Adresi</label>
                  <textarea
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={2}
                    placeholder="Tam Adres: Alıcı Adı, Sokak, No, Şehir, Posta Kodu, Ülke..."
                    className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Etiket Numarası (Zorunlu)</label>
                    <a href="#" className="flex items-center gap-1 text-[10px] text-indigo-500 font-bold hover:underline">
                      <PlayCircle className="w-3 h-3" /> İzle
                    </a>
                  </div>
                  <div className="relative">
                    <Hash className="absolute left-4 top-3.5 w-4 h-4 text-zinc-400" />
                    <input
                      required
                      value={labelNumber}
                      onChange={(e) => setLabelNumber(e.target.value)}
                      type="text"
                      placeholder="TR123456789"
                      className="w-full pl-10 pr-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                    />
                  </div>
                  <p className="text-[10px] text-zinc-400 italic mt-1 px-1">
                    * Videoyu izleyerek nasıl kargo takip oluşturacağınızı öğrenebilirsiniz.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">IOSS / UK VAT (Varsa)</label>
                    <div className="relative">
                      <FileText className="absolute left-4 top-3.5 w-4 h-4 text-zinc-400" />
                      <input
                        value={ioss}
                        onChange={(e) => setIoss(e.target.value)}
                        type="text"
                        placeholder="IOSS-1234..."
                        className="w-full pl-10 pr-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Sipariş Notu / Açıklama</label>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      type="text"
                      placeholder="Hediye, renk tercihi vb."
                      className="w-full px-4 py-3.5 rounded-2xl glass border border-zinc-200 dark:border-white/10 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                    />
                  </div>
                </div>

                <div className="p-6 rounded-[28px] bg-indigo-600/5 dark:bg-white/5 border border-indigo-200 dark:border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Maliyet</span>
                    <span className="font-bold">${(currentVariation?.maliyet ?? currentSubProduct?.maliyet ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">İşlem Ücreti</span>
                    <span className="font-bold">$1.50</span>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-white/10">
                    <span className="text-sm font-black uppercase tracking-widest">{t('orders.amountDue')}</span>
                    <span className="text-2xl font-black text-indigo-600">${calculatedPrice.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    disabled={isSubmitting}
                    className="flex-1 py-4 rounded-2xl glass border border-zinc-200 dark:border-white/10 font-black text-sm uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-white/5 transition-all cursor-pointer"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-4 rounded-2xl bg-indigo-600 text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-indigo-500/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-5 h-5" /> {isSubmitting ? `${t('common.loading')}...` : t('orders.confirmOrder')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OrdersPanel;
