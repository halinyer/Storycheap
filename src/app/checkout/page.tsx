/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { StripeSecurityFooter } from "@/components/payments/payment-brand-marks";
import { formatBsNumber } from "@/components/payments/payment-helpers";
import {
  StripePaymentMethodSelector,
  type PagoMovilAvailabilityInfo,
} from "@/components/payments/stripe-payment-method-selector";
import { useStore } from "@/context/store-context";
import { formatCents } from "@/lib/catalog-seed";
import type { OrderDTO } from "@/types";

export default function CheckoutPage() {
  const router = useRouter();
  const {
    cartItems,
    cartSubtotalCents,
    clearCart,
    sessionUser,
    creditBalanceCents,
    isSessionLoading,
    refreshSession,
  } = useStore();

  const [applyCredit, setApplyCredit] = useState(true);
  const [acceptedRegionPolicy, setAcceptedRegionPolicy] = useState(false);
  const [paymentGateway, setPaymentGateway] = useState<"zenobank" | "pagomovil">(
    "zenobank"
  );
  const [pmAvailability, setPmAvailability] =
    useState<PagoMovilAvailabilityInfo | null>(null);
  const [loadingPm, setLoadingPm] = useState(true);
  const [pendingOrders, setPendingOrders] = useState<OrderDTO[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState<{
    mode: "zenobank" | "pagomovil" | "vault";
    orderId: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/payments/pagomovil/availability", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PagoMovilAvailabilityInfo | null) => {
        if (!active || !data) return;
        setPmAvailability(data);
      })
      .catch(() => {
        // Ignore network errors while querying gateway availability
      })
      .finally(() => {
        if (active) setLoadingPm(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionUser) {
      return;
    }
    let active = true;
    fetch("/api/account/summary", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { orders?: OrderDTO[] } | null) => {
        if (!active || !data?.orders) return;
        const openPending = data.orders.filter(
          (o) =>
            (o.status === "PENDING_PAYMENT" || o.status === "CREATED") &&
            (!o.expiresAt || Date.parse(o.expiresAt) > Date.now())
        );
        setPendingOrders(openPending);
      })
      .catch(() => {
        // Silent best-effort check
      });

    return () => {
      active = false;
    };
  }, [sessionUser]);

  const visiblePendingOrders = sessionUser ? pendingOrders : [];

  const usableCreditCents =
    sessionUser && applyCredit && creditBalanceCents > 0
      ? Math.min(creditBalanceCents, cartSubtotalCents)
      : 0;
  const amountDueCents = Math.max(0, cartSubtotalCents - usableCreditCents);

  const estimatedBsCents =
    pmAvailability?.bsRateCents && amountDueCents > 0
      ? Math.round((amountDueCents * pmAvailability.bsRateCents) / 100)
      : 0;

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionUser) {
      router.push("/login?redirect=/checkout");
      return;
    }
    if (cartItems.length === 0) {
      toast.error("Tu carrito está vacío.");
      return;
    }
    if (!acceptedRegionPolicy) {
      toast.error("Confirma la verificación de región y términos digitales.");
      return;
    }
    if (
      amountDueCents > 0 &&
      paymentGateway === "pagomovil" &&
      !pmAvailability?.available
    ) {
      toast.error(
        "Pago Móvil no está disponible en este momento. Selecciona ZenoBank."
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
          items: cartItems.map((c) => ({
            variantId: c.variantId,
            quantity: c.quantity,
          })),
          applyStoreCredit: usableCreditCents > 0,
          paymentGateway: amountDueCents === 0 ? "zenobank" : paymentGateway,
        }),
      });

      const body = (await res.json()) as {
        orderId?: string;
        orderNumber?: string;
        status?: string;
        checkoutUrl?: string;
        paidInFullByCredit?: boolean;
        error?: string;
        code?: string;
      };

      if (!res.ok || !body.orderId) {
        if (body.code === "AUTH_REQUIRED") {
          toast.error("Inicia sesión para completar la compra.");
          router.push("/login?redirect=/checkout");
          return;
        }
        toast.error(body.error ?? "No se pudo crear la orden.");
        return;
      }

      clearCart();
      await refreshSession();

      if (body.paidInFullByCredit) {
        setRedirecting({ mode: "vault", orderId: body.orderId });
        router.push(`/order/${body.orderId}`);
        return;
      }

      if (paymentGateway === "pagomovil") {
        setRedirecting({ mode: "pagomovil", orderId: body.orderId });
        router.push(`/pay/pagomovil/${body.orderId}`);
        return;
      }

      setRedirecting({ mode: "zenobank", orderId: body.orderId });
      if (body.checkoutUrl && body.checkoutUrl.startsWith("http")) {
        window.location.assign(body.checkoutUrl);
      } else if (body.checkoutUrl) {
        router.push(body.checkoutUrl);
      } else {
        router.push(`/order/${body.orderId}`);
      }
    } catch {
      toast.error("Error de red al procesar el checkout.");
    } finally {
      setSubmitting(false);
    }
  };

  if (redirecting) {
    return (
      <div className="min-h-[75vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl bg-[#0e1018] border border-white/[0.1] p-8 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center mx-auto">
            <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
          </div>
          <h1 className="text-lg font-extrabold text-white">
            {redirecting.mode === "pagomovil"
              ? "Abriendo ventana de Pago Móvil..."
              : redirecting.mode === "zenobank"
                ? "Conectando con ZenoBank..."
                : "Liberando códigos en tu bóveda..."}
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            Reserva de inventario confirmada. Redirigiendo a tu sesión de pago
            segura...
          </p>
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="rounded-3xl bg-[#0e1018] border border-white/[0.08] p-10 text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-slate-400">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-black text-white">
              Tu carrito está vacío
            </h1>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              Agrega una tarjeta de regalo desde el catálogo oficial o revisa tus
              órdenes abiertas si dejaste un pago pendiente.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-slate-950 font-extrabold text-xs hover:bg-sky-300 transition-colors"
            >
              <span>Explorar catálogo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            {sessionUser && (
              <Link
                href="/account"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/15 bg-white/[0.03] text-xs font-bold text-slate-200 hover:bg-white/[0.08] transition-colors"
              >
                <span>Ver mis órdenes</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Clean Stripe Top Bar */}
      <div className="flex items-center justify-between gap-4 mb-8">
        <Link
          href="/cart"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Volver al carrito</span>
        </Link>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] font-semibold text-slate-300">
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>StoryCheap Checkout</span>
        </div>
      </div>

      {/* Pending unpaid orders reminder banner (prevents duplicate confusion) */}
      {visiblePendingOrders.length > 0 && (
        <div className="mb-6 rounded-2xl bg-[#0f131f] border border-sky-500/25 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-400/25 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 text-sky-400" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-white">
                Tienes {visiblePendingOrders.length}{" "}
                {visiblePendingOrders.length === 1
                  ? `orden pendiente (#${visiblePendingOrders[0].orderNumber})`
                  : "órdenes pendientes de pago"}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                Puedes retomarla o cancelarla para liberar inventario y saldo antes
                de generar otra.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={
                visiblePendingOrders[0].paymentGateway === "pagomovil" ||
                visiblePendingOrders[0].paymentGateway === "pablito"
                  ? `/pay/pagomovil/${visiblePendingOrders[0].id}`
                  : `/order/${visiblePendingOrders[0].id}`
              }
              className="px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-[11px] font-bold text-sky-200 transition-colors"
            >
              Continuar orden
            </Link>
            <Link
              href={`/order/${visiblePendingOrders[0].id}`}
              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-semibold text-slate-300 transition-colors"
            >
              Gestionar / Cancelar
            </Link>
          </div>
        </div>
      )}

      {/* Two-Column Stripe Split Checkout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
        {/* Left Column: Merchant Order Summary (5 cols) */}
        <aside className="lg:col-span-5 space-y-6">
          <div className="rounded-2xl bg-[#0c0e16] border border-white/[0.08] p-6 space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <span className="w-5 h-5 rounded-md bg-white text-slate-950 font-black text-[10px] inline-flex items-center justify-center">
                  S
                </span>
                <span>Pagar a StoryCheap</span>
              </div>

              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-3xl sm:text-4xl font-black text-white tabular-nums tracking-tight">
                  {formatCents(amountDueCents)}
                </span>
                <span className="text-xs font-bold text-slate-400 uppercase">
                  USD
                </span>
              </div>

              {amountDueCents > 0 &&
                paymentGateway === "pagomovil" &&
                estimatedBsCents > 0 && (
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-xs font-mono font-bold text-emerald-300 tabular-nums">
                    <span>≈ Bs. {formatBsNumber(estimatedBsCents)}</span>
                  </div>
                )}
            </div>

            {/* Line Items */}
            <div className="divide-y divide-white/[0.06] border-t border-white/[0.07]">
              {cartItems.map((item) => (
                <div
                  key={item.variantId}
                  className="py-3.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-12 rounded-lg bg-slate-950 border border-white/10 p-1 flex items-center justify-center shrink-0">
                      <img
                        src={item.imageUrl}
                        alt={item.productName}
                        className="max-h-full max-w-full object-contain rounded"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {item.productName}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <span>{item.denominationLabel}</span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-0.5">
                          <Globe className="w-2.5 h-2.5 text-sky-400" />
                          {item.region}
                        </span>
                        <span>•</span>
                        <span>Cant. {item.quantity}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-semibold text-white tabular-nums shrink-0">
                    {formatCents(item.unitPriceCents * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals Breakdown */}
            <div className="space-y-2.5 pt-3 border-t border-white/[0.07] text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {formatCents(cartSubtotalCents)} USD
                </span>
              </div>

              {usableCreditCents > 0 && (
                <div className="flex justify-between text-emerald-400 font-semibold">
                  <span>Saldo a favor aplicado</span>
                  <span className="font-mono tabular-nums">
                    -{formatCents(usableCreditCents)} USD
                  </span>
                </div>
              )}

              <div className="flex justify-between items-baseline pt-2.5 border-t border-white/[0.08]">
                <span className="font-bold text-white">Total hoy</span>
                <span className="text-base font-black font-mono text-white tabular-nums">
                  {formatCents(amountDueCents)} USD
                </span>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-2.5 px-2 text-[11px] text-slate-500 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Tus códigos se reservan al generar la orden y se liberan en tu bóveda
              apenas confirmamos el pago.
            </span>
          </div>
        </aside>

        {/* Right Column: Elevated Stripe Payment Form (7 cols) */}
        <main className="lg:col-span-7">
          {!isSessionLoading && !sessionUser ? (
            <div className="rounded-2xl bg-[#0e1018] border border-white/[0.1] p-6 sm:p-8 space-y-5 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.75)]">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center shrink-0">
                  <Lock className="w-5 h-5 text-sky-400" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-lg font-extrabold text-white">
                    Inicia sesión para completar tu compra
                  </h1>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Tus gift cards se guardan en la bóveda cifrada de tu cuenta
                    para que nunca pierdas acceso a tus PINes ni a tu saldo a
                    favor.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                <Link
                  href="/login?redirect=/checkout"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-sky-200 text-slate-950 font-black text-xs transition-colors"
                >
                  <span>Iniciar sesión o registrarme</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleCheckoutSubmit}
              className="rounded-2xl bg-[#0e1018] border border-white/[0.1] p-6 sm:p-8 space-y-6 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.75)]"
            >
              {/* Contact / Account Section */}
              <div className="space-y-2.5">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Cuenta de entrega
                </label>
                <div className="rounded-xl bg-[#090b10] border border-white/[0.08] px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-xs font-semibold text-white truncate">
                      {sessionUser?.email ?? "Cargando sesión..."}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-bold text-emerald-300 shrink-0">
                    <CheckCircle2 className="w-3 h-3" />
                    Verificada
                  </span>
                </div>
              </div>

              {/* Store Credit Toggle */}
              {sessionUser && creditBalanceCents > 0 && (
                <div className="rounded-xl bg-[#090d11] border border-emerald-500/20 px-4 py-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Wallet className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white">
                        Saldo a favor disponible:{" "}
                        <span className="text-emerald-300 font-mono tabular-nums">
                          {formatCents(creditBalanceCents)} USD
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {applyCredit
                          ? `Aplicando ${formatCents(usableCreditCents)} USD en esta orden`
                          : "Activa para descontar tu saldo en esta compra"}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={applyCredit}
                    onClick={() => setApplyCredit((v) => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      applyCredit ? "bg-emerald-500" : "bg-white/15"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        applyCredit ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              )}

              {/* Stripe Payment Method Selector or Instant Credit Coverage */}
              {amountDueCents > 0 ? (
                <StripePaymentMethodSelector
                  selectedGateway={paymentGateway}
                  onSelectGateway={setPaymentGateway}
                  amountDueCents={amountDueCents}
                  pagoMovilInfo={pmAvailability}
                  loadingPagoMovil={loadingPm}
                />
              ) : (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-4 flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-emerald-300 shrink-0" />
                  <div className="text-xs text-emerald-100 leading-relaxed">
                    <strong className="block text-white font-bold">
                      Total cubierto al 100% con tu saldo a favor
                    </strong>
                    Al confirmar se entregarán tus códigos de inmediato sin
                    pasarela adicional.
                  </div>
                </div>
              )}

              {/* Digital Policy Consent */}
              <label className="flex items-start gap-3 rounded-xl bg-white/[0.02] border border-white/[0.07] p-3.5 cursor-pointer hover:border-white/15 transition-colors">
                <input
                  type="checkbox"
                  checked={acceptedRegionPolicy}
                  onChange={(e) => setAcceptedRegionPolicy(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/25 bg-slate-950 text-sky-400 focus:ring-sky-400/40"
                />
                <span className="text-[11px] text-slate-300 leading-relaxed">
                  Confirmo que verifiqué la región de cada tarjeta digital y
                  acepto la entrega electrónica instantánea en mi bóveda StoryCheap.
                </span>
              </label>

              {/* Stripe Primary Submit CTA */}
              <button
                type="submit"
                disabled={
                  submitting ||
                  !acceptedRegionPolicy ||
                  (amountDueCents > 0 &&
                    paymentGateway === "pagomovil" &&
                    !pmAvailability?.available)
                }
                className={`w-full py-3.5 px-5 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all shadow-lg disabled:opacity-45 disabled:cursor-not-allowed ${
                  amountDueCents === 0 || paymentGateway === "pagomovil"
                    ? "bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-emerald-500/15"
                    : "bg-white hover:bg-sky-200 text-slate-950 shadow-sky-500/10"
                }`}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Creando orden segura...</span>
                  </>
                ) : amountDueCents === 0 ? (
                  <>
                    <span>Confirmar compra con saldo</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : paymentGateway === "pagomovil" ? (
                  <>
                    <span>
                      Pagar con Pago Móvil{" "}
                      {estimatedBsCents > 0
                        ? `• Bs. ${formatBsNumber(estimatedBsCents)}`
                        : ""}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    <span>
                      Pagar {formatCents(amountDueCents)} USD con ZenoBank
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <StripeSecurityFooter />
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
