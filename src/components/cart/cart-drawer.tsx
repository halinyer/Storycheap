/* eslint-disable @next/next/no-img-element */
"use client";

import React from "react";
import Link from "next/link";
import { useStore } from "@/context/store-context";
import { formatCents } from "@/lib/catalog-seed";
import {
  ArrowRight,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";

export function CartDrawer() {
  const {
    cartItems,
    cartCount,
    cartSubtotalCents,
    cartDrawerOpen,
    setCartDrawerOpen,
    updateQuantity,
    removeFromCart,
  } = useStore();

  if (!cartDrawerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={() => setCartDrawerOpen(false)}
      />

      {/* Drawer Panel */}
      <aside className="relative z-10 w-full max-w-md h-full bg-[#0d1019] border-l border-white/10 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-extrabold text-white">
              Tu Carrito ({cartCount})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setCartDrawerOpen(false)}
            aria-label="Cerrar carrito"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {cartItems.length === 0 ? (
            <div className="text-center py-16 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-slate-400">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Tu carrito está vacío</p>
                <p className="text-xs text-slate-400 mt-1">
                  Elige una gift card oficial para agregarla aquí.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCartDrawerOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-white text-slate-950 text-xs font-extrabold hover:bg-sky-300 transition-colors"
              >
                Explorar Catálogo
              </button>
            </div>
          ) : (
            cartItems.map((item) => (
              <div
                key={item.variantId}
                className="flex gap-4 p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08]"
              >
                <div className="w-16 h-20 rounded-xl bg-slate-950 border border-white/10 p-1.5 flex items-center justify-center shrink-0">
                  <img
                    src={item.imageUrl}
                    alt={item.productName}
                    className="max-h-full max-w-full object-contain rounded"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        {item.brand} • {item.region}
                      </p>
                      <h3 className="text-sm font-extrabold text-white truncate">
                        {item.productName}
                      </h3>
                      <p className="text-xs text-sky-400 font-semibold mt-0.5">
                        {item.denominationLabel}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.variantId)}
                      aria-label="Eliminar producto"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-1.5 rounded-xl bg-slate-900 border border-white/10 p-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(item.variantId, item.quantity - 1)
                        }
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/10"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center text-xs font-bold text-white">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(item.variantId, item.quantity + 1)
                        }
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/10"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="text-right">
                      <span className="text-sm font-black text-white">
                        {formatCents(item.unitPriceCents * item.quantity)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer CTA */}
        {cartItems.length > 0 && (
          <div className="p-6 border-t border-white/[0.08] bg-slate-950/60 space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 font-medium">Subtotal</span>
              <span className="text-lg font-black text-white">
                {formatCents(cartSubtotalCents)} USD
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>
                Stock reservado al pagar • Entrega segura en tu cuenta
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <Link
                href="/checkout"
                onClick={() => setCartDrawerOpen(false)}
                className="w-full py-3.5 px-4 rounded-2xl bg-white hover:bg-sky-300 text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-white/10"
              >
                <span>Ir a pagar</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/cart"
                onClick={() => setCartDrawerOpen(false)}
                className="w-full py-2.5 px-4 rounded-xl border border-white/10 hover:bg-white/[0.05] text-slate-300 font-bold text-xs text-center transition-colors"
              >
                Ver resumen completo del carrito
              </Link>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
