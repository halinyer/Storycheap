"use client";

import React from "react";
import Link from "next/link";
import {
  useStore,
  type CatalogCategoryFilter,
} from "@/context/store-context";
import { ArrowRight, Flame, Gamepad2, ShieldCheck, Zap } from "lucide-react";

interface CategoryTile {
  id: string;
  label: string;
  category: CatalogCategoryFilter;
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
    id: "topup",
    label: "Recargas por ID",
    category: "topup",
    bgClass: "from-[#1e3a8a] to-[#0f172a] border-sky-400/25",
    imageSrc: "/cards/genshin.png",
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

  const scrollToCatalog = (cat?: CatalogCategoryFilter, query = "") => {
    if (cat) setSelectedCategory(cat);
    setSearchQuery(query);
    const el = document.getElementById("catalogo");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-3">
      {/* Row 1: 3 Bento Windows (6 cols Main + 3 cols Streaming/Apple + 3 cols 2x2 Mosaic) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Window 1: Featured PlayStation Store Gift Card with High-Res GTA V Banner (6 cols - CoinGate Style) */}
        <Link
          href="/card/playstation-store-usd"
          className="lg:col-span-6 relative rounded-3xl overflow-hidden min-h-[300px] sm:min-h-[330px] border border-sky-500/25 hover:border-sky-400/50 flex flex-col justify-between p-6 sm:p-8 group cursor-pointer transition-all duration-300 shadow-xl hover:shadow-[0_0_35px_rgba(0,112,209,0.3)]"
        >
          {/* HD GTA V Official Backdrop */}
          <img
            src="/banners/playstation-gtav-banner.jpg"
            alt="Grand Theft Auto V y PlayStation Store"
            className="absolute inset-0 w-full h-full object-cover object-[70%_center] sm:object-right group-hover:scale-105 transition-transform duration-700 ease-out"
          />

          {/* Cinematic Overlays (CoinGate dark gradient: ensures high text readability on left while showing HD game art) */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#070b16] via-[#070b16]/90 sm:via-[#070b16]/75 to-black/30 pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#070b16]/90 via-transparent to-[#070b16]/30 pointer-events-none" />

          {/* Electric PlayStation Blue Ambient Glow */}
          <div className="absolute right-4 sm:right-12 top-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-[#0070d1]/35 blur-3xl pointer-events-none" />

          {/* Floating PlayStation Card Artwork (CoinGate 3D Showcase) */}
          <div className="absolute right-3 sm:right-7 top-1/2 -translate-y-1/2 pointer-events-none select-none flex items-center justify-center">
            <div className="relative">
              {/* Outer Cyan Ambient Ring */}
              <div className="absolute inset-0 rounded-2xl bg-sky-400/20 blur-xl transform group-hover:scale-110 transition-transform duration-500" />

              {/* 3D Angled Official PlayStation Card */}
              <img
                src="/cards/playstation.png"
                alt="PlayStation Store Gift Card"
                className="relative z-10 w-28 sm:w-36 lg:w-44 h-auto object-contain drop-shadow-[0_20px_35px_rgba(0,0,0,0.85)] -rotate-6 group-hover:-rotate-2 group-hover:scale-105 transition-all duration-500"
              />

              {/* Mini Pill Tag over Card */}
              <span className="hidden sm:inline-flex items-center gap-1 absolute -bottom-3 left-1/2 -translate-x-1/2 z-20 px-2.5 py-0.5 rounded-full bg-slate-900/90 border border-sky-400/40 text-[10px] font-black text-sky-300 shadow-lg whitespace-nowrap backdrop-blur-md">
                <Gamepad2 className="w-3 h-3 text-sky-400" />
                <span>PS5 / PS4 Oficial</span>
              </span>
            </div>
          </div>

          {/* Text Content (Left aligned with high contrast & verified badges) */}
          <div className="relative z-10 max-w-[270px] sm:max-w-xs lg:max-w-[340px] space-y-2.5 my-auto">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-500/20 border border-sky-400/35 text-[11px] font-bold text-sky-200 backdrop-blur-md shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                <span>PlayStation Store · GTA V</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[10px] font-bold text-slate-200 backdrop-blur-md">
                <span>USA (USD)</span>
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl lg:text-[34px] font-black tracking-tight text-white leading-[1.08]">
              PlayStation Store{" "}
              <span className="italic font-serif text-sky-300 block">
                Gift Card USA
              </span>
            </h1>

            <p className="text-xs sm:text-[13px] text-slate-200 leading-relaxed drop-shadow-sm">
              Recarga saldo oficial para comprar <strong>GTA V</strong>, Shark Cards, expansiones y juegos completos en PS4 y PS5 al instante.
            </p>

            <div className="flex items-center gap-3 text-[11px] text-slate-300 font-semibold pt-0.5">
              <span className="flex items-center gap-1 text-emerald-400">
                <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                Entrega instantánea
              </span>
              <span className="flex items-center gap-1 text-sky-300">
                <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                PIN 100% Verificado
              </span>
            </div>
          </div>

          {/* Action Row */}
          <div className="relative z-10 pt-3 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white group-hover:bg-sky-50 text-slate-950 font-black text-xs sm:text-sm shadow-[0_0_20px_rgba(255,255,255,0.35)] group-hover:shadow-[0_0_25px_rgba(56,189,248,0.5)] transition-all">
              <span>Comprar PlayStation Card</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </span>
            <span className="text-[11px] sm:text-xs font-bold text-slate-300/90 group-hover:text-white transition-colors">
              Tarjetas de $10 a $100 USD
            </span>
          </div>
        </Link>

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
