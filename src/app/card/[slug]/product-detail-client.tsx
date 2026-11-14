"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PayYourWay } from "@/components/storefront/pay-your-way";
import { Card3DInteractive } from "@/components/ui/card-3d-interactive";
import { useStore } from "@/context/store-context";
import { resolveBrandTheme } from "@/lib/brand-theme";
import { formatCents } from "@/lib/catalog-seed";
import type { ProductDTO } from "@/types";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Globe,
  Lock,
  Mail,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";

interface ProductDetailClientProps {
  product: ProductDTO;
}

export function ProductDetailClient({ product }: ProductDetailClientProps) {
  const router = useRouter();
  const { addToCart, setCartDrawerOpen } = useStore();

  const activeVariants = product.variants
    .filter((v) => v.active)
    .sort(
      (a, b) =>
        a.salePriceCents - b.salePriceCents || a.faceValueCents - b.faceValueCents
    );
  const firstAvailable =
    activeVariants.find((v) => v.inStock) ?? activeVariants[0];
  const [selectedVariantId, setSelectedVariantId] = useState(
    firstAvailable?.id ?? ""
  );
  const [quantity, setQuantity] = useState(1);

  const selectedVariant =
    activeVariants.find((v) => v.id === selectedVariantId) ?? firstAvailable;

  const canBuy = Boolean(selectedVariant && selectedVariant.inStock);
  const accent = product.accentColor || "#0070d1";
  const brandTheme = resolveBrandTheme(product.name, product.slug);

  const maxQuantity = selectedVariant
    ? typeof selectedVariant.deliverableStock === "number" &&
      selectedVariant.deliverableStock > 0
      ? Math.min(5, selectedVariant.deliverableStock)
      : selectedVariant.availableStock > 0
        ? Math.min(5, selectedVariant.availableStock)
        : 5
    : 1;

  const outOfStockLabels = activeVariants
    .filter((v) => !v.inStock)
    .map((v) => v.denominationLabel);

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
      toast.success(
        `${product.brand} (${selectedVariant.denominationLabel}) agregado al carrito`
      );
      setCartDrawerOpen(true);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Minimal Breadcrumb */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors mb-7"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Volver al catálogo</span>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
        {/* Left Column: Product Hero Banner + Pay Your Way + Description */}
        <div className="lg:col-span-7 space-y-7">
          {/* Restrained Hero Card Banner */}
          <div
            className="rounded-2xl border border-white/[0.08] p-6 sm:p-7"
            style={{
              background: `linear-gradient(135deg, ${accent}24 0%, rgba(15, 17, 25, 0.92) 65%)`,
            }}
          >
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
              <div className="w-44 sm:w-48 shrink-0">
                <Card3DInteractive
                  minimal
                  imageSrc={product.imageUrl}
                  cardName={product.name}
                  brand={product.brand}
                  accentColor={accent}
                  region={product.region}
                />
              </div>

              <div className="flex-1 min-w-0 space-y-3 text-center sm:text-left pt-1">
                <span className="text-xs font-medium text-slate-300/85">
                  {product.brand}
                </span>

                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white leading-tight">
                  {product.name}
                </h1>

                <div className="space-y-2 pt-1 text-xs text-slate-300">
                  <div className="flex items-center justify-center sm:justify-start gap-2">
                    <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>
                      Válida en la región:{" "}
                      <strong className="font-medium text-white">
                        {product.region}
                      </strong>
                    </span>
                  </div>

                  <div className="flex items-center justify-center sm:justify-start gap-2">
                    <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>
                      Entrega digital:{" "}
                      <span className="text-slate-200">
                        al instante en tu bóveda y correo
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Minimalist Payment Marks Strip */}
          <PayYourWay variant="card" />

          {/* Description */}
          <div className="space-y-4">
            <p className="text-sm text-slate-300 leading-relaxed">
              {product.description}
            </p>

            {product.regionWarning && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-100/90 leading-relaxed">
                  <span className="font-medium text-amber-300 block mb-0.5">
                    Verifica la región antes de comprar
                  </span>
                  {product.regionWarning}
                </div>
              </div>
            )}
          </div>

          {/* Always-Open Official Redemption Guide Card */}
          <div className="rounded-2xl border border-white/[0.1] bg-[#11131c] p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-sky-400 block">
                  Guía paso a paso
                </span>
                <h2 className="text-base sm:text-lg font-black text-white mt-0.5">
                  ¿Dónde y cómo canjear tu código de {brandTheme.brandName}?
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {brandTheme.redeemUrl && (
                  <a
                    href={brandTheme.redeemUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-xs font-bold text-white transition-colors"
                  >
                    <span>{brandTheme.redeemLabel}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
                  </a>
                )}
                {brandTheme.secondaryRedeemUrl &&
                  brandTheme.secondaryRedeemLabel && (
                    <a
                      href={brandTheme.secondaryRedeemUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-xs font-bold text-slate-300 transition-colors"
                    >
                      <span>{brandTheme.secondaryRedeemLabel}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                    </a>
                  )}
              </div>
            </div>

            {brandTheme.redeemHost && (
              <div className="text-xs text-slate-400">
                Sitio web oficial de canje:{" "}
                <span className="font-mono font-bold text-sky-300">
                  {brandTheme.redeemHost}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {brandTheme.steps.map((step, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-slate-950/75 border border-white/[0.07] p-3.5 space-y-1.5"
                >
                  <div className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 text-white font-black text-[10px] uppercase">
                    Paso {i + 1}
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {step}
                  </p>
                </div>
              ))}
            </div>

            {brandTheme.importantNote && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-400/25 px-3.5 py-2.5 text-xs text-amber-100/95 leading-relaxed">
                <strong className="text-amber-300 font-bold">
                  Importante:{" "}
                </strong>
                {brandTheme.importantNote}
              </div>
            )}

            <details className="group rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
              <summary className="flex items-center justify-between cursor-pointer list-none text-xs font-bold text-slate-300">
                <span>Términos y compatibilidad regional</span>
                <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" />
              </summary>
              <p className="mt-2.5 text-xs text-slate-400 leading-relaxed">
                {product.terms || "Válido únicamente para la región indicada."}
              </p>
            </details>
          </div>
        </div>

        {/* Right Column: Unified Purchase Card */}
        <div className="lg:col-span-5 lg:sticky lg:top-24">
          <div className="rounded-2xl border border-white/[0.1] bg-[#0e1017] p-6 space-y-5 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.65)]">
            {/* Region Row */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-slate-400 block">
                Región
              </span>
              <div className="rounded-xl border border-white/[0.1] bg-white/[0.025] px-3.5 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-sm font-medium text-white truncate">
                    {product.region}
                  </span>
                </div>
                <span className="text-[11px] font-medium text-emerald-400/90 shrink-0">
                  Compatible
                </span>
              </div>
            </div>

            {/* Denomination Grid */}
            <div className="space-y-2.5">
              <span className="text-xs font-medium text-slate-400 block">
                Valor
              </span>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                      className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                        isSelected
                          ? "border-white bg-white/[0.07] text-white ring-1 ring-white/50"
                          : variant.inStock
                            ? "border-white/[0.1] bg-transparent hover:border-white/25 hover:bg-white/[0.03] text-slate-200"
                            : "border-white/[0.05] bg-transparent text-slate-500 opacity-50"
                      }`}
                    >
                      <div className="text-[13px] font-semibold leading-snug">
                        {variant.denominationLabel}
                      </div>
                      <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                        {formatCents(variant.salePriceCents)} US$
                      </div>
                    </button>
                  );
                })}
              </div>

              {outOfStockLabels.length > 0 && (
                <p className="text-[11px] text-slate-500 pt-0.5">
                  Fuera de stock: {outOfStockLabels.join(" · ")}
                </p>
              )}
            </div>

            {/* Price Summary, Live Stock & Quantity */}
            {selectedVariant && (
              <>
                <div className="flex items-end justify-between gap-4 pt-1">
                  <div>
                    <span className="text-xs text-slate-400 block">Pagas</span>
                    <div className="text-3xl font-semibold tracking-tight text-white tabular-nums mt-0.5">
                      {formatCents(selectedVariant.salePriceCents * quantity)}{" "}
                      <span className="text-base font-medium text-slate-300">
                        US$
                      </span>
                    </div>

                    {selectedVariant.inStock ? (
                      <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          En stock
                          {typeof selectedVariant.deliverableStock ===
                            "number" && selectedVariant.deliverableStock <= 5
                            ? ` · ${selectedVariant.deliverableStock} disp.`
                            : ""}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-rose-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Fuera de stock</span>
                      </div>
                    )}
                  </div>

                  {/* Minimal Quantity Stepper */}
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[11px] text-slate-400">
                      Cantidad
                    </span>
                    <div className="inline-flex items-center rounded-xl border border-white/[0.1] bg-white/[0.025] p-0.5">
                      <button
                        type="button"
                        aria-label="Disminuir cantidad"
                        disabled={quantity <= 1}
                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/[0.06] disabled:opacity-35 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-7 text-center text-xs font-semibold text-white tabular-nums">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="Aumentar cantidad"
                        disabled={!canBuy || quantity >= maxQuantity}
                        onClick={() =>
                          setQuantity((q) => Math.min(maxQuantity, q + 1))
                        }
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/[0.06] disabled:opacity-35 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Primary & Secondary CTAs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={!canBuy}
                    onClick={() => handleAddToCart(true)}
                    className="w-full py-3 px-4 rounded-xl bg-[#0070d1] hover:bg-[#0b84eb] disabled:bg-white/[0.06] disabled:text-slate-500 text-white font-semibold text-sm flex items-center justify-center transition-colors shadow-sm"
                  >
                    <span>{canBuy ? "Comprar ahora" : "Sin stock"}</span>
                  </button>

                  <button
                    type="button"
                    disabled={!canBuy}
                    onClick={() => handleAddToCart(false)}
                    className="w-full py-3 px-4 rounded-xl border border-white/[0.16] bg-transparent hover:bg-white/[0.05] disabled:opacity-40 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <ShoppingCart className="w-4 h-4 shrink-0" />
                    <span>Añadir al carrito</span>
                  </button>
                </div>
              </>
            )}

            {/* 3-Column Trust Footer */}
            <div className="border-t border-white/[0.08] pt-4 grid grid-cols-3 gap-2 text-center">
              <div className="space-y-1">
                <Lock className="w-3.5 h-3.5 text-slate-400 mx-auto" />
                <span className="block text-[11px] text-slate-400 leading-tight">
                  Pago seguro
                </span>
              </div>
              <div className="space-y-1">
                <Clock className="w-3.5 h-3.5 text-slate-400 mx-auto" />
                <span className="block text-[11px] text-slate-400 leading-tight">
                  Entrega al instante
                </span>
              </div>
              <div className="space-y-1">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400 mx-auto" />
                <span className="block text-[11px] text-slate-400 leading-tight">
                  Códigos oficiales
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
