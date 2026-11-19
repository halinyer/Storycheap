"use client";

import React, { useEffect, useState } from "react";
import { GiftCardCard } from "@/components/storefront/gift-card-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStore } from "@/context/store-context";
import type { ProductDTO } from "@/types";
import { ArrowRight, KeyRound, SearchX, ShieldCheck, Zap } from "lucide-react";

interface GiftCardGridProps {
  initialProducts: ProductDTO[];
  initialBsRateCents?: number | null;
}

function isDirectTopupProduct(prod: ProductDTO): boolean {
  return prod.variants.some((v) => v.active && Boolean(v.requiresTarget));
}

export function GiftCardGrid({
  initialProducts,
  initialBsRateCents = null,
}: GiftCardGridProps) {
  const {
    selectedCategory,
    deliveryFilter,
    selectedRegion,
    searchQuery,
    setSearchQuery,
    setSelectedCategory,
    setDeliveryFilter,
    setSelectedRegion,
    bsRateCents,
    hydrateBsRateCents,
  } = useStore();

  useEffect(() => {
    if (typeof initialBsRateCents === "number" && initialBsRateCents > 0) {
      hydrateBsRateCents(initialBsRateCents);
    }
  }, [initialBsRateCents, hydrateBsRateCents]);

  const effectiveBsRateCents = bsRateCents ?? initialBsRateCents;

  const [fetchedProducts, setFetchedProducts] = useState<ProductDTO[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const products = fetchedProducts ?? initialProducts;

  // Sync live stock availability cleanly on client mount
  useEffect(() => {
    let active = true;
    fetch("/api/catalog", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { products?: ProductDTO[]; bsRateCents?: number | null } | null) => {
        if (active && data?.products) {
          setFetchedProducts(data.products);
        }
        if (active && typeof data?.bsRateCents === "number" && data.bsRateCents > 0) {
          hydrateBsRateCents(data.bsRateCents);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [hydrateBsRateCents]);

  const filteredProducts = products.filter((prod) => {
    if (!prod.active || !prod.variants.some((v) => v.active)) {
      return false;
    }
    const isTopup = isDirectTopupProduct(prod);

    if (selectedCategory === "topup") {
      if (!isTopup) return false;
    } else if (selectedCategory !== "ALL" && prod.category !== selectedCategory) {
      return false;
    }

    if (deliveryFilter === "topup" && !isTopup) return false;
    if (deliveryFilter === "pin" && isTopup) return false;

    if (selectedRegion !== "ALL" && prod.region !== selectedRegion) {
      return false;
    }
    if (searchQuery.trim() !== "") {
      const q = searchQuery.trim().toLowerCase();
      return (
        prod.name.toLowerCase().includes(q) ||
        prod.brand.toLowerCase().includes(q) ||
        prod.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const giftCardProducts = filteredProducts.filter((p) => !isDirectTopupProduct(p));
  const directTopupProducts = filteredProducts.filter((p) => isDirectTopupProduct(p));

  const showSplitSections =
    selectedCategory === "ALL" &&
    deliveryFilter === "all" &&
    searchQuery.trim() === "" &&
    giftCardProducts.length > 0 &&
    directTopupProducts.length > 0;

  const countNoun =
    selectedCategory === "topup" || deliveryFilter === "topup"
      ? directTopupProducts.length === 1
        ? "recarga directa"
        : "recargas directas"
      : deliveryFilter === "pin" || directTopupProducts.length === 0
        ? "tarjetas oficiales"
        : "productos oficiales";

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6 text-xs text-slate-400">
        <div>
          Mostrando{" "}
          <span className="font-semibold text-white">
            {filteredProducts.length}
          </span>{" "}
          {countNoun}
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Pago directo cripto o Bs · Entrega automática</span>
        </div>
      </div>

      {refreshing && products.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-3xl bg-white/[0.03] p-5 space-y-4">
              <Skeleton className="w-full h-64 rounded-2xl" />
              <Skeleton className="w-3/4 h-5 rounded-lg" />
              <Skeleton className="w-full h-10 rounded-xl" />
            </div>
          ))}
        </div>
      ) : filteredProducts.length > 0 ? (
        showSplitSections ? (
          <div className="space-y-14">
            {/* Section 1: Gift Cards (PIN) */}
            <section className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                      Tarjetas de Regalo (PIN)
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-[11px] font-bold text-slate-300 tabular-nums">
                      {giftCardProducts.length}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Códigos digitales oficiales listos para canjear en tu cuenta al instante.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setDeliveryFilter("pin")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  <span>Solo Gift Cards</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {giftCardProducts.map((product) => (
                  <GiftCardCard
                    key={product.id}
                    product={product}
                    bsRateCents={effectiveBsRateCents}
                  />
                ))}
              </div>
            </section>

            {/* Section 2: Direct Top-Ups (UID) */}
            <section className="border-t border-white/[0.08] pt-10 space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Zap className="w-4 h-4 text-sky-400" />
                    <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                      Recargas Directas por ID
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/25 text-[10px] font-bold text-sky-300 uppercase tracking-wide">
                      Sin PIN ni contraseña
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-[11px] font-bold text-slate-300 tabular-nums">
                      {directTopupProducts.length}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Solo ingresa tu UID y servidor; acreditamos el paquete directo a tu cuenta de juego.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedCategory("topup")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                >
                  <span>Ver todas las recargas</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {directTopupProducts.map((product) => (
                  <GiftCardCard
                    key={product.id}
                    product={product}
                    bsRateCents={effectiveBsRateCents}
                  />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
              <GiftCardCard
                key={product.id}
                product={product}
                bsRateCents={effectiveBsRateCents}
              />
            ))}
          </div>
        )
      ) : (
        <div className="rounded-3xl apple-glass p-12 text-center max-w-md mx-auto my-12">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <SearchX className="w-6 h-6 text-sky-400" />
          </div>
          <h3 className="text-base font-bold text-white mb-2">
            Sin coincidencias
          </h3>
          <p className="text-xs text-slate-400 mb-6 leading-relaxed">
            No encontramos productos para esa combinación de búsqueda, categoría o región.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSelectedCategory("ALL");
              setDeliveryFilter("all");
              setSelectedRegion("ALL");
            }}
            className="px-4 py-2.5 rounded-xl bg-white text-slate-950 text-xs font-black cursor-pointer"
          >
            Mostrar todo el catálogo
          </button>
        </div>
      )}
    </div>
  );
}
