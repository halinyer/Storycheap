"use client";

import React from "react";
import { useStore } from "@/context/store-context";
import type { Category, Region } from "@/types";
import {
  Binary,
  Gamepad2,
  Globe2,
  Layers,
  ShoppingBag,
  Tv,
} from "lucide-react";

const CATEGORIES: Array<{
  id: Category | "ALL";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "ALL", label: "Todo el Catálogo", icon: Layers },
  { id: "gaming", label: "Videojuegos & Consolas", icon: Gamepad2 },
  { id: "streaming", label: "Streaming & Música", icon: Tv },
  { id: "shopping", label: "Apple & Apps", icon: ShoppingBag },
  { id: "crypto", label: "Cripto USDT", icon: Binary },
];

const REGIONS: Array<{ id: Region | "ALL"; label: string }> = [
  { id: "ALL", label: "Todas las regiones" },
  { id: "USA", label: "Estados Unidos (USA)" },
  { id: "Global", label: "Global (Mundial)" },
  { id: "Latam", label: "Latinoamérica" },
  { id: "Europa", label: "Europa" },
];

export function CatalogFilters() {
  const {
    selectedCategory,
    setSelectedCategory,
    selectedRegion,
    setSelectedRegion,
  } = useStore();

  return (
    <div className="w-full space-y-4 mb-8">
      <div className="flex items-center justify-between flex-wrap gap-4 pb-3 border-b border-white/[0.08]">
        <div className="flex items-center gap-2 overflow-x-auto max-w-full p-1 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  isSelected
                    ? "bg-white text-slate-950 shadow-md"
                    : "text-slate-300 hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${isSelected ? "text-slate-950" : "text-sky-400"}`}
                />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 apple-glass-pill px-3 py-1.5 rounded-2xl">
          <Globe2 className="w-4 h-4 text-slate-300" />
          <select
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value as Region | "ALL")}
            aria-label="Filtrar por región"
            className="bg-transparent text-xs font-bold text-slate-200 py-1 pr-2 focus:outline-none cursor-pointer"
          >
            {REGIONS.map((reg) => (
              <option key={reg.id} value={reg.id} className="bg-slate-900 text-white">
                {reg.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
