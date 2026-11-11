"use client";

import React, { useEffect, useState } from "react";
import { GiftCardCard } from "@/components/storefront/gift-card-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStore } from "@/context/store-context";
import type { ProductDTO } from "@/types";
import { SearchX, ShieldCheck } from "lucide-react";

interface GiftCardGridProps {
  initialProducts: ProductDTO[];
}

export function GiftCardGrid({ initialProducts }: GiftCardGridProps) {
  const {
    selectedCategory,
    selectedRegion,
    searchQuery,
    setSearchQuery,
    setSelectedCategory,
    setSelectedRegion,
  } = useStore();

  const [products, setProducts] = useState<ProductDTO[]>(initialProducts);
  const [refreshing, setRefreshing] = useState(false);

  // Sync live stock availability cleanly on client mount
  useEffect(() => {
    let active = true;
    fetch("/api/catalog", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { products?: ProductDTO[] } | null) => {
        if (active && data?.products) {
          setProducts(data.products);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredProducts = products.filter((prod) => {
    if (selectedCategory !== "ALL" && prod.category !== selectedCategory) {
      return false;
    }
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

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6 text-xs text-slate-400">
        <div>
          Mostrando{" "}
          <span className="font-semibold text-white">
            {filteredProducts.length}
          </span>{" "}
          tarjetas oficiales
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Pago directo cripto • Entrega cifrada</span>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProducts.map((product) => (
            <GiftCardCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl apple-glass p-12 text-center max-w-md mx-auto my-12">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <SearchX className="w-6 h-6 text-sky-400" />
          </div>
          <h3 className="text-base font-bold text-white mb-2">
            Sin coincidencias
          </h3>
          <p className="text-xs text-slate-400 mb-6 leading-relaxed">
            No encontramos tarjetas para esa combinación de búsqueda, categoría o región.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSelectedCategory("ALL");
              setSelectedRegion("ALL");
            }}
            className="px-4 py-2.5 rounded-xl bg-white text-slate-950 text-xs font-black"
          >
            Mostrar todo el catálogo
          </button>
        </div>
      )}
    </div>
  );
}
