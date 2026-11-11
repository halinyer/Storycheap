/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/catalog-seed";
import type { ProductDTO } from "@/types";
import { ArrowRight, Globe } from "lucide-react";

interface GiftCardCardProps {
  product: ProductDTO;
}

export function GiftCardCard({ product }: GiftCardCardProps) {
  const activeVariants = product.variants.filter((v) => v.active);
  const minPriceCents =
    activeVariants.length > 0
      ? Math.min(...activeVariants.map((v) => v.salePriceCents))
      : 1000;
  const anyInStock = activeVariants.some((v) => v.inStock);

  const cardRef = useRef<HTMLAnchorElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const normX = (x / rect.width) * 2 - 1;
    const normY = (y / rect.height) * 2 - 1;
    setTilt({ x: normX * 7, y: -normY * 7 });
    setGlare({
      x: (x / rect.width) * 100,
      y: (y / rect.height) * 100,
      opacity: 0.25,
    });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
    setGlare({ x: 50, y: 50, opacity: 0 });
  };

  return (
    <Link
      ref={cardRef}
      href={`/card/${product.slug}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `perspective(900px) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg)`,
        transition:
          tilt.x === 0 && tilt.y === 0 ? "transform 0.45s ease-out" : "none",
        transformStyle: "preserve-3d",
      }}
      className="group relative flex flex-col justify-between rounded-[28px] bg-slate-900/45 hover:bg-slate-900/80 border border-white/10 hover:border-white/25 p-3.5 sm:p-4 cursor-pointer select-none shadow-xl hover:shadow-2xl hover:shadow-black/80 overflow-hidden will-change-transform"
    >
      {/* Large Clean Card Artwork */}
      <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden mb-3.5 bg-gradient-to-b from-slate-950 via-slate-900/90 to-slate-950 flex items-center justify-center p-4 border border-white/[0.08] group-hover:border-white/20 transition-all duration-300">
        <div
          className="absolute inset-0 opacity-15 blur-2xl pointer-events-none group-hover:opacity-35 transition-opacity duration-500"
          style={{ background: product.accentColor }}
        />

        <img
          src={product.imageUrl}
          alt={product.name}
          className="relative z-10 max-h-full max-w-full object-contain rounded-xl drop-shadow-[0_15px_30px_rgba(0,0,0,0.7)] group-hover:scale-[1.04] transition-transform duration-300 ease-out"
        />

        <div
          className="absolute inset-0 pointer-events-none mix-blend-overlay transition-opacity duration-150 rounded-2xl z-20"
          style={{
            opacity: glare.opacity,
            background: `radial-gradient(circle 260px at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.4) 0%, transparent 70%)`,
          }}
        />

        {/* Stock Status */}
        <div className="absolute top-3 left-3 z-30">
          <span
            className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider shadow-sm ${
              anyInStock
                ? "bg-emerald-500/90 text-slate-950"
                : "bg-slate-800/90 text-slate-300 border border-white/10"
            }`}
          >
            {anyInStock ? "Disponible" : "Sin stock"}
          </span>
        </div>

        {/* Region Badge */}
        <div className="absolute top-3 right-3 z-30 px-2.5 py-1 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/15 text-[11px] font-bold text-slate-200 flex items-center gap-1">
          <Globe className="w-3 h-3 text-sky-400" />
          <span>{product.region}</span>
        </div>
      </div>

      {/* Minimalist Product Info (Zero Fake Reviews) */}
      <div className="px-1.5 pt-0.5 pb-2">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mb-1">
          {product.brand}
        </span>
        <h3 className="font-extrabold text-base text-white group-hover:text-sky-300 transition-colors line-clamp-1">
          {product.name}
        </h3>
      </div>

      {/* Price & CTA */}
      <div className="pt-3 border-t border-white/[0.08] px-1.5 flex items-center justify-between mt-auto">
        <div>
          <span className="text-[10px] text-slate-400 block font-medium">
            Desde
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-black text-white tracking-tight">
              {formatCents(minPriceCents)}
            </span>
            <span className="text-[10px] font-bold text-slate-400">USD</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-slate-950 text-xs font-black transition-all group-hover:bg-sky-300 group-hover:scale-105">
          <span>Elegir</span>
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </Link>
  );
}
