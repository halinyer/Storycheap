/* eslint-disable @next/next/no-img-element */
"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { formatCents } from "@/lib/catalog-seed";
import { resolveBrandTheme } from "@/lib/brand-theme";
import type { OrderDTO, OrderStatus, RevealedCodeDTO } from "@/types";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

const POLLABLE_STATUSES: OrderStatus[] = [
  "CREATED",
  "PENDING_PAYMENT",
  "PAID",
  "FULFILLING",
];

function getStepperStep(status: OrderStatus): number {
  switch (status) {
    case "CREATED":
    case "PENDING_PAYMENT":
      return 1;
    case "PAID":
      return 2;
    case "FULFILLING":
    case "MANUAL_REVIEW":
    case "PARTIAL":
      return 3;
    case "DELIVERED":
    case "REFUNDED_CREDIT":
      return 4;
    default:
      return 1;
  }
}

function OrderDetailInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const orderId = params.id;
  const isSandboxCheckout = Boolean(searchParams.get("sandboxCheckout"));

  const [order, setOrder] = useState<OrderDTO | null>(null);
  const [statusMeta, setStatusMeta] = useState<{
    label: string;
    description: string;
    tone: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revealing, setRevealing] = useState(false);
  const [revealedCodes, setRevealedCodes] = useState<RevealedCodeDTO[] | null>(
    null
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [maskedIds, setMaskedIds] = useState<Record<string, boolean>>({});
  const [simulating, setSimulating] = useState(false);
  const [resolvingUnderpayment, setResolvingUnderpayment] = useState(false);
  const [userCreditBalanceCents, setUserCreditBalanceCents] = useState(0);

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setAuthRequired(res.status === 401 || res.status === 403);
        setErrorMsg(err.error ?? "No se pudo cargar la orden.");
        return;
      }
      const data = (await res.json()) as {
        order: OrderDTO;
        statusMeta: { label: string; description: string; tone: string };
        userCreditBalanceCents?: number;
      };
      setOrder(data.order);
      setStatusMeta(data.statusMeta);
      if (typeof data.userCreditBalanceCents === "number") {
        setUserCreditBalanceCents(data.userCreditBalanceCents);
      }
      setAuthRequired(false);
      setErrorMsg(null);
    } catch {
      setErrorMsg("Error de red al consultar el estado de la orden.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/orders/${orderId}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          if (active) {
            setAuthRequired(res.status === 401 || res.status === 403);
            setErrorMsg(err.error ?? "No se pudo cargar la orden.");
          }
          return;
        }
        const data = (await res.json()) as {
          order: OrderDTO;
          statusMeta: { label: string; description: string; tone: string };
          userCreditBalanceCents?: number;
        };
        if (active) {
          setOrder(data.order);
          setStatusMeta(data.statusMeta);
          if (typeof data.userCreditBalanceCents === "number") {
            setUserCreditBalanceCents(data.userCreditBalanceCents);
          }
          setAuthRequired(false);
          setErrorMsg(null);
        }
      })
      .catch(() => {
        if (active) {
          setErrorMsg("Error de red al consultar el estado de la orden.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  useEffect(() => {
    if (!order || !POLLABLE_STATUSES.includes(order.status)) return;
    const id = setInterval(() => {
      void fetchOrder();
    }, 2500);
    return () => clearInterval(id);
  }, [order, fetchOrder]);

  const handleRevealCodes = useCallback(
    async (silent = false) => {
      setRevealing(true);
      try {
        const res = await fetch(`/api/orders/${orderId}/reveal`, {
          method: "POST",
        });
        const data = (await res.json()) as {
          error?: string;
          codes?: RevealedCodeDTO[];
        };
        if (!res.ok || !data.codes) {
          if (!silent) {
            throw new Error(data.error ?? "No se pudieron revelar los códigos.");
          }
          return;
        }
        setRevealedCodes(data.codes);
        if (!silent) {
          toast.success("Código desbloqueado en pantalla");
        }
      } catch (err) {
        if (!silent) {
          toast.error(err instanceof Error ? err.message : "Error al revelar");
        }
      } finally {
        setRevealing(false);
      }
    },
    [orderId]
  );

  // Auto-reveal codes once as soon as the order is DELIVERED or PARTIAL
  useEffect(() => {
    if (
      order &&
      (order.status === "DELIVERED" || order.status === "PARTIAL") &&
      order.fulfillments.length > 0 &&
      !revealedCodes &&
      !revealing
    ) {
      void handleRevealCodes(true);
    }
  }, [order, revealedCodes, revealing, handleRevealCodes]);

  const handleSimulateSandboxPayment = async (
    outcome: "completed" | "underpaid" | "overpaid" | "expired"
  ) => {
    setSimulating(true);
    try {
      const res = await fetch("/api/sandbox/simulate-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, outcome }),
      });
      const data = (await res.json()) as { error?: string; order?: OrderDTO };
      if (!res.ok) {
        throw new Error(data.error ?? "No se pudo simular el pago.");
      }
      if (data.order) setOrder(data.order);
      await fetchOrder();
      toast.success(`Evento ZenoBank (${outcome}) procesado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error sandbox");
    } finally {
      setSimulating(false);
    }
  };

  const handleResolveUnderpayment = async (
    mode: "complete_with_credit" | "convert_to_credit_now"
  ) => {
    setResolvingUnderpayment(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/resolve-underpayment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json()) as {
        error?: string;
        outcome?: "fulfilled" | "converted_to_credit";
        order?: OrderDTO;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "No se pudo resolver el pago parcial.");
      }
      if (data.order) setOrder(data.order);
      await fetchOrder();
      if (data.outcome === "fulfilled") {
        toast.success("Diferencia cubierta con tu saldo a favor. Orden entregada.");
      } else {
        toast.success("Pago parcial acreditado inmediatamente a tu saldo a favor.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al procesar");
    } finally {
      setResolvingUnderpayment(false);
    }
  };

  const copyCode = async (value: string, idKey: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedId(idKey);
    toast.success("¡Código copiado al portapapeles!");
    setTimeout(() => {
      setCopiedId((prev) => (prev === idKey ? null : prev));
    }, 2400);
  };

  const toggleMask = (idKey: string) => {
    setMaskedIds((prev) => ({ ...prev, [idKey]: !prev[idKey] }));
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-20 flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
        </div>
        <div className="text-sm font-bold text-white">
          Cargando tu bóveda de códigos...
        </div>
      </div>
    );
  }

  if (errorMsg || !order) {
    const loginNext = encodeURIComponent(`/order/${orderId}`);
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7 text-amber-400" />
        </div>
        <h1 className="text-2xl font-black text-white">
          {authRequired
            ? "Inicia sesión para ver tu código"
            : "Orden no encontrada"}
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
          {authRequired
            ? "Por seguridad, solo el comprador titular puede ver y copiar estos códigos digitales. Inicia sesión con el correo usado en tu compra."
            : errorMsg ?? "Verifica el enlace o consulta tus pedidos desde tu cuenta."}
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link
            href={`/login?next=${loginNext}`}
            className="px-5 py-2.5 rounded-full bg-white text-slate-950 font-black text-xs hover:bg-slate-200 transition-colors"
          >
            Iniciar sesión
          </Link>
          {authRequired && (
            <Link
              href={`/login?mode=magic-link&next=${loginNext}`}
              className="px-5 py-2.5 rounded-full bg-indigo-500/20 border border-indigo-400/35 text-indigo-200 font-bold text-xs"
            >
              Entrar con enlace mágico
            </Link>
          )}
          <Link
            href="/"
            className="px-5 py-2.5 rounded-full border border-white/10 text-slate-200 font-bold text-xs hover:bg-white/5"
          >
            Ir a la tienda
          </Link>
        </div>
      </div>
    );
  }

  const stepIndex = getStepperStep(order.status);
  const canReveal = order.status === "DELIVERED" || order.status === "PARTIAL";
  const primaryItem = order.items[0];
  const heroTheme = resolveBrandTheme(
    primaryItem?.productName ?? "Gift Card",
    primaryItem?.productSlug
  );

  const steps = [
    { num: 1, label: "Pago iniciado" },
    { num: 2, label: "Confirmado" },
    { num: 3, label: "Generando PIN" },
    { num: 4, label: "Listo para canjear" },
  ];

  // Combine fulfillments with revealed codes so we always render rich voucher cards
  const voucherItems = order.fulfillments.map((f) => {
    const matchedReveal = revealedCodes?.find((r) => r.fulfillmentId === f.id);
    const matchedOrderItem = order.items.find((i) => i.id === f.orderItemId);
    const theme = resolveBrandTheme(
      f.productName,
      matchedOrderItem?.productSlug
    );
    return {
      fulfillment: f,
      revealed: matchedReveal ?? null,
      theme,
    };
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
      {/* Top Breadcrumb Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver a la tienda</span>
        </Link>

        <div className="flex items-center gap-2.5">
          <Link
            href="/account"
            className="px-3.5 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-bold text-slate-300 transition-colors"
          >
            Mis compras
          </Link>
          <button
            type="button"
            onClick={() => void fetchOrder()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-slate-200 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                POLLABLE_STATUSES.includes(order.status)
                  ? "animate-spin text-sky-400"
                  : ""
              }`}
            />
            <span>
              {POLLABLE_STATUSES.includes(order.status)
                ? "Sincronizando..."
                : "Actualizar"}
            </span>
          </button>
        </div>
      </div>

      {/* Main CoinGate / Nintendo eShop Inspired Order Banner */}
      <div className="relative rounded-[28px] overflow-hidden border border-white/10 bg-[#11131c] shadow-2xl">
        {/* Ambient Brand Glow */}
        <div
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: heroTheme.accentHex }}
        />
        <div
          className="absolute -bottom-28 -left-24 w-80 h-80 rounded-full opacity-15 blur-3xl pointer-events-none"
          style={{ background: heroTheme.accentHex }}
        />

        <div className="relative z-10 p-6 sm:p-8 space-y-7">
          {/* Top Header Row with Artwork Preview + Status */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="flex items-center gap-4 sm:gap-5">
              {/* Floating Gift Card Thumbnail */}
              <div className="relative w-16 h-20 sm:w-20 sm:h-24 rounded-2xl bg-slate-950/90 border border-white/15 p-2 flex items-center justify-center shrink-0 shadow-xl">
                <img
                  src={heroTheme.imageUrl}
                  alt={primaryItem?.productName ?? "Gift Card"}
                  className="max-h-full max-w-full object-contain rounded-lg drop-shadow-[0_8px_16px_rgba(0,0,0,0.75)]"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-white/[0.07] border border-white/10 font-mono text-[11px] font-bold text-slate-300">
                    #{order.orderNumber}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider border ${
                      order.status === "DELIVERED"
                        ? "bg-emerald-500/15 border-emerald-400/35 text-emerald-300"
                        : POLLABLE_STATUSES.includes(order.status)
                          ? "bg-sky-500/15 border-sky-400/35 text-sky-300"
                          : "bg-amber-500/15 border-amber-400/35 text-amber-300"
                    }`}
                  >
                    {POLLABLE_STATUSES.includes(order.status) ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3" />
                    )}
                    <span>{statusMeta?.label ?? order.status}</span>
                  </span>
                </div>

                <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight">
                  {order.status === "DELIVERED"
                    ? "¡Tu código digital está listo para canjear!"
                    : statusMeta?.label ?? order.status}
                </h1>

                <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
                  {statusMeta?.description}
                </p>
              </div>
            </div>

            {/* Total Pill on Right */}
            <div className="sm:text-right bg-white/[0.03] border border-white/[0.07] rounded-2xl px-4 py-3 shrink-0 self-start sm:self-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Total de la orden
              </span>
              <span className="text-xl font-black text-white">
                {formatCents(order.subtotalCents)}{" "}
                <span className="text-xs font-bold text-slate-400">USD</span>
              </span>
            </div>
          </div>

          {/* Sleek Connected Horizontal Stepper */}
          {order.status !== "EXPIRED" && order.status !== "CANCELLED" && (
            <div className="pt-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {steps.map((s) => {
                  const reached = stepIndex >= s.num;
                  const isCurrentWaitStep =
                    POLLABLE_STATUSES.includes(order.status) &&
                    (order.status === "CREATED" ||
                    order.status === "PENDING_PAYMENT"
                      ? s.num === 1
                      : s.num === 3);

                  return (
                    <div
                      key={s.num}
                      className={`relative rounded-2xl px-4 py-3 border transition-all flex items-center gap-3 ${
                        isCurrentWaitStep
                          ? "bg-sky-500/15 border-sky-400/45 text-white shadow-[0_0_24px_-6px_rgba(56,189,248,0.4)]"
                          : reached
                            ? "bg-emerald-500/[0.09] border-emerald-500/30 text-white"
                            : "bg-white/[0.02] border-white/[0.06] text-slate-500"
                      }`}
                    >
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                          isCurrentWaitStep
                            ? "bg-sky-400/20 text-sky-300 border border-sky-400/50"
                            : reached
                              ? "bg-emerald-500 text-slate-950"
                              : "bg-white/[0.05] text-slate-500 border border-white/10"
                        }`}
                      >
                        {isCurrentWaitStep ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : reached ? (
                          <Check className="w-4 h-4 stroke-[3]" />
                        ) : (
                          s.num
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">
                          Paso 0{s.num}
                        </div>
                        <div className="text-xs font-extrabold truncate">
                          {s.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Live Animated Vault Loader when PAID or FULFILLING */}
          {(order.status === "PAID" || order.status === "FULFILLING") && (
            <div className="rounded-2xl bg-gradient-to-r from-sky-500/15 via-indigo-500/10 to-sky-500/15 border border-sky-400/35 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-sky-400/20 border border-sky-400/40 flex items-center justify-center shrink-0">
                  <Loader2 className="w-6 h-6 text-sky-300 animate-spin" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm sm:text-base font-black text-white">
                      Conectando con el proveedor oficial para emitir tu PIN...
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                    Tu pago ya está confirmado. En unos segundos tu tarjeta aparecerá desbloqueada aquí mismo sin tocar nada.
                  </p>
                </div>
              </div>
              <div className="px-3.5 py-2 rounded-xl bg-slate-950/70 border border-white/10 text-[11px] font-mono text-sky-300 shrink-0 self-start sm:self-center">
                Auto-verificando cada 2s...
              </div>
            </div>
          )}

          {/* Partial payment progress while checkout is still open */}
          {order.status === "PENDING_PAYMENT" &&
            order.paidCents > 0 &&
            order.paidCents < order.amountDueCents && (
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="text-xs text-amber-100 leading-relaxed max-w-xl">
                    <span className="font-bold text-amber-300 block mb-0.5">
                      Pago parcial detectado: {formatCents(order.paidCents)} de{" "}
                      {formatCents(order.amountDueCents)} USD
                    </span>
                    Faltan{" "}
                    <strong className="text-white">
                      {formatCents(order.amountDueCents - order.paidCents)} USD
                    </strong>{" "}
                    para completar la orden. Puedes enviar la diferencia, cubrirla con tu saldo a favor o convertir lo pagado en saldo a favor al instante.
                  </div>
                  {order.gatewayCheckoutUrl && (
                    <a
                      href={order.gatewayCheckoutUrl}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs shrink-0"
                    >
                      <span>
                        Completar {formatCents(order.amountDueCents - order.paidCents)} en ZenoBank
                      </span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                <div className="pt-3 border-t border-amber-400/20 flex flex-wrap items-center gap-2.5">
                  {userCreditBalanceCents >=
                    order.amountDueCents - order.paidCents && (
                    <button
                      type="button"
                      disabled={resolvingUnderpayment}
                      onClick={() =>
                        void handleResolveUnderpayment("complete_with_credit")
                      }
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 text-slate-950 font-black text-xs"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      <span>
                        Cubrir{" "}
                        {formatCents(order.amountDueCents - order.paidCents)} con
                        mi saldo a favor ahora
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={resolvingUnderpayment}
                    onClick={() =>
                      void handleResolveUnderpayment("convert_to_credit_now")
                    }
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-50 border border-white/15 text-white font-bold text-xs"
                  >
                    <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      Convertir mis {formatCents(order.paidCents)} USD en saldo a favor
                    </span>
                  </button>
                </div>
              </div>
            )}

          {/* Payment Link if still PENDING_PAYMENT with 0 paid */}
          {order.status === "PENDING_PAYMENT" &&
            order.paidCents === 0 &&
            order.gatewayCheckoutUrl &&
            !isSandboxCheckout &&
            !order.gatewayCheckoutId?.startsWith("zbk_sbx_") && (
              <div className="rounded-2xl bg-indigo-500/10 border border-indigo-400/30 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/35 flex items-center justify-center shrink-0">
                    <Clock className="w-5 h-5 text-indigo-300" />
                  </div>
                  <div className="text-xs text-slate-200">
                    <span className="font-bold text-white block text-sm">
                      Esperando confirmación de pago ({formatCents(order.amountDueCents)} USD)
                    </span>
                    Si cerraste la ventana de pago de ZenoBank, puedes volver a abrirla aquí.
                  </div>
                </div>
                <a
                  href={order.gatewayCheckoutUrl}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white hover:bg-slate-200 text-slate-950 font-black text-xs transition-colors"
                >
                  <span>Abrir pasarela de pago</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

          {/* Demo Sandbox ZenoBank Simulator Bar */}
          {order.status === "PENDING_PAYMENT" &&
            (isSandboxCheckout ||
              order.gatewayCheckoutId?.startsWith("zbk_sbx_")) && (
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 space-y-3">
                <div className="flex items-center gap-2 text-amber-300 text-xs font-black uppercase tracking-wider">
                  <Sparkles className="w-4 h-4" />
                  <span>Simulador Local ZenoBank (Sandbox)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={simulating}
                    onClick={() => void handleSimulateSandboxPayment("completed")}
                    className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs"
                  >
                    Simular Pago Completo ({formatCents(order.amountDueCents)})
                  </button>
                  <button
                    type="button"
                    disabled={simulating}
                    onClick={() => void handleSimulateSandboxPayment("overpaid")}
                    className="px-3.5 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 font-bold text-xs"
                  >
                    Simular Sobrepago (+$2.50 saldo)
                  </button>
                  <button
                    type="button"
                    disabled={simulating}
                    onClick={() => void handleSimulateSandboxPayment("underpaid")}
                    className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-bold text-xs"
                  >
                    Simular Pago Parcial (50%)
                  </button>
                  <button
                    type="button"
                    disabled={simulating}
                    onClick={() => void handleSimulateSandboxPayment("expired")}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs"
                  >
                    Simular Expiración
                  </button>
                </div>
              </div>
            )}

          {/* Calm reassurance on MANUAL_REVIEW */}
          {(order.status === "MANUAL_REVIEW" || order.status === "PARTIAL") && (
            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-100 leading-relaxed">
                <span className="font-bold block mb-0.5">
                  Tu pago está seguro — no tienes que volver a pagar.
                </span>
                Nuestro sistema registró tu pago y está terminando de asignar el lote de códigos.
              </div>
            </div>
          )}

          {/* Store credit notice on REFUNDED_CREDIT */}
          {order.status === "REFUNDED_CREDIT" && (
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Wallet className="w-5 h-5 text-emerald-400 shrink-0" />
                <div className="text-xs text-emerald-100 leading-relaxed">
                  <span className="font-bold block">
                    Saldo a favor acreditado:{" "}
                    {order.paidCents + order.creditAppliedCents > 0
                      ? `${formatCents(order.paidCents + order.creditAppliedCents)} USD`
                      : "Disponible en tu cuenta"}
                  </span>
                  Se descontará automáticamente en tu próxima compra.
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href="/"
                  className="px-4 py-2 rounded-full bg-white text-slate-950 font-black text-xs"
                >
                  Catálogo
                </Link>
                <Link
                  href="/account"
                  className="px-4 py-2 rounded-full border border-white/15 text-white font-bold text-xs"
                >
                  Ver mi saldo
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* COINGATE / NINTENDO STYLE INTERACTIVE GIFT CARD VOUCHER TICKETS       */}
      {/* ===================================================================== */}
      {canReveal && voucherItems.length > 0 && (
        <div className="space-y-6">
          {voucherItems.map(({ fulfillment, revealed, theme }, idx) => {
            const isCopied = copiedId === fulfillment.id;
            const isMasked = Boolean(maskedIds[fulfillment.id]);
            const displayCode = revealed
              ? isMasked
                ? `•••• •••• •••• ${fulfillment.codeLast4}`
                : revealed.code
              : `•••• •••• •••• ${fulfillment.codeLast4}`;

            return (
              <div
                key={fulfillment.id}
                className={`relative rounded-[28px] overflow-hidden bg-[#11131c] border transition-all ${theme.borderGlow}`}
              >
                <div className="grid grid-cols-1 lg:grid-cols-12">
                  {/* Left Gift Card Visual Showcase (4 cols on desktop) */}
                  <div
                    className={`lg:col-span-4 relative p-6 sm:p-8 flex flex-col items-center justify-between text-center bg-gradient-to-br ${theme.bannerGradient} border-b lg:border-b-0 lg:border-r border-white/10`}
                  >
                    <div
                      className="absolute inset-0 opacity-25 blur-3xl pointer-events-none"
                      style={{
                        background: `radial-gradient(circle at 50% 40%, ${theme.accentHex}, transparent 70%)`,
                      }}
                    />

                    {/* Top Brand & Region Badges */}
                    <div className="relative z-10 w-full flex items-center justify-between gap-2 mb-4">
                      <span
                        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${theme.pillClass}`}
                      >
                        {theme.brandName}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-950/75 border border-white/15 text-[11px] font-bold text-slate-200">
                        <Globe className="w-3 h-3 text-sky-400" />
                        <span>{fulfillment.region}</span>
                      </span>
                    </div>

                    {/* 3D Floating Card Image */}
                    <div className="relative z-10 my-2 py-2 flex items-center justify-center">
                      <img
                        src={theme.imageUrl}
                        alt={fulfillment.productName}
                        className="w-40 sm:w-44 max-h-48 object-contain rounded-2xl drop-shadow-[0_22px_32px_rgba(0,0,0,0.85)] transform -rotate-2 hover:rotate-0 transition-transform duration-300"
                      />
                    </div>

                    {/* Product Name & Denomination Pill */}
                    <div className="relative z-10 w-full mt-4 pt-4 border-t border-white/10">
                      <div className="text-xs font-bold text-slate-300 line-clamp-1">
                        {fulfillment.productName}
                      </div>
                      <div className="text-lg sm:text-xl font-black text-white mt-0.5">
                        {fulfillment.denominationLabel}
                      </div>
                    </div>
                  </div>

                  {/* Right Interactive Code Vault & Step-by-Step Guide (8 cols on desktop) */}
                  <div className="lg:col-span-8 p-6 sm:p-8 flex flex-col justify-between space-y-6">
                    <div className="space-y-4">
                      {/* Vault Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-[11px] font-black uppercase tracking-widest text-emerald-400">
                            Tarjeta Digital #{idx + 1} • Lista para usar
                          </span>
                        </div>

                        {revealed ? (
                          <button
                            type="button"
                            onClick={() => toggleMask(fulfillment.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-[11px] font-bold text-slate-300 transition-colors"
                          >
                            {isMasked ? (
                              <>
                                <Eye className="w-3.5 h-3.5" />
                                <span>Mostrar caracteres</span>
                              </>
                            ) : (
                              <>
                                <EyeOff className="w-3.5 h-3.5" />
                                <span>Ocultar en pantalla</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={revealing}
                            onClick={() => void handleRevealCodes(false)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-slate-950 text-xs font-black"
                          >
                            {revealing ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <KeyRound className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {revealing ? "Abriendo..." : "Mostrar código"}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Interactive Code Box (Ticket Style) */}
                      <div className="rounded-2xl bg-[#090b10] border-2 border-dashed border-white/15 hover:border-white/30 p-4 sm:p-5 transition-all space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="space-y-1 min-w-0">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block">
                              Código PIN de canje
                            </span>
                            {revealed ? (
                              <div
                                onClick={() =>
                                  void copyCode(revealed.code, fulfillment.id)
                                }
                                title="Haz clic para copiar"
                                className="font-mono text-lg sm:text-2xl font-black text-white tracking-wider break-all select-all cursor-pointer hover:text-emerald-300 transition-colors"
                              >
                                {displayCode}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2.5 py-1">
                                <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                                <span className="font-mono text-base font-bold text-slate-400">
                                  Descifrando tu código...
                                </span>
                              </div>
                            )}

                            {revealed?.pin && (
                              <div className="pt-1 flex items-center gap-2 text-xs font-mono text-sky-300">
                                <span>PIN / Serie adicional:</span>
                                <span className="font-black select-all bg-sky-500/15 px-2 py-0.5 rounded-md border border-sky-400/30">
                                  {revealed.pin}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Primary Action Buttons */}
                          {revealed && (
                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  void copyCode(revealed.code, fulfillment.id)
                                }
                                className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-black text-xs transition-all shadow-lg cursor-pointer ${
                                  isCopied
                                    ? "bg-emerald-400 text-slate-950 scale-[1.02]"
                                    : "bg-white hover:bg-slate-200 text-slate-950"
                                }`}
                              >
                                {isCopied ? (
                                  <>
                                    <Check className="w-4 h-4 stroke-[3]" />
                                    <span>¡Copiado!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-4 h-4" />
                                    <span>Copiar código</span>
                                  </>
                                )}
                              </button>

                              {theme.redeemUrl && (
                                <a
                                  href={theme.redeemUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.14] border border-white/15 text-white font-bold text-xs transition-all"
                                >
                                  <span>{theme.redeemLabel}</span>
                                  <ExternalLink className="w-3.5 h-3.5 text-slate-300" />
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Built-in Step-by-Step Redemption Instructions */}
                    <div className="rounded-2xl bg-white/[0.025] border border-white/[0.07] p-4 sm:p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black uppercase tracking-wider text-slate-300">
                          ¿Cómo canjear en {theme.brandName}?
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Entrega inmediata • Región {fulfillment.region}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {theme.steps.map((stepText, stepIdx) => (
                          <div
                            key={stepIdx}
                            className="rounded-xl bg-slate-950/60 border border-white/[0.06] p-3 space-y-1.5"
                          >
                            <div className="w-5 h-5 rounded-full bg-white/10 text-white font-black text-[10px] flex items-center justify-center">
                              {stepIdx + 1}
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                              {stepText}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Compact Two-Column Order Receipt & Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Items in this order */}
        <div className="lg:col-span-7 rounded-[24px] bg-[#11131c] border border-white/10 p-6 space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">
            Artículos del pedido
          </h3>
          <div className="divide-y divide-white/[0.06]">
            {order.items.map((item) => {
              const itemTheme = resolveBrandTheme(
                item.productName,
                item.productSlug
              );
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-11 h-14 rounded-xl bg-slate-950 border border-white/10 p-1.5 flex items-center justify-center shrink-0">
                      <img
                        src={itemTheme.imageUrl}
                        alt={item.productName}
                        className="max-h-full max-w-full object-contain rounded"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-black text-white truncate">
                        {item.productName}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {item.denominationLabel} • Región {item.region} • Cant:{" "}
                        {item.quantity}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-black text-white">
                      {formatCents(item.unitPriceCents * item.quantity)} USD
                    </div>
                    <div className="text-[11px] text-emerald-400 font-bold">
                      {item.deliveredCount}/{item.quantity} entregado
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Payment Summary */}
        <div className="lg:col-span-5 rounded-[24px] bg-[#11131c] border border-white/10 p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">
              Resumen de pago
            </h3>
            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-bold text-white">
                  {formatCents(order.subtotalCents)} USD
                </span>
              </div>
              {order.creditAppliedCents > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Saldo a favor aplicado</span>
                  <span className="font-bold">
                    -{formatCents(order.creditAppliedCents)} USD
                  </span>
                </div>
              )}
              <div className="flex justify-between font-black text-white text-sm pt-2.5 border-t border-white/[0.08]">
                <span>Total en pasarela</span>
                <span>{formatCents(order.amountDueCents)} USD</span>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Bóveda cifrada AES-256</span>
            </span>
            <span className="font-mono">#{order.orderNumber}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OrderDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-20 text-center text-xs text-slate-400">
          Cargando orden...
        </div>
      }
    >
      <OrderDetailInner />
    </Suspense>
  );
}
