"use client";

import React from "react";
import { useStore } from "@/context/store-context";
import type { Category } from "@/types";
import { Gamepad2, Search } from "lucide-react";

const QUICK_BRANDS: Array<{ label: string; query: string; category: Category }> = [
  { label: "PlayStation", query: "PlayStation", category: "gaming" },
  { label: "Nintendo", query: "Nintendo", category: "gaming" },
  { label: "Xbox", query: "Xbox", category: "gaming" },
  { label: "Steam", query: "Steam", category: "gaming" },
  { label: "Roblox", query: "Roblox", category: "gaming" },
  { label: "Free Fire", query: "Free Fire", category: "gaming" },
  { label: "Apple", query: "Apple", category: "shopping" },
  { label: "Netflix", query: "Netflix", category: "streaming" },
  { label: "Spotify", query: "Spotify", category: "streaming" },
  { label: "Binance USDT", query: "Binance", category: "crypto" },
];

export function HeroSection() {
  const { searchQuery, setSearchQuery, setSelectedCategory } = useStore();

  return (
    <section className="relative pt-10 pb-10 overflow-hidden">
      {/* Subtle Apple / Sony ambient backdrop */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-6xl h-72 pointer-events-none">
        <div className="absolute top-4 left-1/4 w-80 h-80 bg-[#0070d1]/15 rounded-full blur-[130px]" />
        <div className="absolute top-8 right-1/4 w-80 h-80 bg-[#e60012]/12 rounded-full blur-[140px]" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full apple-glass-pill text-xs font-semibold text-slate-200 mb-6">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
          <span>Códigos digitales oficiales • Entrega protegida</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white mb-4 leading-[1.1]">
          Tus Gift Cards oficiales.
          <span className="block mt-1 bg-gradient-to-r from-sky-400 via-indigo-200 to-rose-400 bg-clip-text text-transparent">
            Sin vueltas, directo a tu cuenta.
          </span>
        </h1>

        <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto mb-8 leading-relaxed">
          Elige tu tarjeta, verifica la región compatible y paga directo en el checkout sin recargar billeteras ni pasos complicados.
        </p>

        {/* Search Input */}
        <div className="relative max-w-2xl mx-auto mb-6">
          <div className="relative flex items-center rounded-2xl apple-glass p-2 shadow-2xl transition-all focus-within:ring-2 focus-within:ring-sky-500/50">
            <div className="pl-3 pr-2 text-slate-400">
              <Search className="w-5 h-5 text-sky-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Busca PlayStation, Nintendo, Xbox, Steam, Free Fire, Spotify..."
              className="w-full bg-transparent text-white placeholder-slate-400 text-sm sm:text-base font-medium focus:outline-none py-2 px-2"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="px-3 py-1 text-xs font-bold text-slate-300 hover:text-white rounded-xl bg-white/[0.08]"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>

        {/* Brand quick filter */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="text-slate-400 font-semibold mr-1 flex items-center gap-1.5">
            <Gamepad2 className="w-4 h-4 text-sky-400" />
            Marcas:
          </span>
          {QUICK_BRANDS.map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={() => {
                setSelectedCategory(b.category);
                setSearchQuery(b.query);
              }}
              className="px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-slate-200 font-semibold transition-colors"
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
