"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { VENEZUELAN_BANKS } from "@/lib/catalog-banks";
import { formatCents } from "@/lib/catalog-seed";

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

function formatBsNumber(cents: number): string {
  return (cents / 100).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCountdown(targetIso: string | null, nowMs: number): string {
  if (!targetIso) return "--:--";
  const diffSec = Math.max(0, Math.floor((Date.parse(targetIso) - nowMs) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function PagoMovilHostedCheckoutContent() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params?.orderId ?? "";

  const [data, setData] = useState<PagoMovilStatusPayload | null>(null);
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

    // Prefill fields once if already reported
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
        message: `Referencia ${body.reportedReference} registrada. Esperando confirmación bancaria automática...`,
      });
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
    fetch(
      `/api/payments/pagomovil/status?orderId=${encodeURIComponent(orderId)}`,
      { cache: "no-store" }
    )
      .then(async (res) => {
        const body = (await res.json()) as PagoMovilStatusPayload & {
          error?: string;
        };
        if (!active) return;
        if (!res.ok) {
          setLoadError(body.error ?? "No se pudo cargar la ventana de Pago Móvil.");
          return;
        }
        applyStatusPayload(body);
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

  // Live 2s polling while payment confirmation or fulfillment is pending
  useEffect(() => {
    if (!data) return;
    if (isConfirmed) {
      const timer = setTimeout(() => {
        router.push(`/order/${orderId}`);
      }, 1400);
      return () => clearTimeout(timer);
    }

    if (
      data.status === "PENDING_PAYMENT" ||
      data.status === "CREATED"
    ) {
      const poller = setInterval(() => {
        void loadStatus();
      }, 2000);
      return () => clearInterval(poller);
    }
  }, [data, isConfirmed, orderId, router, loadStatus]);

  const rateExpiredLive = useMemo(() => {
    if (!data?.rateExpiresAt) return Boolean(data?.rateExpired);
    return Boolean(data.rateExpired || nowMs >= Date.parse(data.rateExpiresAt));
  }, [data, nowMs]);

  const orderExpiredLive = useMemo(() => {
    if (!data) return false;
    if (data.status === "EXPIRED" || data.orderExpired) return true;
    if (data.expiresAt && nowMs >= Date.parse(data.expiresAt)) return true;
    return false;
  }, [data, nowMs]);

  const copyField = async (key: string, value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.success(`${label} copiado`);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2200);
    } catch {
      toast.error("No se pudo copiar al portapapeles");
    }
  };

  const handleCopyAll = () => {
    if (!data?.receiver) return;
    const exactBs = (data.amountDueBsCents / 100).toFixed(2);
    const lines = [
      `Banco: ${data.receiver.bankCode} (${data.receiver.bankName})`,
      `Teléfono: ${data.receiver.phone}`,
      `Cédula/RIF: ${data.receiver.dni}`,
      `Monto exacto: Bs ${exactBs}`,
    ].join("\n");
    void copyField("all", lines, "Resumen bancario completo");
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
        throw new Error(body.error ?? "No se pudo actualizar la tasa.");
      }
      setVerifyFeedback(null);
      toast.success("Tasa Bs/USD actualizada y congelada nuevamente");
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error actualizando tasa");
    } finally {
      setRefreshingRate(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;

    const cleanRef = referenceDigits.replace(/[^a-zA-Z0-9]/g, "");
    if (cleanRef.length < data.settings.minReferenceDigits) {
      toast.error(
        `Ingresa al menos ${data.settings.minReferenceDigits} dígitos de tu referencia.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/payments/pagomovil/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          referenceDigits: cleanRef,
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

      const msg = body.message ?? body.error ?? "Verifica los datos ingresados.";
      if (body.code === "COMPLETED" || body.code === "ALREADY_PAID") {
        toast.success(msg);
        await loadStatus();
        return;
      }

      if (body.code === "WAITING_BANK_CONFIRMATION") {
        setVerifyFeedback({ type: "waiting", code: body.code, message: msg });
        toast.info("Referencia guardada. Esperando confirmación del banco...");
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
      toast.error("No se pudo conectar para verificar tu Pago Móvil.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
          <Loader2 className="w-7 h-7 animate-spin" />
        </div>
        <p className="text-sm font-bold text-white">
          Cargando ventana de Pago Móvil Venezuela...
        </p>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/15 border border-rose-400/30 flex items-center justify-center text-rose-400">
          <AlertTriangle className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-black text-white">No pudimos abrir el checkout</h1>
        <p className="text-xs text-slate-400">{loadError}</p>
        <div className="pt-2 flex justify-center gap-3">
          <Link
            href={`/login?next=${encodeURIComponent(`/pay/pagomovil/${orderId}`)}`}
            className="px-5 py-2.5 rounded-xl bg-white text-slate-950 font-black text-xs"
          >
            Iniciar sesión
          </Link>
          <Link
            href="/"
            className="px-5 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-white font-bold text-xs"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  if (isConfirmed) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <div className="rounded-3xl apple-glass p-8 sm:p-10 text-center space-y-5 border border-emerald-500/35">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-9 h-9" />
          </div>
          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 text-[11px] font-black uppercase">
              <Sparkles className="w-3.5 h-3.5" />
              Confirmado Automáticamente
            </span>
            <h1 className="text-2xl font-black text-white">
              ¡Pago Móvil Verificado!
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Orden #{data.orderNumber} confirmada
              {data.matchedReference ? ` · Ref: ${data.matchedReference}` : ""}. Te estamos llevando a tu bóveda de códigos...
            </p>
          </div>
          <Link
            href={`/order/${data.orderId}`}
            className="inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-sm transition-colors"
          >
            Ver mis códigos ahora
          </Link>
        </div>
      </div>
    );
  }

  const exactCopyBs = (data.amountDueBsCents / 100).toFixed(2);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/order/${data.orderId}`}
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver a mi orden #{data.orderNumber}</span>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border ${
              data.watchdog.online
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-amber-500/10 border-amber-500/30 text-amber-300"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                data.watchdog.online
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-amber-400"
              }`}
            />
            {data.watchdog.online
              ? "Verificador bancario en línea"
              : "Verificador bancario en pausa · Guarda tu comprobante"}
          </span>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/10 text-[11px] font-mono text-slate-200">
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            Orden: {formatCountdown(data.expiresAt, nowMs)}
          </span>
        </div>
      </div>

      {/* Header Banner */}
      <div className="rounded-3xl apple-glass p-6 sm:p-7 border border-emerald-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-emerald-400">
            <Smartphone className="w-3.5 h-3.5" />
            <span>StoryPay · Pago Móvil Automático</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Orden #{data.orderNumber}
          </h1>
          <p className="text-xs text-slate-400">
            Transfiere el monto exacto en Bolívares e ingresa tu número de referencia para liberar tus tarjetas al instante.
          </p>
        </div>

        <div className="bg-slate-950/75 border border-white/10 rounded-2xl px-5 py-3.5 text-left sm:text-right shrink-0">
          <div className="text-[11px] text-slate-400 font-semibold">
            Equivalente USD: {formatCents(data.amountDueCents)} USD
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-300 font-mono mt-0.5">
            Bs {formatBsNumber(data.amountDueBsCents)}
          </div>
          {data.bsRateCents && (
            <div className="text-[11px] text-slate-400 mt-0.5">
              Tasa congelada: Bs {formatBsNumber(data.bsRateCents)} / USD ·{" "}
              <span className={rateExpiredLive ? "text-amber-400 font-bold" : "text-sky-300 font-mono"}>
                {rateExpiredLive
                  ? "Vencida"
                  : formatCountdown(data.rateExpiresAt, nowMs)}
              </span>
            </div>
          )}
        </div>
      </div>

      {orderExpiredLive ? (
        <div className="rounded-3xl bg-rose-500/10 border border-rose-500/35 p-6 sm:p-8 text-center space-y-4">
          <AlertTriangle className="w-9 h-9 text-rose-400 mx-auto" />
          <h2 className="text-xl font-black text-white">Esta orden expiró</h2>
          <p className="text-xs text-slate-300 max-w-lg mx-auto leading-relaxed">
            La ventana de pago de esta orden cerró. Si aún no transferiste, genera una nueva orden desde tu carrito. Si ya enviaste los bolívares, entra en tu orden o escríbenos para aprobarla manualmente.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-1">
            <Link
              href={`/order/${data.orderId}`}
              className="px-5 py-2.5 rounded-xl bg-white text-slate-950 font-black text-xs"
            >
              Ver detalle de orden
            </Link>
            <Link
              href="/checkout"
              className="px-5 py-2.5 rounded-xl bg-white/[0.08] border border-white/15 text-white font-bold text-xs"
            >
              Ir al carrito
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Receiver Bank Account Instructions */}
          <div className="lg:col-span-6 rounded-3xl apple-glass p-6 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-400" />
                <span>1. Datos Pago Móvil destino</span>
              </h2>
              {data.receiver && (
                <button
                  type="button"
                  onClick={handleCopyAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-bold text-white transition-colors"
                >
                  {copiedKey === "all" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>Copiar todo</span>
                </button>
              )}
            </div>

            {rateExpiredLive && (
              <div className="rounded-2xl bg-amber-500/15 border border-amber-400/35 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-amber-100 leading-relaxed">
                  <span className="font-black text-amber-300 block">
                    Tasa congelada vencida
                  </span>
                  Actualiza la tasa antes de transferir para bloquear tu monto exacto en Bolívares.
                </div>
                <button
                  type="button"
                  disabled={refreshingRate}
                  onClick={() => void handleRefreshRate()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs shrink-0"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${refreshingRate ? "animate-spin" : ""}`}
                  />
                  <span>Actualizar tasa Bs</span>
                </button>
              </div>
            )}

            {/* Exact Bs Copy Box */}
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                  Monto exacto a enviar
                </div>
                <div className="text-2xl font-black text-white font-mono mt-0.5">
                  Bs {formatBsNumber(data.amountDueBsCents)}
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5">
                  No redondees hacia abajo (evita rechazos automáticos)
                </div>
              </div>
              <button
                type="button"
                onClick={() => void copyField("amount", exactCopyBs, "Monto en Bs")}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs shrink-0 transition-colors"
              >
                {copiedKey === "amount" ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{exactCopyBs}</span>
              </button>
            </div>

            {data.receiver ? (
              <div className="space-y-2.5">
                {[
                  {
                    key: "bank",
                    label: "Banco receptor",
                    display: `${data.receiver.bankCode} - ${data.receiver.bankName}`,
                    copyVal: data.receiver.bankCode,
                    badge:
                      data.receiver.accountType === "natural"
                        ? "Natural"
                        : "Jurídica",
                  },
                  {
                    key: "phone",
                    label: "Teléfono Pago Móvil",
                    display: data.receiver.phone,
                    copyVal: data.receiver.phone,
                  },
                  {
                    key: "dni",
                    label: "Cédula / RIF",
                    display: data.receiver.dni,
                    copyVal: data.receiver.dni.replace(/[^0-9]/g, ""),
                  },
                  {
                    key: "holder",
                    label: "Titular de cuenta",
                    display: data.receiver.holderName,
                    copyVal: data.receiver.holderName,
                  },
                ].map((row) => (
                  <div
                    key={row.key}
                    className="rounded-2xl bg-slate-950/75 border border-white/10 px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <span>{row.label}</span>
                        {row.badge && (
                          <span className="px-1.5 py-0.5 rounded bg-white/[0.07] text-[10px] font-bold text-slate-300">
                            {row.badge}
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-black text-white font-mono truncate mt-0.5">
                        {row.display}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyField(row.key, row.copyVal, row.label)}
                      className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] text-slate-200 transition-colors shrink-0"
                      aria-label={`Copiar ${row.label}`}
                    >
                      {copiedKey === row.key ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-4 text-xs text-rose-200">
                No hay cuenta bancaria receptora configurada en este momento.
              </div>
            )}
          </div>

          {/* Right: Verify Reference Form */}
          <div className="lg:col-span-6 rounded-3xl apple-glass p-6 space-y-5">
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              <span>2. Reportar y verificar Pago Móvil</span>
            </h2>

            {verifyFeedback && (
              <div
                className={`rounded-2xl p-4 border text-xs leading-relaxed flex items-start gap-3 ${
                  verifyFeedback.type === "waiting"
                    ? "bg-sky-500/10 border-sky-400/35 text-sky-100"
                    : verifyFeedback.type === "warning"
                      ? "bg-amber-500/15 border-amber-400/35 text-amber-100"
                      : "bg-rose-500/15 border-rose-400/35 text-rose-100"
                }`}
              >
                {verifyFeedback.type === "waiting" ? (
                  <Loader2 className="w-4 h-4 text-sky-300 animate-spin shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      verifyFeedback.type === "warning"
                        ? "text-amber-300"
                        : "text-rose-300"
                    }`}
                  />
                )}
                <div className="space-y-2 flex-1">
                  <p>{verifyFeedback.message}</p>
                  {verifyFeedback.code === "RATE_EXPIRED" && (
                    <button
                      type="button"
                      disabled={refreshingRate}
                      onClick={() => void handleRefreshRate()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-black text-[11px]"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Actualizar tasa ahora
                    </button>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleVerifySubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="pm-bank"
                  className="block text-xs font-bold text-slate-300 mb-1.5"
                >
                  Banco desde donde pagaste
                </label>
                <select
                  id="pm-bank"
                  value={senderBankCode}
                  onChange={(e) => setSenderBankCode(e.target.value)}
                  className="w-full rounded-2xl bg-slate-950/85 border border-white/15 px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-400"
                >
                  <option value="">Cualquier banco (detección automática)</option>
                  {VENEZUELAN_BANKS.map((bank) => (
                    <option key={bank.code} value={bank.code}>
                      {bank.code} · {bank.shortName} ({bank.name})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="pm-reference"
                  className="block text-xs font-bold text-slate-300 mb-1.5"
                >
                  Número de referencia bancaria (mínimo{" "}
                  {data.settings.minReferenceDigits} dígitos)
                </label>
                <input
                  id="pm-reference"
                  type="text"
                  inputMode="numeric"
                  required
                  value={referenceDigits}
                  onChange={(e) => setReferenceDigits(e.target.value)}
                  placeholder="Ej. 849302 o últimos dígitos"
                  className="w-full rounded-2xl bg-slate-950/85 border border-white/15 px-4 py-3 text-sm font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-400"
                />
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Si otro cliente pagó con una terminación parecida, coloca el número de referencia completo.
                </p>
              </div>

              <div>
                <label
                  htmlFor="pm-phone"
                  className="block text-xs font-bold text-slate-300 mb-1.5"
                >
                  Teléfono emisor{" "}
                  {data.settings.requireSenderPhone ? "(Obligatorio)" : "(Opcional)"}
                </label>
                <input
                  id="pm-phone"
                  type="tel"
                  required={data.settings.requireSenderPhone}
                  value={senderPhone}
                  onChange={(e) => setSenderPhone(e.target.value)}
                  placeholder="Ej. 04121234567"
                  className="w-full rounded-2xl bg-slate-950/85 border border-white/15 px-4 py-3 text-sm font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-400"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || rateExpiredLive}
                className="w-full py-4 px-5 rounded-2xl bg-emerald-400 hover:bg-emerald-300 disabled:bg-slate-800 disabled:text-slate-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition-all shadow-xl"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Verificando con el banco...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Verificar Pago Móvil Ahora</span>
                  </>
                )}
              </button>
            </form>

            <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-4 text-[11px] text-slate-400 space-y-1.5 leading-relaxed">
              <div className="font-bold text-slate-200 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Protección anti-pérdida StoryCheap
              </div>
              <p>
                Si envías un excedente en bolívares, la diferencia se acredita automáticamente en USD a tu saldo interno al verificar. Si el banco tarda unos segundos en notificar, esta ventana detectará tu pago automáticamente cada 2 segundos.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PagoMovilHostedCheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl mx-auto px-4 py-20 flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
            <Loader2 className="w-7 h-7 animate-spin" />
          </div>
          <p className="text-sm font-bold text-white">
            Cargando ventana de Pago Móvil Venezuela...
          </p>
        </div>
      }
    >
      <PagoMovilHostedCheckoutContent />
    </Suspense>
  );
}
