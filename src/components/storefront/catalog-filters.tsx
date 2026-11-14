"use client";

import React from "react";
import { useStore } from "@/context/store-context";
import type { Category, Region } from "@/types";
import { Globe2, RotateCcw } from "lucide-react";

const CATEGORY_TITLES: Record<Category | "ALL", string> = {
  ALL: "Todas las tarjetas de regalo",
  gaming: "Juegos y Consolas",
  streaming: "Streaming y Música",
  shopping: "Apple y Tiendas USA",
  crypto: "Tarjetas Cripto USDT",
};

const REGIONS: Array<{ id: Region | "ALL"; label: string }> = [
  { id: "ALL", label: "Todas las regiones" },
  { id: "USA", label: "USA" },
  { id: "Latam", label: "Latam" },
  { id: "Global", label: "Global" },
];

export function CatalogFilters() {
  const {
    selectedCategory,
    setSelectedCategory,
    selectedRegion,
    setSelectedRegion,
    searchQuery,
    setSearchQuery,
  } = useStore();

  const hasActiveFilter =
    selectedCategory !== "ALL" ||
    selectedRegion !== "ALL" ||
    searchQuery.trim() !== "";

  return (
    <div id="catalogo" className="w-full pt-4 pb-5 scroll-mt-32">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
            {CATEGORY_TITLES[selectedCategory]}
          </h2>
          {searchQuery.trim() !== "" && (
            <span className="px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-400/30 text-xs font-bold text-indigo-200">
              Búsqueda: &ldquo;{searchQuery}&rdquo;
            </span>
          )}
          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory("ALL");
                setSelectedRegion("ALL");
                setSearchQuery("");
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-[11px] font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Ver todas</span>
            </button>
          )}
        </div>

        {/* Compact Region Filter */}
        <div className="flex items-center gap-1.5">
          <Globe2 className="w-3.5 h-3.5 text-slate-400 mr-1 hidden sm:inline" />
          {REGIONS.map((reg) => {
            const active = selectedRegion === reg.id;
            return (
              <button
                key={reg.id}
                type="button"
                onClick={() => setSelectedRegion(reg.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                  active
                    ? "bg-white text-slate-950 shadow-sm"
                    : "bg-[#151822] text-slate-300 hover:text-white border border-white/[0.07]"
                }`}
              >
                {reg.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
