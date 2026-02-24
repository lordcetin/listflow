"use client";

import { useCallback, useEffect, useState } from "react";
import type { Order } from "@/types";

type OrdersResponse = {
  rows?: Order[];
  row?: Order;
  id?: string;
  error?: string;
};

export type CreateOrderInput = {
  storeId?: string | null;
  category: string;
  subProductName: string;
  variantName?: string | null;
  productLink: string;
  date: string;
  address: string;
  note?: string;
  ioss?: string;
  labelNumber: string;
  price: number;
};

export const useOrdersRepository = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/orders", {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json()) as OrdersResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Orders endpoint failed");
      }

      setOrders(payload.rows ?? []);
    } catch (loadError) {
      setOrders([]);
      setError(loadError instanceof Error ? loadError.message : "Orders could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const createOrder = useCallback(async (input: CreateOrderInput) => {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    const payload = (await response.json().catch(() => ({}))) as OrdersResponse;

    if (!response.ok) {
      throw new Error(payload.error || "Order could not be created");
    }

    if (payload.row) {
      setOrders((previous) => [payload.row as Order, ...previous]);
      return payload.row as Order;
    }

    await loadOrders();
    return null;
  }, [loadOrders]);

  const deleteOrder = useCallback(async (orderId: string) => {
    const response = await fetch(`/api/orders?id=${encodeURIComponent(orderId)}`, {
      method: "DELETE",
    });

    const payload = (await response.json().catch(() => ({}))) as OrdersResponse;

    if (!response.ok) {
      throw new Error(payload.error || "Order could not be deleted");
    }

    setOrders((previous) => previous.filter((order) => order.id !== orderId));
    return payload.id ?? orderId;
  }, []);

  return {
    orders,
    loading,
    error,
    reload: loadOrders,
    createOrder,
    deleteOrder,
  };
};
