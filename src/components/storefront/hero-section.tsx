"use client";

import React from "react";
import { useStore } from "@/context/store-context";
import type { Category } from "@/types";
import { ArrowRight, Flame } from "lucide-react";

interface CategoryTile {
  id: string;
  label: string;
  category: Category | "ALL";
  query?: string;
  bgClass: string;
  imageSrc?: string;
  isFlame?: boolean;
}

const CATEGORY_TILES: CategoryTile[] = [
  {
    id: "popular",
    label: "Populares",
    category: "ALL",
    bgClass: "from-[#1d1436] to-[#110d22] border-purple-500/20",
    isFlame: true,
  },
  {
    id: "all",
    label: "Todas las tarjetas",
    category: "ALL",
    bgClass: "from-[#4338ca] to-[#29226c] border-indigo-400/25",
    imageSrc: "/cards/nintendo.png",
  },
  {
    id: "gaming",
    label: "PlayStation y Consolas",
    category: "gaming",
    bgClass: "from-[#0369a1] to-[#0c2d48] border-sky-400/25",
    imageSrc: "/cards/playstation.png",
  },
  {
    id: "streaming",
    label: "Netflix y Streaming",
    category: "streaming",
    bgClass: "from-[#b91c1c] to-[#450a0a] border-rose-400/25",
    imageSrc: "/cards/netflix.png",
  },
  {
    id: "shopping",
    label: "Apple y Tiendas USA",
    category: "shopping",
    bgClass: "from-[#0f766e] to-[#111827] border-teal-400/25",
    imageSrc: "/cards/apple.png",
  },
  {
    id: "crypto",
    label: "Binance y Cripto",
    category: "crypto",
    bgClass: "from-[#b45309] to-[#291504] border-amber-400/25",
    imageSrc: "/cards/binance.png",
  },
];

