/* eslint-disable @next/next/no-img-element */
"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  Radio,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { CancelOrderControl } from "@/components/payments/cancel-order-control";
import {
  PagoMovilBrandMark,
  StripeSecurityFooter,
} from "@/components/payments/payment-brand-marks";
import {
  formatBsNumber,
  formatCountdown,
} from "@/components/payments/payment-helpers";
import { resolveBrandTheme } from "@/lib/brand-theme";
import { VENEZUELAN_BANKS } from "@/lib/catalog-banks";
import { formatCents } from "@/lib/catalog-seed";
import type { OrderDTO } from "@/types";

interface PagoMovilStatusPayload {
  orderId: string;
  orderNumber: string;
  status: string;
  amountDueCents: number;
  bsRateCents: number | null;
  amountDueBsCents: number;
  rateExpiresAt: string | null;
  rateExpired: boolean;
  expiresAt: string | null;
  orderExpired: boolean;
  reportedReference: string | null;
  reportedSenderBank: string | null;
  reportedSenderPhone: string | null;
  reportedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  waitingBankConfirmation: boolean;
  matchedReference: string | null;
  paidBsCents: number | null;
  receiver: {
    bankCode: string;
    bankName: string;
    accountType: "natural" | "juridical";
    phone: string;
    dni: string;
    holderName: string;
  } | null;
  settings: {
    minReferenceDigits: number;
    requireSenderPhone: boolean;
    rateExpirationMinutes: number;
    orderExpirationMinutes: number;
  };
  watchdog: {
    online: boolean;
    activeDevices: number;
    lastHeartbeatAt: string | null;
  };
}

