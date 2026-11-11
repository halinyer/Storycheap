"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card3DInteractive } from "@/components/ui/card-3d-interactive";
import { useStore } from "@/context/store-context";
import { formatCents } from "@/lib/catalog-seed";
import type { ProductDTO } from "@/types";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Globe,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

interface ProductDetailClientProps {
  product: ProductDTO;
}

export function ProductDetailClient({ product }: ProductDetailClientProps) {
  const router = useRouter();
  const { addToCart, setCartDrawerOpen } = useStore();

  const activeVariants = product.variants.filter((v) => v.active);
  const firstAvailable =
    activeVariants.find((v) => v.inStock) ?? activeVariants[0];
  const [selectedVariantId, setSelectedVariantId] = useState(
    firstAvailable?.id ?? ""
  );
  const [quantity, setQuantity] = useState(1);

  const selectedVariant =
    activeVariants.find((v) => v.id === selectedVariantId) ?? firstAvailable;

  const canBuy = Boolean(selectedVariant && selectedVariant.inStock);

  const handleAddToCart = (redirectCheckout: boolean) => {
    if (!selectedVariant || !selectedVariant.inStock) {
      toast.error("Esta denominación no tiene stock disponible en este momento.");
      return;
    }

    addToCart(
      {
        variantId: selectedVariant.id,
        productId: product.id,
        productSlug: product.slug,
        productName: product.name,
        brand: product.brand,
        region: product.region,
        imageUrl: product.imageUrl,
        denominationLabel: selectedVariant.denominationLabel,
        unitPriceCents: selectedVariant.salePriceCents,
      },
      quantity
    );

    if (redirectCheckout) {
      router.push("/checkout");
    } else {
      toast.success(`${product.brand} (${selectedVariant.denominationLabel}) agregado al carrito`);
      setCartDrawerOpen(true);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Minimal Breadcrumb */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Volver al catálogo</span>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
        {/* Left: Interactive 3D Card Showcase */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full max-w-sm rounded-[36px] apple-glass p-6 sm:p-8 flex items-center justify-center">
            <Card3DInteractive
              imageSrc={product.imageUrl}
              cardName={product.name}
              brand={product.brand}
              accentColor={product.accentColor}
              region={product.region}
              className="w-full"
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-4 text-center">
            Mueve el cursor sobre la tarjeta • Entrega digital oficial
          </p>
        </div>

        {/* Right: Clean Minimalist Configuration (No Payment Clutter) */}
        <div className="lg:col-span-7 space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-[11px] font-bold text-slate-200 uppercase tracking-wider">
                {product.brand}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-[11px] font-bold text-sky-300">
                <Globe className="w-3.5 h-3.5" />
                Región: {product.region}
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              {product.name}
            </h1>
            <p className="text-sm text-slate-300 mt-3 leading-relaxed">
              {product.description}
            </p>
          </div>

          {/* Explicit Region Warning Banner */}
          {product.regionWarning && (
            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-100 leading-relaxed">
                <span className="font-extrabold block text-amber-300 mb-0.5">
                  Verifica la región antes de comprar
                </span>
                {product.regionWarning}
              </div>
            </div>
          )}

          {/* Denomination Selector */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                Selecciona el monto
              </label>
              {selectedVariant && (
                <span className="text-xs text-slate-400">
                  {selectedVariant.inStock
                    ? selectedVariant.availableStock > 0
                      ? `${selectedVariant.availableStock} disponible(s)`
                      : "Disponible"
                    : "Sin stock"}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {activeVariants.map((variant) => {
                const isSelected = selectedVariant?.id === variant.id;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => {
                      setSelectedVariantId(variant.id);
                      setQuantity(1);
                    }}
                    className={`relative rounded-2xl p-4 text-left border transition-all ${
                      isSelected
                        ? "bg-white text-slate-950 border-white shadow-xl"
                        : variant.inStock
                        ? "bg-white/[0.04] hover:bg-white/[0.08] text-white border-white/10"
                        : "bg-white/[0.02] text-slate-500 border-white/[0.05] opacity-60"
                    }`}
                  >
                    {isSelected && (
                      <Check className="w-4 h-4 text-emerald-600 absolute top-3 right-3" />
                    )}
                    <div className="text-sm font-black">
                      {variant.denominationLabel}
                    </div>
                    <div
                      className={`text-xs font-bold mt-1 ${
                        isSelected ? "text-slate-700" : "text-sky-400"
                      }`}
                    >
                      {formatCents(variant.salePriceCents)} USD
                    </div>
                    {!variant.inStock && (
                      <div className="text-[10px] font-bold uppercase text-rose-400 mt-1">
                        Agotado
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Purchase Box: Quantity + Total + 2 Clean CTAs */}
          {selectedVariant && (
            <div className="rounded-3xl apple-glass p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <span className="text-xs text-slate-400 block">
                    Total por {quantity} unidad{quantity === 1 ? "" : "es"}
                  </span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-3xl font-black text-white">
                      {formatCents(selectedVariant.salePriceCents * quantity)}
                    </span>
                    <span className="text-xs font-bold text-slate-400">
                      USD
                    </span>
                  </div>
                </div>

                {/* Quantity */}
                <div className="flex items-center gap-2 rounded-2xl bg-slate-950 border border-white/10 p-1.5">
                  <button
                    type="button"
                    aria-label="Disminuir cantidad"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-300 hover:bg-white/10"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-8 text-center text-sm font-black text-white">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Aumentar cantidad"
                    onClick={() =>
                      setQuantity((q) =>
                        Math.min(
                          selectedVariant.availableStock > 0
                            ? Math.min(5, selectedVariant.availableStock)
                            : 5,
                          q + 1
                        )
                      )
                    }
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-300 hover:bg-white/10"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={!canBuy}
                  onClick={() => handleAddToCart(false)}
                  className="w-full py-3.5 px-5 rounded-2xl bg-white hover:bg-sky-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>{canBuy ? "Agregar al carrito" : "Sin stock"}</span>
                </button>

                <button
                  type="button"
                  disabled={!canBuy}
                  onClick={() => handleAddToCart(true)}
                  className="w-full py-3.5 px-5 rounded-2xl bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 border border-sky-400/40 text-sky-200 font-black text-sm flex items-center justify-center gap-2 transition-all"
                >
                  <Zap className="w-4 h-4" />
                  <span>Comprar ahora</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400 pt-1">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  El pago se realiza en el siguiente paso (ZenoBank Cripto o tu saldo a favor).
                </span>
              </div>
            </div>
          )}

          {/* Collapsible Accordions: Cómo canjear & Términos */}
          <div className="space-y-3">
            <details className="group rounded-2xl bg-white/[0.03] border border-white/[0.08] p-4">
              <summary className="flex items-center justify-between cursor-pointer list-none text-sm font-bold text-white">
                <span>¿Cómo canjear tu código?</span>
                <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" />
              </summary>
              <ol className="mt-3 space-y-2 text-xs text-slate-300 list-decimal list-inside leading-relaxed">
                {product.redemptionSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </details>

            <details className="group rounded-2xl bg-white/[0.03] border border-white/[0.08] p-4">
              <summary className="flex items-center justify-between cursor-pointer list-none text-sm font-bold text-white">
                <span>Términos y compatibilidad</span>
                <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" />
              </summary>
              <p className="mt-3 text-xs text-slate-300 leading-relaxed">
                {product.terms || "Válido únicamente para la región indicada."}
              </p>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
