/* eslint-disable @next/next/no-img-element */
"use client";

import React from "react";
import Link from "next/link";
import { useStore } from "@/context/store-context";
import { formatCents } from "@/lib/catalog-seed";
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
            {cartItems.map((item) => (
              <div
                key={item.variantId}
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
                  <p className="text-xs text-sky-400 font-bold mt-1">
                    {item.denominationLabel} — {formatCents(item.unitPriceCents)} c/u
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4">
                  <div className="flex items-center gap-1.5 rounded-xl bg-slate-950 border border-white/10 p-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateQuantity(item.variantId, item.quantity - 1)
                      }
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/10"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-7 text-center text-xs font-black text-white">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateQuantity(item.variantId, item.quantity + 1)
                      }
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/10"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="text-right min-w-[72px]">
                    <div className="text-base font-black text-white">
                      {formatCents(item.unitPriceCents * item.quantity)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeFromCart(item.variantId)}
                    aria-label="Eliminar"
                    className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-4 rounded-3xl apple-glass p-6 space-y-5">
            <h2 className="text-base font-black text-white">Resumen</h2>

            <div className="space-y-2.5 text-xs border-b border-white/[0.08] pb-4">
              <div className="flex justify-between text-slate-300">
                <span>Subtotal ({cartCount} ítem{cartCount === 1 ? "" : "s"})</span>
                <span className="font-bold text-white">
                  {formatCents(cartSubtotalCents)} USD
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Comisión StoryCheap</span>
                <span className="font-bold text-emerald-400">$0.00</span>
              </div>
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-slate-200">Total estimado</span>
              <span className="text-2xl font-black text-white">
                {formatCents(cartSubtotalCents)} USD
              </span>
            </div>

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