export function HeroSection() {
  const { selectedCategory, setSelectedCategory, setSearchQuery } = useStore();

  const scrollToCatalog = (cat?: Category | "ALL", query = "") => {
    if (cat) setSelectedCategory(cat);
    setSearchQuery(query);
    const el = document.getElementById("catalogo");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-3">
      {/* Row 1: 3 Bento Windows (6 cols Main + 3 cols Streaming/Apple + 3 cols 2x2 Mosaic) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Window 1: Wide Banner with Real PlayStation, Steam & Nintendo Cards Fan (6 cols) */}
        <div className="lg:col-span-6 relative rounded-3xl overflow-hidden min-h-[290px] sm:min-h-[320px] bg-gradient-to-br from-[#0c1428] via-[#111f42] to-[#0a0d18] border border-white/[0.08] flex flex-col justify-between p-6 sm:p-8 group">
          <div className="absolute right-6 top-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-sky-500/20 blur-3xl pointer-events-none" />

          {/* Right Fan of Real Official Gift Cards */}
          <div className="hidden sm:block absolute right-6 top-1/2 -translate-y-1/2 w-[250px] h-[240px] pointer-events-none select-none">
            <img
              src="/cards/nintendo.png"
              alt="Nintendo eShop"
              className="absolute right-28 top-6 w-28 h-40 object-contain drop-shadow-2xl -rotate-15 opacity-90 group-hover:-translate-x-1.5 group-hover:-rotate-18 transition-all duration-300"
            />
            <img
              src="/cards/steam.png"
              alt="Steam Wallet"
              className="absolute right-2 top-6 w-28 h-40 object-contain drop-shadow-2xl rotate-12 opacity-95 group-hover:translate-x-1.5 group-hover:rotate-15 transition-all duration-300"
            />
            <img
              src="/cards/playstation.png"
              alt="PlayStation Store"
              className="absolute right-14 top-3 w-32 h-44 object-contain drop-shadow-[0_20px_35px_rgba(0,0,0,0.75)] -rotate-2 group-hover:scale-105 transition-transform duration-300"
            />
          </div>

          <div className="relative z-10 max-w-xs sm:max-w-[300px] space-y-3 my-auto">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-bold text-sky-200">
              <span>Códigos Oficiales Verificados</span>
            </span>

            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white leading-[1.08]">
              Recarga tus cuentas{" "}
              <span className="italic font-serif text-sky-300 block">
                al instante.
              </span>
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              PlayStation, Nintendo, Steam, Xbox y más con entrega inmediata en
              tu bóveda y pago cripto exacto.
            </p>
          </div>

          <div className="relative z-10 pt-3">
            <button
              type="button"
              onClick={() => scrollToCatalog("ALL")}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white hover:bg-slate-200 text-slate-950 font-black text-xs sm:text-sm shadow-lg transition-all cursor-pointer"
            >
              <span>Explorar catálogo</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Window 2: Real Apple, Netflix & Spotify Floating Stack (3 cols) */}
        <button
          type="button"
          onClick={() => scrollToCatalog("streaming")}
          className="lg:col-span-3 text-left relative rounded-3xl overflow-hidden min-h-[290px] sm:min-h-[320px] bg-gradient-to-b from-[#151928] via-[#10131e] to-[#0b0d14] border border-white/[0.08] hover:border-white/20 p-5 flex flex-col justify-between group transition-all cursor-pointer"
        >
          <div className="relative h-44 w-full flex items-center justify-center pt-2 pointer-events-none select-none">
            <div className="absolute w-36 h-36 rounded-full bg-emerald-500/15 blur-2xl" />
            <img
              src="/cards/apple.png"
              alt="Apple Gift Card"
              className="absolute left-5 top-5 w-24 h-32 object-contain drop-shadow-xl -rotate-12 group-hover:-rotate-15 transition-transform duration-300"
            />
            <img
              src="/cards/spotify.png"
              alt="Spotify Premium"
              className="absolute right-5 top-5 w-24 h-32 object-contain drop-shadow-xl rotate-12 group-hover:rotate-15 transition-transform duration-300"
            />
            <img
              src="/cards/netflix.png"
              alt="Netflix USA"
              className="relative z-10 w-26 h-36 object-contain drop-shadow-[0_16px_28px_rgba(0,0,0,0.75)] group-hover:scale-105 transition-transform duration-300"
            />
          </div>

          <div className="relative z-10 space-y-1.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Región USA Oficial</span>
            </span>
            <h2 className="text-sm sm:text-base font-black text-white leading-snug">
              Netflix, Spotify y Apple sin tarjetas bancarias
            </h2>
          </div>
        </button>

        {/* Window 3: 2x2 Mosaic of Real Game Artworks (Free Fire, Steam, Roblox, Nintendo) (3 cols) */}
        <button
          type="button"
          onClick={() => scrollToCatalog("gaming")}
          className="lg:col-span-3 text-left relative rounded-3xl overflow-hidden min-h-[290px] sm:min-h-[320px] bg-gradient-to-b from-[#151824] to-[#0b0d14] border border-white/[0.08] hover:border-white/20 p-4 flex flex-col justify-between group transition-all cursor-pointer"
        >
          <div className="grid grid-cols-2 gap-2 h-48 w-full overflow-hidden rounded-2xl">
            <div className="relative rounded-xl overflow-hidden bg-slate-900">
              <img
                src="/cards/freefire.png"
                alt="Garena Free Fire"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            </div>
            <div className="relative rounded-xl overflow-hidden bg-slate-900">
              <img
                src="/cards/steam.png"
                alt="Steam"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            </div>
            <div className="relative rounded-xl overflow-hidden bg-slate-900">
              <img
                src="/cards/roblox.png"
                alt="Roblox"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            </div>
            <div className="relative rounded-xl overflow-hidden bg-[#ffde00]">
              <img
                src="/cards/nintendo.png"
                alt="Nintendo"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            </div>
          </div>

          <div className="pt-3 px-1">
            <h2 className="text-sm sm:text-base font-black text-white leading-snug">
              Recargas directas en los juegos más jugados
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Free Fire • Steam • Roblox • Nintendo
            </p>
          </div>
        </button>
      </div>

      {/* Row 2: Category Tiles with Real Official Card Images */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
        {CATEGORY_TILES.map((tile) => {
          const isSelected =
            tile.id !== "popular" && selectedCategory === tile.category;

          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => scrollToCatalog(tile.category, tile.query ?? "")}
              className={`relative h-24 rounded-2xl bg-gradient-to-br ${
                tile.bgClass
              } border p-3.5 text-left overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer ${
                isSelected
                  ? "ring-2 ring-white shadow-lg"
                  : "opacity-95 hover:opacity-100"
              }`}
            >
              <span className="relative z-10 text-xs sm:text-[13px] font-extrabold text-white leading-tight block max-w-[110px]">
                {tile.label}
              </span>

              {tile.isFlame ? (
                <div className="absolute -right-2 -bottom-3 w-16 h-16 rounded-full bg-rose-500/15 flex items-center justify-center pointer-events-none">
                  <Flame className="w-10 h-10 text-rose-400/90 -rotate-12" />
                </div>
              ) : (
                tile.imageSrc && (
                  <img
                    src={tile.imageSrc}
                    alt={tile.label}
                    className="absolute -right-2 -bottom-3 w-16 h-20 object-contain drop-shadow-lg -rotate-12 pointer-events-none"
                  />
                )
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
