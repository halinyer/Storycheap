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
import { useRouter } from "next/navigation";
import { type DisplayCurrency } from "@/lib/currency";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import {
  computeCartTotals,
  MAX_ORDER_QUANTITY_PER_LINE,
} from "@/lib/volume-discounts";
import type {
  CartItem,
  Category,
  ProductDTO,
  Region,
  SessionUser,
} from "@/types";

const CART_STORAGE_KEY = "storycheap_cart_v2";
const CART_EVENT = "storycheap-cart-change";
const CURRENCY_STORAGE_KEY = "storycheap_currency_v1";
const CURRENCY_EVENT = "storycheap-currency-change";

function getCurrencySnapshot(): DisplayCurrency {
  if (typeof window === "undefined") return "USD";
  const raw = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
  return raw === "VES" ? "VES" : "USD";
}

function subscribeCurrency(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener("storage", handler);
  window.addEventListener(CURRENCY_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(CURRENCY_EVENT, handler);
  };
}

function writeCurrencyToStorage(currency: DisplayCurrency) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
  window.dispatchEvent(new Event(CURRENCY_EVENT));
}

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

  // Storefront currency display (USD primary vs Bs primary)
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  bsRateCents: number | null;
  hydrateBsRateCents: (rateCents: number | null) => void;

  // Cart
  cartItems: CartItem[];
  cartCount: number;
  cartSubtotalCents: number;
  cartRegularSubtotalCents: number;
  cartSavingsCents: number;
  cartDrawerOpen: boolean;
  setCartDrawerOpen: (open: boolean) => void;
  addToCart: (item: Omit<CartItem, "quantity">, qty?: number) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  removeFromCart: (variantId: string) => void;
  clearCart: () => void;
  syncCartPrices: () => Promise<{ changedCount: number; removedCount: number }>;

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
  const router = useRouter();
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
  const displayCurrency = useSyncExternalStore(
    subscribeCurrency,
    getCurrencySnapshot,
    () => "USD" as const
  );
  const [bsRateCents, setBsRateCents] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    fetch("/api/payments/pagomovil/availability", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { bsRateCents?: number | null } | null) => {
        if (
          active &&
          typeof data?.bsRateCents === "number" &&
          data.bsRateCents > 0
        ) {
          setBsRateCents(data.bsRateCents);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setDisplayCurrency = useCallback((currency: DisplayCurrency) => {
    writeCurrencyToStorage(currency);
  }, []);

  const hydrateBsRateCents = useCallback((rateCents: number | null) => {
    if (typeof rateCents === "number" && Number.isFinite(rateCents) && rateCents > 0) {
      setBsRateCents(rateCents);
    }
  }, []);

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
    const supabase = createSupabaseBrowserClient();

    async function bootstrapSession() {
      let pendingRedirect: string | null = null;

      try {
        if (typeof window !== "undefined") {
          const rawHash = window.location.hash.startsWith("#")
            ? window.location.hash.slice(1)
            : window.location.hash;
          const hashParams = new URLSearchParams(rawHash);
          const queryParams = new URLSearchParams(window.location.search);

          const hashType = hashParams.get("type");
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");
          const authError =
            hashParams.get("error_code") ||
            hashParams.get("error") ||
            queryParams.get("error_code");

          const queryTokenHash = queryParams.get("token_hash");
          const queryType = queryParams.get("type");
          const queryCode = queryParams.get("code");

          // Forward token_hash/PKCE callbacks that landed on "/" or "/reset-password" without /api/auth/callback
          if (queryTokenHash && queryType === "recovery") {
            window.location.replace(
              `/api/auth/callback?token_hash=${encodeURIComponent(
                queryTokenHash
              )}&type=recovery&next=${encodeURIComponent("/reset-password")}`
            );
            return;
          }

          if (
            queryCode &&
            (window.location.pathname === "/" ||
              window.location.pathname === "/reset-password")
          ) {
            let pendingRecovery = false;
            try {
              const rawTs = window.sessionStorage.getItem(
                "storycheap_pending_recovery"
              );
              if (rawTs && Date.now() - Number(rawTs) < 15 * 60_000) {
                pendingRecovery = true;
              }
              window.sessionStorage.removeItem("storycheap_pending_recovery");
            } catch {
              pendingRecovery = false;
            }
            const nextDest =
              window.location.pathname === "/reset-password" || pendingRecovery
                ? "/reset-password"
                : "/account";
            window.location.replace(
              `/api/auth/callback?code=${encodeURIComponent(
                queryCode
              )}&next=${encodeURIComponent(nextDest)}`
            );
            return;
          }

          if (accessToken && refreshToken && supabase) {
            const { error: setSessionErr } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            window.history.replaceState(
              window.history.state,
              "",
              window.location.pathname + window.location.search
            );
            if (!setSessionErr && hashType === "recovery") {
              try {
                window.sessionStorage.removeItem("storycheap_pending_recovery");
              } catch {
                // Ignore storage access failures
              }
              if (window.location.pathname !== "/reset-password") {
                pendingRedirect = "/reset-password";
              }
            } else if (setSessionErr && hashType === "recovery") {
              pendingRedirect = "/reset-password?error=expired";
            }
          } else if (authError) {
            if (rawHash) {
              window.history.replaceState(
                window.history.state,
                "",
                window.location.pathname + window.location.search
              );
            }
            if (
              hashType === "recovery" ||
              window.location.pathname === "/reset-password" ||
              authError === "otp_expired"
            ) {
              pendingRedirect = "/reset-password?error=expired";
            } else if (window.location.pathname === "/") {
              pendingRedirect = "/login?error=auth_callback_failed";
            }
          }
        }

        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = res.ok
          ? ((await res.json()) as {
              user: SessionUser | null;
              creditBalanceCents: number;
              sandboxEnabled: boolean;
            })
          : null;
        if (!active || !data) return;
        setSessionUser(data.user ?? null);
        setCreditBalanceCents(Number(data.creditBalanceCents ?? 0));
        setSandboxEnabled(Boolean(data.sandboxEnabled));
      } catch {
        // Ignore transient bootstrap errors
      } finally {
        if (active) {
          setIsSessionLoading(false);
          if (pendingRedirect) {
            router.replace(pendingRedirect);
          }
        }
      }
    }

    void bootstrapSession();

    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        void refreshSession().then(() => {
          if (
            typeof window !== "undefined" &&
            window.location.pathname !== "/reset-password"
          ) {
            router.replace("/reset-password");
          }
        });
      }
    }).data.subscription;

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [refreshSession, router]);

  const addToCart = useCallback(
    (item: Omit<CartItem, "quantity">, qty = 1) => {
      const current = readCartFromStorage();
      const idx = current.findIndex((c) => c.variantId === item.variantId);
      let next: CartItem[];
      if (idx >= 0) {
        next = current.map((c, i) =>
          i === idx
            ? {
                ...c,
                unitPriceCents: item.unitPriceCents,
                volumeDiscounts: item.volumeDiscounts,
                quantity: Math.min(MAX_ORDER_QUANTITY_PER_LINE, c.quantity + qty),
              }
            : c
        );
      } else {
        next = [
          ...current,
          {
            ...item,
            quantity: Math.min(MAX_ORDER_QUANTITY_PER_LINE, Math.max(1, qty)),
          },
        ];
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

  const syncCartPrices = useCallback(async () => {
    const current = readCartFromStorage();
    if (current.length === 0) {
      return { changedCount: 0, removedCount: 0 };
    }
    try {
      const res = await fetch("/api/catalog", { cache: "no-store" });
      if (!res.ok) return { changedCount: 0, removedCount: 0 };
      const payload = (await res.json()) as {
        products?: ProductDTO[];
        bsRateCents?: number | null;
      };
      if (
        typeof payload.bsRateCents === "number" &&
        payload.bsRateCents > 0
      ) {
        setBsRateCents(payload.bsRateCents);
      }
      const products = payload.products ?? [];
      const lookup = new Map<
        string,
        { product: ProductDTO; variant: ProductDTO["variants"][number] }
      >();
      for (const product of products) {
        for (const variant of product.variants) {
          lookup.set(variant.id, { product, variant });
        }
      }

      let changedCount = 0;
      let removedCount = 0;
      const next: CartItem[] = [];
      for (const item of current) {
        const match = lookup.get(item.variantId);
        if (!match || !match.product.active || !match.variant.active) {
          removedCount += 1;
          continue;
        }
        const nextTiersJson = JSON.stringify(match.variant.volumeDiscounts ?? []);
        const prevTiersJson = JSON.stringify(item.volumeDiscounts ?? []);
        if (
          match.variant.salePriceCents !== item.unitPriceCents ||
          nextTiersJson !== prevTiersJson
        ) {
          changedCount += 1;
        }
        next.push({
          ...item,
          productName: match.product.name,
          denominationLabel: match.variant.denominationLabel,
          unitPriceCents: match.variant.salePriceCents,
          volumeDiscounts: match.variant.volumeDiscounts,
          imageUrl: match.product.imageUrl,
          region: match.product.region,
        });
      }

      if (changedCount > 0 || removedCount > 0) {
        writeCartToStorage(next);
      }
      return { changedCount, removedCount };
    } catch {
      return { changedCount: 0, removedCount: 0 };
    }
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

  const cartTotals = useMemo(
    () => computeCartTotals(cartItems),
    [cartItems]
  );
  const cartSubtotalCents = cartTotals.subtotalCents;
  const cartRegularSubtotalCents = cartTotals.regularSubtotalCents;
  const cartSavingsCents = cartTotals.totalSavingsCents;

  const value = useMemo<StoreContextValue>(
    () => ({
      searchQuery,
      setSearchQuery,
      selectedCategory,
      setSelectedCategory,
      selectedRegion,
      setSelectedRegion,
      displayCurrency,
      setDisplayCurrency,
      bsRateCents,
      hydrateBsRateCents,
      cartItems,
      cartCount,
      cartSubtotalCents,
      cartRegularSubtotalCents,
      cartSavingsCents,
      cartDrawerOpen,
      setCartDrawerOpen,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      syncCartPrices,
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
      displayCurrency,
      setDisplayCurrency,
      bsRateCents,
      hydrateBsRateCents,
      cartItems,
      cartCount,
      cartSubtotalCents,
      cartRegularSubtotalCents,
      cartSavingsCents,
      cartDrawerOpen,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      syncCartPrices,
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
