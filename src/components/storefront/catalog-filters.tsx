"use client";

import React from "react";
import {
  useStore,
  type CatalogCategoryFilter,
  type CatalogDeliveryFilter,
} from "@/context/store-context";
import type { Region } from "@/types";
import { Globe2, KeyRound, RotateCcw, Zap } from "lucide-react";

const CATEGORY_TITLES: Record<CatalogCategoryFilter, string> = {
  ALL: "Catálogo oficial",
  topup: "Recargas Directas por ID",
  gaming: "Juegos y Consolas",
  streaming: "Streaming y Música",
  shopping: "Apple y Tiendas USA",
  crypto: "Tarjetas Cripto USDT",
};

const CATEGORY_SUBTITLES: Partial<Record<CatalogCategoryFilter, string>> = {
  topup: "Acreditación directa a tu UID de juego — sin códigos PIN ni contraseñas",
};

const DELIVERY_TABS: Array<{
  id: CatalogDeliveryFilter;
  label: string;
  icon?: "pin" | "topup";
}> = [
  { id: "all", label: "Todo" },
  { id: "pin", label: "Gift Cards", icon: "pin" },
  { id: "topup", label: "Recargas ID", icon: "topup" },
];

const REGIONS: Array<{ id: Region | "ALL"; label: string }> = [
  { id: "ALL", label: "Todas" },
  { id: "USA", label: "USA" },
  { id: "Latam", label: "Latam" },
  { id: "Global", label: "Global" },
];

export function CatalogFilters() {
  const {
    selectedCategory,
    setSelectedCategory,
    deliveryFilter,
    setDeliveryFilter,
    selectedRegion,
    setSelectedRegion,
    searchQuery,
    setSearchQuery,
  } = useStore();

  const hasActiveFilter =
    selectedCategory !== "ALL" ||
    deliveryFilter !== "all" ||
    selectedRegion !== "ALL" ||
    searchQuery.trim() !== "";

  const showDeliverySwitcher =
    selectedCategory === "ALL" ||
    selectedCategory === "topup" ||
    selectedCategory === "gaming";

  const heading =
    selectedCategory === "ALL" && deliveryFilter === "pin"
      ? "Tarjetas de Regalo (PIN)"
      : CATEGORY_TITLES[selectedCategory];

  const subtitle = CATEGORY_SUBTITLES[selectedCategory];

  return (
    <div id="catalogo" className="w-full pt-4 pb-5 scroll-mt-32">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-white/[0.07] pb-4">
        {/* Title & Active Search Chip */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
              {heading}
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
                  setDeliveryFilter("all");
                  setSelectedRegion("ALL");
                  setSearchQuery("");
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-[11px] font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Ver todo</span>
              </button>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-slate-400">{subtitle}</p>
          )}
        </div>

        {/* Right Controls: Delivery Segmented Pill + Compact Region Pills */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {showDeliverySwitcher && (
            <div
              role="tablist"
              aria-label="Tipo de producto"
              className="inline-flex items-center rounded-full bg-[#12151f] border border-white/[0.08] p-0.5"
            >
              {DELIVERY_TABS.map((tab) => {
                const active = deliveryFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setDeliveryFilter(tab.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                      active
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    {tab.icon === "pin" && (
                      <KeyRound
                        className={`w-3 h-3 ${
                          active ? "text-slate-900" : "text-slate-400"
                        }`}
                      />
                    )}
                    {tab.icon === "topup" && (
                      <Zap
                        className={`w-3 h-3 ${
                          active ? "text-sky-600" : "text-sky-400"
                        }`}
                      />
                    )}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="h-5 w-px bg-white/[0.08] hidden sm:block" />

          {/* Compact Region Filter */}
          <div className="flex items-center gap-1.5">
            <Globe2 className="w-3.5 h-3.5 text-slate-400 mr-0.5 hidden sm:inline" />
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
    </div>
  );
}
