"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { CartItem, Category, Region, SessionUser } from "@/types";

const CART_STORAGE_KEY = "storycheap_cart_v2";
const CART_EVENT = "storycheap-cart-change";

function readCartFromStorage(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

let cachedCartSnapshot: CartItem[] = [];
let cachedCartRaw: string | null = "__init__";
const EMPTY_CART: CartItem[] = [];

function getCartSnapshot(): CartItem[] {
  if (typeof window === "undefined") return EMPTY_CART;
  const raw = window.localStorage.getItem(CART_STORAGE_KEY);
  if (raw !== cachedCartRaw) {
    cachedCartRaw = raw;
    cachedCartSnapshot = readCartFromStorage();
  }
  return cachedCartSnapshot;
}

function subscribeCart(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener("storage", handler);
  window.addEventListener(CART_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(CART_EVENT, handler);
  };
}

function writeCartToStorage(items: CartItem[]) {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(items);
  cachedCartRaw = serialized;
  cachedCartSnapshot = items;
  window.localStorage.setItem(CART_STORAGE_KEY, serialized);
  window.dispatchEvent(new Event(CART_EVENT));
}

interface StoreContextValue {
  // Storefront filters
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategory: Category | "ALL";
  setSelectedCategory: (cat: Category | "ALL") => void;
  selectedRegion: Region | "ALL";
  setSelectedRegion: (reg: Region | "ALL") => void;

  // Cart
  cartItems: CartItem[];
  cartCount: number;
  cartSubtotalCents: number;
  cartDrawerOpen: boolean;
  setCartDrawerOpen: (open: boolean) => void;
  addToCart: (item: Omit<CartItem, "quantity">, qty?: number) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  removeFromCart: (variantId: string) => void;
  clearCart: () => void;

  // Auth / Session state (authoritative from /api/auth/session)
  sessionUser: SessionUser | null;
  creditBalanceCents: number;
  sandboxEnabled: boolean;
  isSessionLoading: boolean;
  refreshSession: () => Promise<void>;
  signInSandbox: (email: string, role?: "customer" | "admin") => Promise<void>;
  signOut: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<Category | "ALL">("ALL");
  const [selectedRegion, setSelectedRegion] = useState<Region | "ALL">("ALL");
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

  const cartItems = useSyncExternalStore(
    subscribeCart,
    getCartSnapshot,
    () => EMPTY_CART
  );

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [creditBalanceCents, setCreditBalanceCents] = useState(0);
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        user: SessionUser | null;
        creditBalanceCents: number;
        sandboxEnabled: boolean;
      };
      setSessionUser(data.user ?? null);
      setCreditBalanceCents(Number(data.creditBalanceCents ?? 0));
      setSandboxEnabled(Boolean(data.sandboxEnabled));
    } catch {
      // Ignore transient network errors during session bootstrap
    } finally {
      setIsSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            user: SessionUser | null;
            creditBalanceCents: number;
            sandboxEnabled: boolean;
          } | null
        ) => {
          if (!active || !data) return;
          setSessionUser(data.user ?? null);
          setCreditBalanceCents(Number(data.creditBalanceCents ?? 0));
          setSandboxEnabled(Boolean(data.sandboxEnabled));
        }
      )
      .catch(() => {})
      .finally(() => {
        if (active) setIsSessionLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const addToCart = useCallback(
    (item: Omit<CartItem, "quantity">, qty = 1) => {
      const current = readCartFromStorage();
      const idx = current.findIndex((c) => c.variantId === item.variantId);
      let next: CartItem[];
      if (idx >= 0) {
        next = current.map((c, i) =>
          i === idx
            ? { ...c, quantity: Math.min(10, c.quantity + qty) }
            : c
        );
      } else {
        next = [...current, { ...item, quantity: Math.min(10, Math.max(1, qty)) }];
      }
      writeCartToStorage(next);
    },
    []
  );

  const updateQuantity = useCallback((variantId: string, quantity: number) => {
    const current = readCartFromStorage();
    const next =
      quantity <= 0
        ? current.filter((c) => c.variantId !== variantId)
        : current.map((c) =>
            c.variantId === variantId
              ? { ...c, quantity: Math.min(10, quantity) }
              : c
          );
    writeCartToStorage(next);
  }, []);

  const removeFromCart = useCallback((variantId: string) => {
    const next = readCartFromStorage().filter((c) => c.variantId !== variantId);
    writeCartToStorage(next);
  }, []);

  const clearCart = useCallback(() => {
    writeCartToStorage([]);
  }, []);

  const signInSandbox = useCallback(
    async (email: string, role?: "customer" | "admin") => {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, sandboxRole: role }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "No se pudo iniciar sesión demo.");
      }
      await refreshSession();
    },
    [refreshSession]
  );

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionUser(null);
    setCreditBalanceCents(0);
  }, []);

  const cartCount = useMemo(
    () => cartItems.reduce((acc, it) => acc + it.quantity, 0),
    [cartItems]
  );

  const cartSubtotalCents = useMemo(
    () => cartItems.reduce((acc, it) => acc + it.unitPriceCents * it.quantity, 0),
    [cartItems]
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      searchQuery,
      setSearchQuery,
      selectedCategory,
      setSelectedCategory,
      selectedRegion,
      setSelectedRegion,
      cartItems,
      cartCount,
      cartSubtotalCents,
      cartDrawerOpen,
      setCartDrawerOpen,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      sessionUser,
      creditBalanceCents,
      sandboxEnabled,
      isSessionLoading,
      refreshSession,
      signInSandbox,
      signOut,
    }),
    [
      searchQuery,
      selectedCategory,
      selectedRegion,
      cartItems,
      cartCount,
      cartSubtotalCents,
      cartDrawerOpen,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      sessionUser,
      creditBalanceCents,
      sandboxEnabled,
      isSessionLoading,
      refreshSession,
      signInSandbox,
      signOut,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error("useStore must be used inside StoreProvider");
  }
  return ctx;
}
