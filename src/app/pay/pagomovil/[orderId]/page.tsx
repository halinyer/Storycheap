/* eslint-disable @next/next/no-img-element */
"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  Lock,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { CancelOrderControl } from "@/components/payments/cancel-order-control";
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
        message: `Referencia ${body.reportedReference} registrada. Esperando confirmación automática del banco...`,
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

  useEffect(() => {
    if (!data) return;
    if (isConfirmed) {
      const timer = setTimeout(() => {
        router.push(`/order/${orderId}`);
      }, 1400);
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
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-24 text-center space-y-3">
        <Loader2 className="w-6 h-6 animate-spin text-sky-400 mx-auto" />
        <p className="text-xs text-slate-400">Cargando Pago Móvil...</p>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="rounded-2xl bg-white text-[#0a2540] p-8 text-center space-y-4 shadow-2xl">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
          <h1 className="text-lg font-bold">No pudimos abrir esta orden</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            {loadError ?? "Verifica que iniciaste sesión con la cuenta correcta."}
          </p>
          <div className="flex justify-center gap-3 pt-1">
            <Link
              href={`/order/${orderId}`}
              className="px-4 py-2 rounded-lg bg-[#0a2540] text-white font-semibold text-xs"
            >
              Ver detalle de orden
            </Link>
            <Link
              href="/account"
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 font-semibold text-xs"
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
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-4">
      {/* Minimal Top Bar above Sheet */}
      <div className="flex items-center justify-between gap-4 px-1">
        <Link
          href={`/order/${orderId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Volver a orden #{data.orderNumber}</span>
        </Link>

        {!isConfirmed && !isCancelled && !isOrderExpired && (
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-400 font-mono tabular-nums">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Expira en {formatCountdown(data.expiresAt, nowMs)}</span>
          </div>
        )}
      </div>

      {/* Authentic Stripe Checkout Floating Sheet */}
      <div className="rounded-2xl overflow-hidden bg-white text-[#0a2540] shadow-[0_28px_80px_-20px_rgba(0,0,0,0.65)] ring-1 ring-white/10 grid grid-cols-1 lg:grid-cols-12">
        {/* Left: Soft Slate Order Summary Column */}
        <aside className="lg:col-span-5 bg-[#f7f9fc] p-6 sm:p-8 border-b lg:border-b-0 lg:border-r border-slate-200/80 flex flex-col justify-between gap-8">
          <div className="space-y-6">
            {/* Merchant Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-md bg-[#0a2540] text-white font-black text-xs inline-flex items-center justify-center shadow-xs">
                  S
                </span>
                <span className="text-sm font-bold text-[#0a2540]">
                  StoryCheap
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-slate-200/75 text-[10px] font-semibold text-slate-700">
                Pago Móvil
              </span>
            </div>

            {/* Hero Amount */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500">
                Total a transferir
              </div>
              <div className="text-3xl sm:text-4xl font-bold tracking-tight text-[#0a2540] font-mono tabular-nums">
                Bs. {formatBsNumber(data.amountDueBsCents)}
              </div>
              <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5 pt-0.5 tabular-nums">
                <span className="font-medium text-slate-700">
                  {formatCents(data.amountDueCents)} USD
                </span>
                {data.bsRateCents && (
                  <>
                    <span>·</span>
                    <span>Tasa Bs. {formatBsNumber(data.bsRateCents)}</span>
                  </>
                )}
              </div>

              {!isConfirmed &&
                !isCancelled &&
                !isOrderExpired &&
                isRateExpired && (
                  <div className="pt-2">
                    <button
                      type="button"
                      disabled={refreshingRate}
                      onClick={() => void handleRefreshRate()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold text-[11px] transition-colors"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${
                          refreshingRate ? "animate-spin" : ""
                        }`}
                      />
                      <span>Tasa vencida · Actualizar</span>
                    </button>
                  </div>
                )}
            </div>

            {/* Clean Itemized Summary */}
            {orderDetails && orderDetails.items.length > 0 && (
              <div className="space-y-3 pt-5 border-t border-slate-200/80">
                {orderDetails.items.map((item) => {
                  const theme = resolveBrandTheme(
                    item.productName,
                    item.productSlug
                  );
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-9 rounded-md bg-white border border-slate-200 p-1 flex items-center justify-center shrink-0">
                          <img
                            src={theme.imageUrl}
                            alt={item.productName}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-[#0a2540] truncate">
                            {item.productName}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {item.denominationLabel} · Cant. {item.quantity}
                          </div>
                        </div>
                      </div>
                      <span className="font-medium text-[#0a2540] tabular-nums shrink-0">
                        {formatCents(item.unitPriceCents * item.quantity)}
                      </span>
                    </div>
                  );
                })}

                {orderDetails.creditAppliedCents > 0 && (
                  <div className="flex justify-between text-xs text-emerald-700 font-medium pt-2 border-t border-slate-200/70">
                    <span>Saldo a favor</span>
                    <span className="tabular-nums">
                      -{formatCents(orderDetails.creditAppliedCents)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cancel Order Inline Control */}
          {!isConfirmed && !isCancelled && !isOrderExpired && (
            <CancelOrderControl
              order={cancelableOrderSnapshot}
              tone="light"
              variant="hosted-footer"
              onCancelled={({ order }) => {
                setOrderDetails(order);
                setData((prev) =>
                  prev ? { ...prev, status: "CANCELLED" } : prev
                );
              }}
            />
          )}
        </aside>

        {/* Right: Crisp Pure White Payment Sheet */}
        <main className="lg:col-span-7 bg-white p-6 sm:p-8 flex flex-col justify-center">
          {isCancelled ? (
            <div className="py-6 space-y-5">
              <div className="flex items-start gap-3">
                <XCircle className="w-6 h-6 text-slate-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h1 className="text-lg font-bold text-[#0a2540]">
                    Orden #{data.orderNumber} cancelada
                  </h1>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Liberamos las gift cards reservadas y reembolsamos cualquier
                    saldo a favor aplicado. No se realizó ningún cargo.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Link
                  href="/checkout"
                  className="px-4 py-2.5 rounded-lg bg-[#0a2540] hover:bg-[#163859] text-white font-semibold text-xs transition-colors"
                >
                  Ir al checkout
                </Link>
                <Link
                  href={`/order/${orderId}`}
                  className="px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-colors"
                >
                  Ver resumen de orden
                </Link>
              </div>
            </div>
          ) : isConfirmed ? (
            <div className="py-6 space-y-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h1 className="text-lg font-bold text-[#0a2540]">
                    Pago Móvil confirmado
                  </h1>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Confirmamos tu transferencia. Llevándote a tu bóveda para
                    revelar tus códigos...
                  </p>
                </div>
              </div>
              <Link
                href={`/order/${orderId}`}
                className="inline-flex items-center justify-center px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors"
              >
                Ver mis códigos ahora
              </Link>
            </div>
          ) : isOrderExpired ? (
            <div className="py-6 space-y-5">
              <div className="flex items-start gap-3">
                <Clock className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h1 className="text-lg font-bold text-[#0a2540]">
                    Esta orden expiró
                  </h1>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    El tiempo límite cerró y el inventario reservado fue liberado.
                    Genera una nueva orden desde el catálogo.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Link
                  href="/"
                  className="px-4 py-2.5 rounded-lg bg-[#0a2540] text-white font-semibold text-xs"
                >
                  Volver al catálogo
                </Link>
                <Link
                  href={`/order/${orderId}`}
                  className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-700 font-semibold text-xs"
                >
                  Ver orden
                </Link>
              </div>
            </div>
          ) : !data.receiver ? (
            <div className="py-8 text-center space-y-2 text-xs text-slate-600">
              <AlertTriangle className="w-7 h-7 text-amber-500 mx-auto" />
              <p>No hay cuenta bancaria receptora configurada.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Component 1: Unified Stripe Bank Details Box */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h1 className="text-sm font-bold text-[#0a2540]">
                    Datos para Pago Móvil
                  </h1>
                  <button
                    type="button"
                    onClick={handleCopyAll}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#635bff] hover:text-[#4b43e6] transition-colors"
                  >
                    {copiedKey === "all" ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700">Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar todo</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/75 divide-y divide-slate-200/80 overflow-hidden">
                  {[
                    {
                      key: "amount",
                      label: "Monto exacto",
                      display: `Bs. ${exactCopyBs}`,
                      sub: null as string | null,
                      copyVal: exactCopyBs,
                    },
                    {
                      key: "bank",
                      label: "Banco",
                      display: `${data.receiver.bankCode} · ${data.receiver.bankName}`,
                      sub: `${
                        data.receiver.accountType === "natural"
                          ? "Cuenta Natural"
                          : "Cuenta Jurídica"
                      } · ${data.receiver.holderName}`,
                      copyVal: data.receiver.bankCode,
                    },
                    {
                      key: "phone",
                      label: "Teléfono",
                      display: data.receiver.phone,
                      sub: null,
                      copyVal: data.receiver.phone,
                    },
                    {
                      key: "dni",
                      label: "Cédula / RIF",
                      display: data.receiver.dni,
                      sub: null,
                      copyVal: data.receiver.dni.replace(/[^0-9]/g, ""),
                    },
                  ].map((row) => (
                    <div
                      key={row.key}
                      className="px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-slate-500">
                          {row.label}
                        </div>
                        <div className="text-sm font-semibold text-[#0a2540] font-mono tabular-nums truncate">
                          {row.display}
                        </div>
                        {row.sub && (
                          <div className="text-[11px] text-slate-500 truncate">
                            {row.sub}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          void copyField(row.key, row.copyVal, row.label)
                        }
                        aria-label={`Copiar ${row.label}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-700 shadow-2xs transition-colors shrink-0"
                      >
                        {copiedKey === row.key ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700">Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-400" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Component 2: Stripe Connected Payment Element Form */}
              <form onSubmit={handleVerifySubmit} className="space-y-4">
                <div className="space-y-2">
                  <h2 className="text-sm font-bold text-[#0a2540]">
                    Confirma tu transferencia
                  </h2>

                  {/* Unified Hairline Connected Input Group */}
                  <div className="rounded-xl border border-slate-300 bg-white overflow-hidden shadow-xs divide-y divide-slate-200 focus-within:border-[#635bff] focus-within:ring-2 focus-within:ring-[#635bff]/20 transition-all">
                    <div className="px-3.5 py-2.5">
                      <label
                        htmlFor="pm-reference"
                        className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5"
                      >
                        Número de referencia (últimos{" "}
                        {data.settings.minReferenceDigits}+ dígitos)
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
                        className="w-full bg-transparent text-sm font-mono font-semibold text-[#0a2540] placeholder-slate-400 focus:outline-none tabular-nums"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                      <div className="px-3.5 py-2.5">
                        <label
                          htmlFor="pm-bank"
                          className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5"
                        >
                          Banco de origen
                        </label>
                        <select
                          id="pm-bank"
                          value={senderBankCode}
                          onChange={(e) => setSenderBankCode(e.target.value)}
                          className="w-full bg-transparent text-xs font-medium text-[#0a2540] focus:outline-none"
                        >
                          <option value="">Cualquier banco</option>
                          {VENEZUELAN_BANKS.map((b) => (
                            <option key={b.code} value={b.code}>
                              {b.code} · {b.shortName}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="px-3.5 py-2.5">
                        <label
                          htmlFor="pm-phone"
                          className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5"
                        >
                          Teléfono emisor{" "}
                          {data.settings.requireSenderPhone
                            ? "*"
                            : "(opcional)"}
                        </label>
                        <input
                          id="pm-phone"
                          type="tel"
                          required={data.settings.requireSenderPhone}
                          value={senderPhone}
                          onChange={(e) => setSenderPhone(e.target.value)}
                          placeholder="04121234567"
                          className="w-full bg-transparent text-xs font-mono font-medium text-[#0a2540] placeholder-slate-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Inline Stripe Feedback */}
                {verifyFeedback && (
                  <div
                    className={`rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed flex items-start gap-2.5 ${
                      verifyFeedback.type === "waiting"
                        ? "bg-sky-50 border-sky-200 text-sky-900"
                        : verifyFeedback.type === "warning"
                          ? "bg-amber-50 border-amber-200 text-amber-900"
                          : "bg-rose-50 border-rose-200 text-rose-900"
                    }`}
                  >
                    {verifyFeedback.type === "waiting" ? (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-sky-600 animate-pulse shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <span>{verifyFeedback.message}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || isRateExpired}
                  className="w-full py-3.5 px-5 rounded-xl bg-[#0a2540] hover:bg-[#163859] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verificando pago...</span>
                    </>
                  ) : (
                    <span>
                      {data.waitingBankConfirmation
                        ? `Actualizar referencia · Bs. ${formatBsNumber(data.amountDueBsCents)}`
                        : `Confirmar Pago Móvil · Bs. ${formatBsNumber(data.amountDueBsCents)}`}
                    </span>
                  )}
                </button>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="w-3 h-3 text-slate-400" />
                    <span>Verificación automática segura</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        data.watchdog.online ? "bg-emerald-500" : "bg-amber-400"
                      }`}
                    />
                    <span>
                      {data.watchdog.online
                        ? "Sensor bancario en línea"
                        : "Confirmación pendiente"}
                    </span>
                  </span>
                </div>
              </form>
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-24 text-center text-xs text-slate-400">
          Cargando Pago Móvil...
        </div>
      }
    >
      <PagoMovilHostedCheckoutContent />
    </Suspense>
  );
}
