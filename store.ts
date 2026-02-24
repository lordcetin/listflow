/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { create } from 'zustand';
import { AppState, View, DashboardSection } from './types';

export const useStore = create<AppState>((set:any) => ({
  currentView: View.LANDING,
  dashboardSection: DashboardSection.CATEGORIES,
  isDarkMode: typeof window !== "undefined" ? window.matchMedia('(prefers-color-scheme: dark)').matches : false,

  // ✅ CHANGED: default shop kaldırıldı (Mavi Dükkan yok)
  shops: [],

  orders: [],

  selectedCategoryId: 'tig-isi',
  setView: (view) => set({ currentView: view }),
  setDashboardSection: (section) => set({ dashboardSection: section }),
  toggleDarkMode: () => set((state:any) => {
    const nextMode = !state.isDarkMode;
    if (nextMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    return { isDarkMode: nextMode };
  }),
  addShop: (shop) => set((state:any) => ({ shops: [...state.shops, shop] })),
  updateShop: (id, updates) => set((state:any) => ({
    shops: state.shops.map((s:any) => s.id === id ? { ...s, ...updates } : s)
  })),
  addOrder: (order) => set((state:any) => ({ orders: [order, ...state.orders] })),
  updateOrder: (id, updates) => set((state:any) => ({
    orders: state.orders.map((o:any) => o.id === id ? { ...o, ...updates } : o)
  })),
  setSelectedCategory: (id) => set({ selectedCategoryId: id }),
  setShops: (shops) => set({ shops }),
  setOrders: (orders) => set({ orders }),
}));
