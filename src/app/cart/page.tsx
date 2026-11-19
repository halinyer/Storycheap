/* eslint-disable @next/next/no-img-element */
"use client";

import React from "react";
import Link from "next/link";
import { useStore } from "@/context/store-context";
import { formatCents } from "@/lib/catalog-seed";
import { formatBsFromUsdCents } from "@/lib/currency";
import {
  MAX_ORDER_QUANTITY_PER_LINE,
  resolveVolumeTierPrice,
} from "@/lib/volume-discounts";
import {
  ArrowLeft,
  ArrowRight,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Trash2,
} from "lucide-react";

export default function CartPage() {
  const {
    cartItems,
    cartCount,
    cartSubtotalCents,
    cartRegularSubtotalCents,
    cartSavingsCents,
    displayCurrency,
    bsRateCents,
    updateQuantity,
    removeFromCart,
    clearCart,
  } = useStore();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Seguir explorando</span>
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-white">Tu Carrito</h1>
          <p className="text-xs text-slate-400 mt-1">
            {cartCount} {cartCount === 1 ? "tarjeta seleccionada" : "tarjetas seleccionadas"}
          </p>
        </div>

        {cartItems.length > 0 && (
          <button
            type="button"
            onClick={clearCart}
            className="text-xs font-bold text-slate-400 hover:text-rose-400 transition-colors"
          >
            Vaciar carrito
          </button>
        )}
      </div>

      {cartItems.length === 0 ? (
        <div className="rounded-3xl apple-glass p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-slate-400">
            <ShoppingBag className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-extrabold text-white">
            No tienes tarjetas en tu carrito
          </h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Explora PlayStation, Nintendo, Xbox, Steam, Roblox, Free Fire y más en el catálogo oficial.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-slate-950 font-black text-xs hover:bg-sky-300 transition-colors"
          >
            <span>Ir al catálogo</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 space-y-4">
            {cartItems.map((item) => {
              const lineKey = item.cartKey ?? item.variantId;
              const tier = resolveVolumeTierPrice({
                baseUnitPriceCents: item.unitPriceCents,
                quantity: item.quantity,
                volumeDiscounts: item.volumeDiscounts,
              });
              const lineBs = formatBsFromUsdCents(tier.lineTotalCents, bsRateCents);
              const showBsPrimary = displayCurrency === "VES" && Boolean(lineBs);

              return (
                <div
                  key={lineKey}
                  className="rounded-2xl apple-glass p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  <div className="w-20 h-24 rounded-xl bg-slate-950 border border-white/10 p-2 flex items-center justify-center shrink-0">
                    <img
                      src={item.imageUrl}
                      alt={item.productName}
                      className="max-h-full max-w-full object-contain rounded"
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {item.brand} • Región {item.region}
                    </span>
                    <Link
                      href={`/card/${item.productSlug}`}
                      className="block text-base font-extrabold text-white hover:text-sky-300 truncate"
                    >
                      {item.productName}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <p className="text-xs text-sky-400 font-bold">
                        {item.denominationLabel} —{" "}
                        {tier.appliedTier ? (
                          <>
                            <span className="line-through text-slate-500 font-normal mr-1">
                              {formatCents(item.unitPriceCents)}
                            </span>
                            <span className="text-white font-semibold">
                              {formatCents(tier.effectiveUnitPriceCents)} USD c/u
                            </span>
                          </>
                        ) : (
                          `${formatCents(item.unitPriceCents)} c/u`
                        )}
                      </p>
                      {item.requiresTarget && (
                        <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/25 text-[10px] font-bold text-sky-300">
                          Recarga directa por ID
                        </span>
                      )}
                      {tier.appliedTier && (
                        <span className="px-2 py-0.5 rounded-full bg-white/[0.08] border border-white/15 text-[10px] font-semibold text-slate-200 tabular-nums">
                          {tier.appliedTier.minQuantity}+ u. · -{tier.discountPct}%
                        </span>
                      )}
                    </div>
                    {item.targetSummary && (
                      <div className="mt-2 inline-block rounded-lg bg-slate-950/80 border border-white/10 px-2.5 py-1 text-[11px] font-mono text-emerald-300/95">
                        {item.targetValidationStatus === "valid" ? "✓ " : ""}
                        {item.targetSummary}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4">
                    <div className="flex items-center gap-1.5 rounded-xl bg-slate-950 border border-white/10 p-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(lineKey, item.quantity - 1)
                        }
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/10"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-7 text-center text-xs font-black text-white tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        disabled={item.quantity >= MAX_ORDER_QUANTITY_PER_LINE}
                        onClick={() =>
                          updateQuantity(lineKey, item.quantity + 1)
                        }
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/10 disabled:opacity-35"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="text-right min-w-[84px] tabular-nums">
                      {tier.lineSavingsCents > 0 && (
                        <div className="text-[11px] text-slate-500 line-through">
                          {formatCents(tier.regularLineTotalCents)}
                        </div>
                      )}
                      <div className="text-base font-black text-white">
                        {showBsPrimary ? lineBs : formatCents(tier.lineTotalCents)}
                      </div>
                      {showBsPrimary ? (
                        <div className="text-[11px] text-slate-400">
                          ≈ {formatCents(tier.lineTotalCents)} USD
                        </div>
                      ) : (
                        lineBs && (
                          <div className="text-[11px] text-slate-400">
                            ≈ {lineBs}
                          </div>
                        )
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeFromCart(lineKey)}
                      aria-label="Eliminar"
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="lg:col-span-4 rounded-3xl apple-glass p-6 space-y-5">
            <h2 className="text-base font-black text-white">Resumen</h2>

            <div className="space-y-2.5 text-xs border-b border-white/[0.08] pb-4">
              {cartSavingsCents > 0 && (
                <>
                  <div className="flex justify-between text-slate-400">
                    <span>Precio regular</span>
                    <span className="line-through tabular-nums">
                      {formatCents(cartRegularSubtotalCents)} USD
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-200 font-semibold">
                    <span>Ahorro por volumen</span>
                    <span className="tabular-nums">
                      -{formatCents(cartSavingsCents)} USD
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-slate-300">
                <span>Subtotal ({cartCount} ítem{cartCount === 1 ? "" : "s"})</span>
                <span className="font-bold text-white tabular-nums">
                  {formatCents(cartSubtotalCents)} USD
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Comisión StoryCheap</span>
                <span className="font-bold text-emerald-400">$0.00</span>
              </div>
            </div>

            {(() => {
              const totalBs = formatBsFromUsdCents(cartSubtotalCents, bsRateCents);
              const showBsPrimary = displayCurrency === "VES" && Boolean(totalBs);
              return (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-slate-200">
                    Total estimado
                  </span>
                  <div className="text-right tabular-nums">
                    <span className="text-2xl font-black text-white block">
                      {showBsPrimary ? totalBs : `${formatCents(cartSubtotalCents)} USD`}
                    </span>
                    {showBsPrimary ? (
                      <span className="text-xs text-slate-400 block mt-0.5">
                        ≈ {formatCents(cartSubtotalCents)} USD
                      </span>
                    ) : (
                      totalBs && (
                        <span className="text-xs text-slate-400 block mt-0.5">
                          ≈ {totalBs}
                        </span>
                      )
                    )}
                  </div>
                </div>
              );
            })()}

            <Link
              href="/checkout"
              className="w-full py-3.5 px-5 rounded-2xl bg-white hover:bg-sky-300 text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
            >
              <span>Continuar al checkout</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <div className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                En el siguiente paso podrás aplicar cualquier saldo a favor interno y pagar con ZenoBank.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
