"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function Gta6Banner() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-1 pb-3">
      <Link
        href="/card/playstation-store-usd"
        className="relative block rounded-[32px] overflow-hidden border border-fuchsia-500/20 hover:border-fuchsia-400/40 bg-gradient-to-r from-[#100720] via-[#160a2c] to-[#0c051a] p-6 sm:p-10 lg:p-12 group cursor-pointer transition-all duration-500 shadow-2xl hover:shadow-[0_0_50px_rgba(217,70,239,0.25)]"
      >
        {/* 4K Official GTA VI Backdrop (Lucia in Vice City Sunset) */}
        <img
          src="/banners/gta6-lucia-4k.jpg"
          alt="Grand Theft Auto VI - Lucia en Vice City"
          className="absolute inset-0 w-full h-full object-cover object-[75%_center] sm:object-right group-hover:scale-105 transition-transform duration-700 ease-out"
        />

        {/* Vice City Cinematic Gradient Overlays (Ensures razor-sharp readability on the left) */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0d0517] via-[#0d0517]/95 sm:via-[#0d0517]/85 to-transparent/20 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d0517] via-transparent to-[#0d0517]/40 pointer-events-none" />

        {/* Vice City Neon Ambient Lighting (Fuchsia & PlayStation Royal Blue) */}
        <div className="absolute left-1/3 top-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-fuchsia-600/20 blur-[100px] pointer-events-none" />
        <div className="absolute right-10 top-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-[#0070d1]/30 blur-[90px] pointer-events-none" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Official GTA 6 Logo, Clean CoinGate-Style Headline, Subtitle & Action */}
          <div className="lg:col-span-7 space-y-4 max-w-xl">
            {/* Official Grand Theft Auto VI Logo */}
            <div className="flex items-center gap-4">
              <img
                src="/banners/gta6-logo.png"
                alt="Grand Theft Auto VI"
                className="h-14 sm:h-16 lg:h-20 w-auto object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.8)]"
              />
              <div className="h-10 w-px bg-white/15" />
              <div className="text-left">
                <span className="text-[11px] font-black uppercase tracking-widest text-fuchsia-400 block">
                  PlayStation Store
                </span>
                <span className="text-xs font-bold text-slate-300">
                  Región USA Oficial (USD)
                </span>
              </div>
            </div>

            {/* Main Headline */}
            <h2 className="text-2xl sm:text-4xl lg:text-[42px] font-black tracking-tight text-white leading-[1.08]">
              Prepárate para Vice City con tu PlayStation Card
            </h2>

            {/* Clean Subtitle */}
            <p className="text-xs sm:text-sm lg:text-[15px] text-slate-200 leading-relaxed drop-shadow-sm font-medium">
              Recarga saldo oficial para comprar Grand Theft Auto VI, reservar ediciones de preventa, adquirir Shark Cards y membresías de PS Plus en PS5 con entrega inmediata.
            </p>

            {/* Action Row: CoinGate Style White Button */}
            <div className="pt-2 flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-white group-hover:bg-fuchsia-50 text-slate-950 font-black text-xs sm:text-sm shadow-[0_0_25px_rgba(255,255,255,0.4)] group-hover:shadow-[0_0_35px_rgba(236,72,153,0.6)] transition-all">
                <span>Comprar PlayStation Card</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
              <span className="text-xs font-bold text-slate-300/90 group-hover:text-white transition-colors">
                Tarjetas oficiales de $10 a $100 USD
              </span>
            </div>
          </div>

          {/* Right Column: Floating Official PlayStation Gift Card Showcase */}
          <div className="hidden sm:flex lg:col-span-5 items-center justify-center lg:justify-end pointer-events-none select-none">
            <div className="relative">
              {/* Neon Cyan & Fuchsia Dual Glow */}
              <div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-[#0070d1]/40 via-fuchsia-500/30 to-sky-400/20 blur-2xl transform group-hover:scale-110 transition-transform duration-500" />

              {/* 3D Angled Official PlayStation Store Card */}
              <img
                src="/cards/playstation.png"
                alt="PlayStation Store Gift Card"
                className="relative z-10 w-44 sm:w-52 lg:w-60 h-auto object-contain drop-shadow-[0_25px_45px_rgba(0,0,0,0.9)] -rotate-6 group-hover:-rotate-2 group-hover:scale-105 transition-all duration-500"
              />
            </div>
          </div>
        </div>
      </Link>
    </section>
  );
}