function PagoMovilHostedCheckoutContent() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params?.orderId ?? "";

  const [data, setData] = useState<PagoMovilStatusPayload | null>(null);
  const [orderDetails, setOrderDetails] = useState<OrderDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [referenceDigits, setReferenceDigits] = useState("");
  const [senderBankCode, setSenderBankCode] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshingRate, setRefreshingRate] = useState(false);
  const [verifyFeedback, setVerifyFeedback] = useState<{
    type: "error" | "warning" | "waiting";
    code?: string;
    message: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const applyStatusPayload = useCallback((body: PagoMovilStatusPayload) => {
    setData(body);
    setLoadError(null);

    setReferenceDigits((prev) =>
      prev ? prev : body.reportedReference ?? ""
    );
    setSenderBankCode((prev) =>
      prev ? prev : body.reportedSenderBank ?? ""
    );
    setSenderPhone((prev) =>
      prev ? prev : body.reportedSenderPhone ?? ""
    );

    if (body.lastErrorCode && body.lastErrorMessage) {
      setVerifyFeedback({
        type: body.lastErrorCode === "AMBIGUOUS_REFERENCE" ? "warning" : "error",
        code: body.lastErrorCode,
        message: body.lastErrorMessage,
      });
    } else if (body.waitingBankConfirmation && body.reportedReference) {
      setVerifyFeedback({
        type: "waiting",
        message: `Referencia ${body.reportedReference} registrada. Verificando recepción bancaria...`,
      });
    } else {
      setVerifyFeedback(null);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await fetch(
        `/api/payments/pagomovil/status?orderId=${encodeURIComponent(orderId)}`,
        { cache: "no-store" }
      );
      const body = (await res.json()) as PagoMovilStatusPayload & {
        error?: string;
      };
      if (!res.ok) {
        setLoadError(body.error ?? "No se pudo cargar la ventana de Pago Móvil.");
        return;
      }
      applyStatusPayload(body);
    } catch {
      setLoadError("Error de conexión al consultar la orden.");
    } finally {
      setLoading(false);
    }
  }, [orderId, applyStatusPayload]);

  useEffect(() => {
    if (!orderId) return;
    let active = true;

    Promise.all([
      fetch(
        `/api/payments/pagomovil/status?orderId=${encodeURIComponent(orderId)}`,
        { cache: "no-store" }
      ).then(async (res) => ({
        ok: res.ok,
        body: (await res.json()) as PagoMovilStatusPayload & { error?: string },
      })),
      fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        cache: "no-store",
      })
        .then(async (res) =>
          res.ok ? ((await res.json()) as { order?: OrderDTO }) : null
        )
        .catch(() => null),
    ])
      .then(([statusRes, orderRes]) => {
        if (!active) return;
        if (!statusRes.ok) {
          setLoadError(
            statusRes.body.error ??
              "No se pudo cargar la ventana de Pago Móvil."
          );
          return;
        }
        applyStatusPayload(statusRes.body);
        if (orderRes?.order) {
          setOrderDetails(orderRes.order);
        }
      })
      .catch(() => {
        if (active) setLoadError("Error de conexión al consultar la orden.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [orderId, applyStatusPayload]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const isConfirmed = Boolean(
    data &&
      (data.status === "PAID" ||
        data.status === "FULFILLING" ||
        data.status === "DELIVERED")
  );
  const isCancelled = data?.status === "CANCELLED";

  // Live polling ONLY while order is open & unpaid
  useEffect(() => {
    if (!data) return;
    if (isConfirmed) {
      const timer = setTimeout(() => {
        router.push(`/order/${orderId}`);
      }, 1500);
      return () => clearTimeout(timer);
    }

    if (data.status === "PENDING_PAYMENT" || data.status === "CREATED") {
      const poller = setInterval(() => {
        void loadStatus();
      }, 2500);
      return () => clearInterval(poller);
    }
  }, [data, isConfirmed, orderId, router, loadStatus]);

  const isRateExpired = Boolean(
    data &&
      (data.rateExpired ||
        (data.rateExpiresAt && nowMs >= Date.parse(data.rateExpiresAt)))
  );
  const isOrderExpired = Boolean(
    data &&
      (data.status === "EXPIRED" ||
        data.orderExpired ||
        (data.expiresAt && nowMs >= Date.parse(data.expiresAt)))
  );

  const copyField = async (key: string, value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.success(`${label} copiado`);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1800);
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  const handleCopyAll = () => {
    if (!data?.receiver) return;
    const exactBs = (data.amountDueBsCents / 100).toFixed(2);
    const lines = [
      `Banco: ${data.receiver.bankCode} - ${data.receiver.bankName}`,
      `Teléfono: ${data.receiver.phone}`,
      `Cédula/RIF: ${data.receiver.dni}`,
      `Monto exacto Bs: ${exactBs}`,
    ].join("\n");
    void copyField("all", lines, "Datos completos");
  };

  const handleRefreshRate = async () => {
    setRefreshingRate(true);
    try {
      const res = await fetch("/api/payments/pagomovil/refresh-rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "No se pudo actualizar la tasa Bs.");
        return;
      }
      await loadStatus();
      toast.success("Tasa Bs actualizada.");
    } catch {
      toast.error("Error de red al actualizar la tasa.");
    } finally {
      setRefreshingRate(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;

    const cleanDigits = referenceDigits.trim();
    if (cleanDigits.length < data.settings.minReferenceDigits) {
      toast.error(
        `Ingresa al menos ${data.settings.minReferenceDigits} dígitos de la referencia.`
      );
      return;
    }

    setSubmitting(true);
    setVerifyFeedback(null);
    try {
      const res = await fetch("/api/payments/pagomovil/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          referenceDigits: cleanDigits,
          senderBankCode: senderBankCode || null,
          senderPhone: senderPhone.trim() || null,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        code?: string;
        message?: string;
        error?: string;
      };

      const msg =
        body.message ?? body.error ?? "No se pudo verificar el pago.";

      if (body.code === "COMPLETED" || body.code === "ALREADY_PAID") {
        toast.success(msg);
        await loadStatus();
        return;
      }

      if (body.code === "WAITING_BANK_CONFIRMATION") {
        setVerifyFeedback({ type: "waiting", code: body.code, message: msg });
        toast.success("Referencia registrada.");
        await loadStatus();
        return;
      }

      setVerifyFeedback({
        type: body.code === "AMBIGUOUS_REFERENCE" ? "warning" : "error",
        code: body.code,
        message: msg,
      });
      toast.error(msg);
      await loadStatus();
    } catch {
      toast.error("Error de red al enviar referencia bancaria.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-24 text-center space-y-3">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400 mx-auto" />
        <p className="text-xs text-slate-400">
          Cargando sesión segura de Pago Móvil...
        </p>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="rounded-2xl bg-[#0e1018] border border-white/[0.1] p-8 text-center space-y-4">
          <AlertTriangle className="w-9 h-9 text-amber-400 mx-auto" />
          <h1 className="text-lg font-extrabold text-white">
            No pudimos abrir esta orden
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            {loadError ?? "Verifica que iniciaste sesión con la cuenta correcta."}
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <Link
              href={`/order/${orderId}`}
              className="px-4 py-2 rounded-xl bg-white text-slate-950 font-bold text-xs"
            >
              Ver detalle de orden
            </Link>
            <Link
              href="/account"
              className="px-4 py-2 rounded-xl border border-white/15 text-slate-200 font-semibold text-xs"
            >
              Mis órdenes
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const exactCopyBs = (data.amountDueBsCents / 100).toFixed(2);
  const cancelableOrderSnapshot: Pick<
    OrderDTO,
    | "id"
    | "orderNumber"
    | "status"
    | "amountDueCents"
    | "creditAppliedCents"
    | "paidCents"
    | "paymentGateway"
    | "items"
  > = orderDetails ?? {
    id: data.orderId,
    orderNumber: data.orderNumber,
    status: data.status as OrderDTO["status"],
    amountDueCents: data.amountDueCents,
    creditAppliedCents: 0,
    paidCents: 0,
    paymentGateway: "pagomovil",
    items: [],
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
      {/* Top Stripe Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/order/${orderId}`}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Volver a mi orden</span>
        </Link>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-500">
            #{data.orderNumber}
          </span>
          {data.watchdog.online && !isCancelled && !isConfirmed && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-bold text-emerald-300">
              <Radio className="w-3 h-3" />
              <span>Verificación bancaria activa</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Split Stripe Checkout Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
        {/* Left Column: Merchant Order Summary (5 cols) */}
        <aside className="lg:col-span-5 space-y-5">
          <div className="rounded-2xl bg-[#0c0e16] border border-white/[0.08] p-6 space-y-5">
            {/* Merchant Identity + Hero Bs Amount */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <PagoMovilBrandMark className="w-6 h-6" />
                  <span>StoryCheap • Pago Móvil</span>
                </div>
                {!isConfirmed && !isCancelled && !isOrderExpired && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-slate-400 tabular-nums">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {formatCountdown(data.expiresAt, nowMs)}
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-3xl sm:text-4xl font-black text-white font-mono tabular-nums tracking-tight">
                  Bs. {formatBsNumber(data.amountDueBsCents)}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="font-mono font-semibold text-slate-300 tabular-nums">
                    {formatCents(data.amountDueCents)} USD
                  </span>
                  {data.bsRateCents && (
                    <>
                      <span className="text-slate-600">•</span>
                      <span className="tabular-nums">
                        Tasa congelada: Bs. {formatBsNumber(data.bsRateCents)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Rate Validity Strip */}
              {!isConfirmed && !isCancelled && !isOrderExpired && data.rateExpiresAt && (
                <div
                  className={`rounded-xl px-3 py-2 border flex items-center justify-between text-[11px] ${
                    isRateExpired
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
                      : "bg-white/[0.02] border-white/[0.06] text-slate-400"
                  }`}
                >
                  <span>
                    {isRateExpired
                      ? "Tasa expirada"
                      : "Vigencia de esta tasa Bs"}
                  </span>
                  <span className="font-mono font-bold tabular-nums text-white">
                    {isRateExpired
                      ? "00:00"
                      : formatCountdown(data.rateExpiresAt, nowMs)}
                  </span>
                </div>
              )}
            </div>

            {/* Order Line Items (when loaded) */}
            {orderDetails && orderDetails.items.length > 0 && (
              <div className="divide-y divide-white/[0.06] border-t border-white/[0.07]">
                {orderDetails.items.map((item) => {
                  const theme = resolveBrandTheme(
                    item.productName,
                    item.productSlug
                  );
                  return (
                    <div
                      key={item.id}
                      className="py-3 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-10 rounded-lg bg-slate-950 border border-white/10 p-1 flex items-center justify-center shrink-0">
                          <img
                            src={theme.imageUrl}
                            alt={item.productName}
                            className="max-h-full max-w-full object-contain rounded"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">
                            {item.productName}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {item.denominationLabel} × {item.quantity}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-mono font-semibold text-slate-200 tabular-nums shrink-0">
                        {formatCents(item.unitPriceCents * item.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Totals Breakdown */}
            {orderDetails && (
              <div className="space-y-2 pt-3 border-t border-white/[0.07] text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal USD</span>
                  <span className="font-mono text-slate-200 tabular-nums">
                    {formatCents(orderDetails.subtotalCents)} USD
                  </span>
                </div>
                {orderDetails.creditAppliedCents > 0 && (
                  <div className="flex justify-between text-emerald-400 font-semibold">
                    <span>Saldo a favor</span>
                    <span className="font-mono tabular-nums">
                      -{formatCents(orderDetails.creditAppliedCents)} USD
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Inline Cancel / Switch Method Footer */}
            {!isConfirmed && !isCancelled && !isOrderExpired && (
              <CancelOrderControl
                order={cancelableOrderSnapshot}
                variant="hosted-footer"
                onCancelled={({ order }) => {
                  setOrderDetails(order);
                  setData((prev) =>
                    prev ? { ...prev, status: "CANCELLED" } : prev
                  );
                }}
              />
            )}
          </div>
        </aside>

        {/* Right Column: Stripe Hosted Interactive Payment Card (7 cols) */}
        <main className="lg:col-span-7">
          {isCancelled ? (
            <div className="rounded-2xl bg-[#0e1018] border border-white/[0.1] p-7 sm:p-9 space-y-5 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.75)]">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/15 flex items-center justify-center shrink-0">
                  <XCircle className="w-5 h-5 text-slate-300" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-lg font-extrabold text-white">
                    Orden #{data.orderNumber} cancelada
                  </h1>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Liberamos tus tarjetas reservadas y reembolsamos cualquier saldo
                    a favor aplicado. No se realizó ningún cargo.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  href="/checkout"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-sky-200 text-slate-950 font-black text-xs transition-colors"
                >
                  <span>Ir al checkout</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <Link
                  href={`/order/${orderId}`}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/15 bg-white/[0.03] hover:bg-white/[0.08] text-xs font-bold text-slate-200 transition-colors"
                >
                  <span>Ver resumen de orden</span>
                </Link>
              </div>
            </div>
          ) : isConfirmed ? (
            <div className="rounded-2xl bg-[#0d1714] border border-emerald-500/35 p-7 sm:p-9 space-y-5 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.75)]">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-lg font-extrabold text-white">
                    Pago Móvil verificado
                  </h1>
                  <p className="text-xs text-emerald-100/85 leading-relaxed">
                    Confirmamos tu transferencia. Te estamos llevando a tu bóveda
                    para revelar tus códigos...
                  </p>
                </div>
              </div>

              <Link
                href={`/order/${orderId}`}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs transition-colors"
              >
                <span>Ver mis códigos ahora</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : isOrderExpired ? (
            <div className="rounded-2xl bg-[#0e1018] border border-amber-500/30 p-7 sm:p-9 space-y-5 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.75)]">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5 text-amber-300" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-lg font-extrabold text-white">
                    Esta sesión de pago expiró
                  </h1>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    El tiempo límite para completar el Pago Móvil terminó y las
                    tarjetas reservadas fueron liberadas automáticamente.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-slate-950 font-black text-xs"
                >
                  <span>Volver al catálogo</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <Link
                  href={`/order/${orderId}`}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/15 text-xs font-bold text-slate-200"
                >
                  <span>Ver detalle de orden</span>
                </Link>
              </div>
            </div>
          ) : !data.receiver ? (
            <div className="rounded-2xl bg-[#0e1018] border border-white/[0.1] p-7 text-center space-y-3">
              <AlertTriangle className="w-7 h-7 text-amber-400 mx-auto" />
              <p className="text-xs text-slate-300">
                No hay cuenta bancaria receptora activa en este momento.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-[#0e1018] border border-white/[0.1] p-6 sm:p-8 space-y-7 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.75)]">
              {/* Step 1: Bank Details Table */}
              <section className="space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-white text-slate-950 font-black text-[11px] inline-flex items-center justify-center">
                      1
                    </span>
                    <h2 className="text-sm font-extrabold text-white">
                      Transfiere el monto exacto vía Pago Móvil
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyAll}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-[11px] font-semibold text-slate-200 transition-colors"
                  >
                    {copiedKey === "all" ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-slate-400" />
                    )}
                    <span>{copiedKey === "all" ? "Copiado" : "Copiar todo"}</span>
                  </button>
                </div>

                {/* Expired Rate Inline Strip */}
                {isRateExpired && (
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-amber-100">
                      La tasa congelada venció. Actualízala antes de transferir.
                    </div>
                    <button
                      type="button"
                      disabled={refreshingRate}
                      onClick={() => void handleRefreshRate()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs shrink-0"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          refreshingRate ? "animate-spin" : ""
                        }`}
                      />
                      <span>Actualizar tasa</span>
                    </button>
                  </div>
                )}

                {/* Highlighted Exact Bs Amount Row */}
                <div className="rounded-xl bg-[#090d11] border border-emerald-500/25 p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold text-emerald-300/90">
                      Monto exacto a enviar (Bs)
                    </div>
                    <div className="text-xl font-black text-white font-mono tabular-nums mt-0.5">
                      Bs. {formatBsNumber(data.amountDueBsCents)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void copyField("amount", exactCopyBs, "Monto en Bs")
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs transition-colors shrink-0"
                  >
                    {copiedKey === "amount" ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span className="font-mono tabular-nums">{exactCopyBs}</span>
                  </button>
                </div>

                {/* Stripe Structured Table for Receiver Info */}
                <div className="rounded-xl bg-[#090b10] border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
                  {[
                    {
                      key: "bank",
                      label: "Banco destino",
                      displayVal: `${data.receiver.bankCode} • ${data.receiver.bankName}`,
                      copyVal: data.receiver.bankCode,
                      tag:
                        data.receiver.accountType === "natural"
                          ? "Cuenta Natural"
                          : "Cuenta Jurídica",
                    },
                    {
                      key: "phone",
                      label: "Teléfono",
                      displayVal: data.receiver.phone,
                      copyVal: data.receiver.phone,
                    },
                    {
                      key: "dni",
                      label: "Cédula / RIF",
                      displayVal: data.receiver.dni,
                      copyVal: data.receiver.dni.replace(/[^0-9]/g, ""),
                    },
                    {
                      key: "holder",
                      label: "Titular",
                      displayVal: data.receiver.holderName,
                      copyVal: data.receiver.holderName,
                    },
                  ].map((row) => (
                    <div
                      key={row.key}
                      className="px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          {row.label}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <span className="text-xs sm:text-sm font-bold text-white font-mono">
                            {row.displayVal}
                          </span>
                          {row.tag && (
                            <span className="px-2 py-0.5 rounded bg-white/[0.05] text-[10px] font-medium text-slate-300">
                              {row.tag}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          void copyField(row.key, row.copyVal, row.label)
                        }
                        aria-label={`Copiar ${row.label}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] text-[11px] font-semibold text-slate-300 hover:text-white transition-colors shrink-0"
                      >
                        {copiedKey === row.key ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-300">Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Step 2: Verification Form */}
              <section className="space-y-4 pt-5 border-t border-white/[0.07]">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-white text-slate-950 font-black text-[11px] inline-flex items-center justify-center">
                    2
                  </span>
                  <h2 className="text-sm font-extrabold text-white">
                    Ingresa tu número de referencia
                  </h2>
                </div>

                <form onSubmit={handleVerifySubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="pm-reference"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Últimos {data.settings.minReferenceDigits}+ dígitos de
                      referencia bancaria
                    </label>
                    <input
                      id="pm-reference"
                      type="text"
                      inputMode="numeric"
                      required
                      minLength={data.settings.minReferenceDigits}
                      maxLength={32}
                      value={referenceDigits}
                      onChange={(e) =>
                        setReferenceDigits(
                          e.target.value.replace(/[^0-9A-Za-z]/g, "")
                        )
                      }
                      placeholder="Ej. 123456"
                      className="w-full rounded-xl bg-[#090b10] border border-white/[0.12] px-4 py-3 text-sm font-mono font-bold text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/35 focus:border-emerald-400/60 transition-all tabular-nums"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="pm-bank"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Banco emisor (opcional)
                      </label>
                      <select
                        id="pm-bank"
                        value={senderBankCode}
                        onChange={(e) => setSenderBankCode(e.target.value)}
                        className="w-full rounded-xl bg-[#090b10] border border-white/[0.12] px-3.5 py-2.5 text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/35 focus:border-emerald-400/60 transition-all"
                      >
                        <option value="">Cualquier banco</option>
                        {VENEZUELAN_BANKS.map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.code} — {b.shortName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="pm-phone"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Teléfono emisor{" "}
                        {data.settings.requireSenderPhone
                          ? "(requerido)"
                          : "(opcional)"}
                      </label>
                      <input
                        id="pm-phone"
                        type="tel"
                        required={data.settings.requireSenderPhone}
                        value={senderPhone}
                        onChange={(e) => setSenderPhone(e.target.value)}
                        placeholder="04121234567"
                        className="w-full rounded-xl bg-[#090b10] border border-white/[0.12] px-3.5 py-2.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/35 focus:border-emerald-400/60 transition-all"
                      />
                    </div>
                  </div>

                  {/* Verification Feedback Banner */}
                  {verifyFeedback && (
                    <div
                      className={`rounded-xl border px-4 py-3 text-xs leading-relaxed flex items-start gap-2.5 ${
                        verifyFeedback.type === "waiting"
                          ? "bg-sky-500/10 border-sky-500/25 text-sky-100"
                          : verifyFeedback.type === "warning"
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-100"
                            : "bg-rose-500/10 border-rose-500/30 text-rose-100"
                      }`}
                    >
                      {verifyFeedback.type === "waiting" ? (
                        <span className="mt-1.5 w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      )}
                      <span>{verifyFeedback.message}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || isRateExpired}
                    className="w-full py-3.5 px-5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/15 transition-all disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Validando referencia...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>
                          {data.waitingBankConfirmation
                            ? "Actualizar referencia bancaria"
                            : "Confirmar Pago Móvil"}
                        </span>
                      </>
                    )}
                  </button>
                </form>

                <StripeSecurityFooter label="Tu orden sigue guardada en Mis Órdenes si sales de esta pantalla" />
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function PagoMovilHostedCheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-24 text-center text-xs text-slate-400">
          Cargando ventana de Pago Móvil...
        </div>
      }
    >
      <PagoMovilHostedCheckoutContent />
    </Suspense>
  );
}
