/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/context/store-context";
import { formatCents } from "@/lib/catalog-seed";
import {
  ArrowLeft,
  CheckCircle2,
  Coins,
  CreditCard,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

export default function CheckoutPage() {
  const router = useRouter();
  const {
    cartItems,
    cartSubtotalCents,
    clearCart,
    sessionUser,
    creditBalanceCents,
    refreshSession,
  } = useStore();

  const [applyCredit, setApplyCredit] = useState(true);
  const [acceptedRegionPolicy, setAcceptedRegionPolicy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const usableCreditCents =
    sessionUser && applyCredit
      ? Math.min(Math.max(0, creditBalanceCents), cartSubtotalCents)
      : 0;
  const amountDueCents = Math.max(0, cartSubtotalCents - usableCreditCents);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cartItems.length === 0) {
      toast.error("Tu carrito está vacío.");
      return;
    }
    if (!sessionUser) {
      toast.error("Inicia sesión o crea tu cuenta antes de finalizar la compra.");
      router.push("/login?mode=register&next=/checkout");
      return;
    }
    if (!acceptedRegionPolicy) {
      toast.error(
        "Por favor confirma que verificaste la región compatible de tus tarjetas."
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: sessionUser.email,
          items: cartItems.map((it) => ({
            variantId: it.variantId,
            quantity: it.quantity,
          })),
          applyStoreCredit: Boolean(sessionUser && applyCredit),
          paymentGateway: "zenobank",
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        orderId?: string;
        checkoutUrl?: string;
        paidInFullByCredit?: boolean;
      };

      if (!res.ok || !data.orderId) {
        throw new Error(
          data.error ?? "No se pudo iniciar tu orden. Intenta nuevamente."
        );
      }

      clearCart();
      await refreshSession();

      if (data.paidInFullByCredit || !data.checkoutUrl) {
        router.push(`/order/${data.orderId}`);
        return;
      }

      // If sandbox local URL, navigate via Next router; if external ZenoBank URL, redirect browser
      if (data.checkoutUrl.startsWith(window.location.origin)) {
        const rel = data.checkoutUrl.slice(window.location.origin.length);
        router.push(rel);
      } else {
        window.location.href = data.checkoutUrl;
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error inesperado en el checkout"
      );
      setSubmitting(false);
    }
  };

  if (cartItems.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <h1 className="text-2xl font-black text-white">No hay ítems para pagar</h1>
        <p className="text-xs text-slate-400">
          Agrega una gift card al carrito para continuar al checkout seguro.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-slate-950 font-black text-xs"
        >
          Volver al catálogo
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <Link
        href="/cart"
        className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Volver al carrito</span>
      </Link>

      <div className="mb-8">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 mb-2">
          <Lock className="w-3.5 h-3.5" />
          <span>Checkout Cifrado • StoryCheap</span>
        </div>
        <h1 className="text-3xl font-black text-white">Finalizar Compra</h1>
      </div>

      <form
        onSubmit={handleCheckout}
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
      >
        {/* Left Column: Customer Info, Credit Toggle, Payment Method */}
        <div className="lg:col-span-7 space-y-6">
          {/* Step 1: Account Verification Required */}
          <div className="rounded-3xl apple-glass p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                <Mail className="w-4 h-4 text-sky-400" />
                <span>1. Cuenta para entrega y bóveda</span>
              </h2>
              {sessionUser ? (
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-black uppercase text-emerald-300">
                  Verificada
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[10px] font-black uppercase text-amber-300">
                  Requerida
                </span>
              )}
            </div>

            {sessionUser ? (
              <div>
                <label
                  htmlFor="checkout-email"
                  className="block text-xs font-bold text-slate-300 mb-2"
                >
                  Correo de tu cuenta
                </label>
                <input
                  id="checkout-email"
                  type="email"
                  readOnly
                  value={sessionUser.email}
                  className="w-full rounded-2xl bg-slate-950/80 border border-white/15 px-4 py-3 text-sm text-white focus:outline-none opacity-90"
                />
                <p className="text-[11px] text-slate-400 mt-2">
                  Tus códigos quedarán guardados automáticamente en Mi Cuenta y te notificaremos a este correo cuando estén listos.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-950/70 border border-white/10 p-5 space-y-4">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Para proteger tus códigos en tu bóveda cifrada y resguardar tu saldo a favor ante cualquier diferencia de pago, debes iniciar sesión o crear tu cuenta antes de pagar.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  <Link
                    href="/login?mode=register&next=/checkout"
                    className="px-4 py-2.5 rounded-xl bg-white hover:bg-sky-300 text-slate-950 font-black text-xs transition-colors"
                  >
                    Crear cuenta gratis
                  </Link>
                  <Link
                    href="/login?next=/checkout"
                    className="px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-white font-bold text-xs transition-colors"
                  >
                    Ya tengo cuenta · Entrar
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Internal Store Credit (Only if authenticated & balance > 0) */}
          {sessionUser && creditBalanceCents > 0 && (
            <div className="rounded-3xl apple-glass p-6 space-y-3 border border-emerald-500/25">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-white">
                      Saldo a favor disponible: {formatCents(creditBalanceCents)} USD
                    </h3>
                    <p className="text-xs text-slate-400">
                      Descontar automáticamente de esta orden.
                    </p>
                  </div>
                </div>

                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyCredit}
                    onChange={(e) => setApplyCredit(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:bg-emerald-500 relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                </label>
              </div>
            </div>
          )}

          {/* Step 2: Payment Method */}
          <div className="rounded-3xl apple-glass p-6 space-y-4">
            <h2 className="text-base font-extrabold text-white flex items-center gap-2">
              <Coins className="w-4 h-4 text-sky-400" />
              <span>2. Método de pago</span>
            </h2>

            {amountDueCents === 0 ? (
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div className="text-xs text-emerald-100">
                  <span className="font-bold block">
                    Cubierto 100% con tu saldo a favor interno
                  </span>
                  No necesitas enviar pago externo. Al confirmar, procesaremos tu entrega al instante.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl border-2 border-sky-500/60 bg-sky-500/10 p-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-300 shrink-0 mt-0.5">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-white">
                        ZenoBank Crypto Checkout
                      </div>
                      <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                        Paga con USDT, USDC u otras criptos soportadas con verificación automática por firma criptográfica.
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-sky-400 text-slate-950 text-[10px] font-black uppercase shrink-0">
                    Activo
                  </span>
                </div>

                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 flex items-center justify-between opacity-55">
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-slate-400" />
                    <div>
                      <div className="text-xs font-bold text-slate-300">
                        Pago Móvil Venezuela (Pablito API)
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Próximamente disponible
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase text-slate-500">
                    Pronto
                  </span>
                </div>
              </div>
            )}

            {/* Policy & Region Confirmation Checkbox */}
            <label className="flex items-start gap-3 pt-2 cursor-pointer text-xs text-slate-300">
              <input
                type="checkbox"
                checked={acceptedRegionPolicy}
                onChange={(e) => setAcceptedRegionPolicy(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-white/20 bg-slate-950 text-sky-500 focus:ring-sky-500"
              />
              <span className="leading-relaxed">
                Confirmo que verifiqué la región compatible de cada gift card y acepto la{" "}
                <Link
                  href="/ayuda"
                  target="_blank"
                  className="text-sky-400 underline hover:text-sky-300"
                >
                  política de entregas y saldo a favor
                </Link>
                .
              </span>
            </label>
          </div>
        </div>

        {/* Right Column: Sticky Order Summary */}
        <div className="lg:col-span-5 rounded-3xl apple-glass p-6 space-y-5 lg:sticky lg:top-24">
          <h2 className="text-base font-black text-white">Resumen de tu orden</h2>

          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {cartItems.map((it) => (
              <div
                key={it.variantId}
                className="flex items-center gap-3 py-2 border-b border-white/[0.06]"
              >
                <div className="w-12 h-14 rounded-lg bg-slate-950 border border-white/10 p-1 flex items-center justify-center shrink-0">
                  <img
                    src={it.imageUrl}
                    alt={it.productName}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-extrabold text-white truncate">
                    {it.productName}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {it.denominationLabel} × {it.quantity} • {it.region}
                  </div>
                </div>
                <div className="text-xs font-black text-white">
                  {formatCents(it.unitPriceCents * it.quantity)}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2 text-xs pt-1">
            <div className="flex justify-between text-slate-300">
              <span>Subtotal</span>
              <span>{formatCents(cartSubtotalCents)} USD</span>
            </div>
            {usableCreditCents > 0 && (
              <div className="flex justify-between text-emerald-400 font-bold">
                <span>Saldo a favor aplicado</span>
                <span>-{formatCents(usableCreditCents)} USD</span>
              </div>
            )}
            <div className="flex justify-between items-baseline pt-3 border-t border-white/[0.08]">
              <span className="text-sm font-bold text-white">Total a pagar</span>
              <span className="text-2xl font-black text-white">
                {formatCents(amountDueCents)} USD
              </span>
            </div>
          </div>

          {sessionUser ? (
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-4 px-5 rounded-2xl bg-white hover:bg-sky-300 disabled:bg-slate-700 disabled:text-slate-300 text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition-all shadow-xl"
            >
              <Lock className="w-4 h-4" />
              <span>
                {submitting
                  ? "Creando orden segura..."
                  : amountDueCents === 0
                  ? "Confirmar con Saldo a favor"
                  : "Continuar al pago en ZenoBank"}
              </span>
            </button>
          ) : (
            <Link
              href="/login?mode=register&next=/checkout"
              className="w-full py-4 px-5 rounded-2xl bg-white hover:bg-sky-300 text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition-all shadow-xl"
            >
              <Lock className="w-4 h-4" />
              <span>Crear cuenta o iniciar sesión para pagar</span>
            </Link>
          )}

          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-3.5 text-[11px] text-slate-400 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              Si envías un monto menor o superior al exacto, tu dinero no se pierde: la diferencia se acredita a tu saldo a favor interno.
            </span>
          </div>
        </div>
      </form>
    </div>
  );
}
