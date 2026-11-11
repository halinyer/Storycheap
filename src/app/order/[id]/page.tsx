"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { formatCents } from "@/lib/catalog-seed";
import type { OrderDTO, OrderStatus, RevealedCodeDTO } from "@/types";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  KeyRound,
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
  const [loading, setLoading] = useState(true);
  const [revealing, setRevealing] = useState(false);
  const [revealedCodes, setRevealedCodes] = useState<RevealedCodeDTO[] | null>(
    null
  );
  const [simulating, setSimulating] = useState(false);

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(err.error ?? "No se pudo cargar la orden.");
        return;
      }
      const data = (await res.json()) as {
        order: OrderDTO;
        statusMeta: { label: string; description: string; tone: string };
      };
      setOrder(data.order);
      setStatusMeta(data.statusMeta);
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
          if (active) setErrorMsg(err.error ?? "No se pudo cargar la orden.");
          return;
        }
        const data = (await res.json()) as {
          order: OrderDTO;
          statusMeta: { label: string; description: string; tone: string };
        };
        if (active) {
          setOrder(data.order);
          setStatusMeta(data.statusMeta);
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
    }, 3000);
    return () => clearInterval(id);
  }, [order, fetchOrder]);

  const handleRevealCodes = async () => {
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
        throw new Error(data.error ?? "No se pudieron revelar los códigos.");
      }
      setRevealedCodes(data.codes);
      void fetchOrder();
      toast.success("Códigos descifrados desde tu bóveda segura");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al revelar");
    } finally {
      setRevealing(false);
    }
  };

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

  const copyCode = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success("Código copiado al portapapeles");
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center text-xs text-slate-400">
        Verificando estado de tu orden...
      </div>
    );
  }

  if (errorMsg || !order) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="text-xl font-black text-white">Acceso restringido o no encontrado</h1>
        <p className="text-xs text-slate-400 leading-relaxed">
          {errorMsg ?? "Inicia sesión con el correo usado en tu compra para ver esta orden."}
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <Link
            href="/login"
            className="px-4 py-2.5 rounded-xl bg-white text-slate-950 font-black text-xs"
          >
            Iniciar sesión
          </Link>
          <Link
            href="/"
            className="px-4 py-2.5 rounded-xl border border-white/10 text-slate-200 font-bold text-xs"
          >
            Catálogo
          </Link>
        </div>
      </div>
    );
  }

  const stepIndex = getStepperStep(order.status);
  const canReveal = order.status === "DELIVERED" || order.status === "PARTIAL";

  const steps = [
    { num: 1, label: "Esperando pago" },
    { num: 2, label: "Pago confirmado" },
    { num: 3, label: "Preparando tu código" },
    { num: 4, label: "Listo para canjear" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      {/* Header Summary */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Orden {order.orderNumber}
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-white mt-1">
              {statusMeta?.label ?? order.status}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1.5 leading-relaxed max-w-xl">
              {statusMeta?.description}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void fetchOrder()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-xs font-bold text-slate-200"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar</span>
          </button>
        </div>

        {/* Calm Live Stepper */}
        {order.status !== "EXPIRED" && order.status !== "CANCELLED" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            {steps.map((s) => {
              const reached = stepIndex >= s.num;
              return (
                <div
                  key={s.num}
                  className={`rounded-2xl p-3.5 border transition-all ${
                    reached
                      ? "bg-emerald-500/10 border-emerald-500/30 text-white"
                      : "bg-white/[0.02] border-white/[0.06] text-slate-500"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-black uppercase">
                      Paso {s.num}
                    </span>
                    {reached ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Clock className="w-4 h-4 text-slate-600" />
                    )}
                  </div>
                  <div className="text-xs font-bold">{s.label}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Payment Link if still PENDING_PAYMENT */}
        {order.status === "PENDING_PAYMENT" &&
          order.gatewayCheckoutUrl &&
          !isSandboxCheckout &&
          !order.gatewayCheckoutId?.startsWith("zbk_sbx_") && (
            <div className="rounded-2xl bg-sky-500/10 border border-sky-500/30 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="text-xs text-sky-100">
                <span className="font-bold block">
                  Tu enlace de pago está activo ({formatCents(order.amountDueCents)} USD)
                </span>
                Si cerraste la ventana de ZenoBank, puedes abrirla nuevamente aquí.
              </div>
              <a
                href={order.gatewayCheckoutUrl}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-slate-950 font-black text-xs"
              >
                <span>Ir a pagar en ZenoBank</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

        {/* Demo Sandbox ZenoBank Simulator Bar (Only visible when sandbox checkout is active) */}
        {order.status === "PENDING_PAYMENT" &&
          (isSandboxCheckout || order.gatewayCheckoutId?.startsWith("zbk_sbx_")) && (
            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 space-y-3">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-black uppercase tracking-wider">
                <Sparkles className="w-4 h-4" />
                <span>Simulador Local ZenoBank (Sandbox)</span>
              </div>
              <p className="text-xs text-amber-100/90 leading-relaxed">
                No tienes keys reales de ZenoBank configuradas todavía. Usa estos botones para simular el webhook firmado y probar la entrega automática o la protección de saldo a favor ({formatCents(order.amountDueCents)} USD):
              </p>
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
                Tu pago fue recibido de forma segura — no tienes que volver a pagar.
              </span>
              Nuestro equipo ya recibió una alerta prioritaria para completar tu entrega o acreditar saldo a favor si corresponde.
            </div>
          </div>
        )}

        {/* Store credit notice on REFUNDED_CREDIT */}
        {order.status === "REFUNDED_CREDIT" && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-emerald-400 shrink-0" />
              <div className="text-xs text-emerald-100">
                <span className="font-bold block">
                  Saldo a favor acreditado en tu cuenta
                </span>
                Puedes usar este saldo automáticamente en tu próxima compra.
              </div>
            </div>
            <Link
              href="/account"
              className="px-3.5 py-2 rounded-xl bg-white text-slate-950 font-black text-xs shrink-0"
            >
              Ver mi saldo
            </Link>
          </div>
        )}
      </div>

      {/* Secure Code Vault Reveal Section */}
      {canReveal && (
        <div className="rounded-3xl apple-glass p-6 sm:p-8 space-y-5 border border-emerald-500/25">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white">
                  Tus Códigos Digitales ({order.fulfillments.length})
                </h2>
                <p className="text-xs text-slate-400">
                  Cifrados en servidor. Presiona revelar para descifrarlos en pantalla.
                </p>
              </div>
            </div>

            {!revealedCodes && (
              <button
                type="button"
                disabled={revealing}
                onClick={() => void handleRevealCodes()}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white hover:bg-sky-300 text-slate-950 font-black text-xs shadow-lg"
              >
                <Eye className="w-4 h-4" />
                <span>{revealing ? "Descifrando..." : "Revelar códigos"}</span>
              </button>
            )}
          </div>

          {revealedCodes ? (
            <div className="space-y-3">
              {revealedCodes.map((c) => (
                <div
                  key={c.fulfillmentId}
                  className="rounded-2xl bg-slate-950/90 border border-white/15 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="text-xs text-slate-400 font-bold">
                      {c.productName} • {c.denominationLabel} ({c.region})
                    </div>
                    <div className="font-mono text-lg sm:text-xl font-black text-emerald-300 tracking-wider mt-1 select-all">
                      {c.code}
                    </div>
                    {c.pin && (
                      <div className="font-mono text-xs text-sky-300 mt-1">
                        PIN: <span className="font-bold select-all">{c.pin}</span>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => void copyCode(c.code)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-slate-950 font-black text-xs shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar código</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {order.fulfillments.map((f) => (
                <div
                  key={f.id}
                  className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-4 flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-bold text-white">
                      {f.productName}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {f.denominationLabel}
                    </div>
                  </div>
                  <div className="font-mono text-xs text-slate-300 bg-slate-950 px-3 py-1.5 rounded-lg border border-white/10">
                    ••••-{f.codeLast4}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Order Items & Totals */}
      <div className="rounded-3xl apple-glass p-6 space-y-4">
        <h3 className="text-sm font-black text-white uppercase tracking-wider">
          Detalle de la orden
        </h3>
        <div className="space-y-3">
          {order.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between text-xs py-2 border-b border-white/[0.06]"
            >
              <div>
                <div className="font-bold text-white">{item.productName}</div>
                <div className="text-slate-400">
                  {item.denominationLabel} • Región {item.region} • Cantidad:{" "}
                  {item.quantity}
                </div>
              </div>
              <div className="text-right">
                <div className="font-black text-white">
                  {formatCents(item.unitPriceCents * item.quantity)}
                </div>
                <div className="text-[11px] text-slate-400">
                  Entregados: {item.deliveredCount}/{item.quantity}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2 space-y-1.5 text-xs text-slate-300">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatCents(order.subtotalCents)} USD</span>
          </div>
          {order.creditAppliedCents > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>Saldo a favor aplicado</span>
              <span>-{formatCents(order.creditAppliedCents)} USD</span>
            </div>
          )}
          <div className="flex justify-between font-black text-white text-sm pt-2 border-t border-white/[0.08]">
            <span>Total en pasarela</span>
            <span>{formatCents(order.amountDueCents)} USD</span>
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center text-xs text-slate-400">
          Cargando orden...
        </div>
      }
    >
      <OrderDetailInner />
    </Suspense>
  );
}
