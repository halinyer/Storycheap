"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  recordManualZenoPaymentAdminAction,
  refundOrderToCreditAction,
  resolveOrderAttentionAction,
  retryOrderFulfillmentAction,
  syncZenoBankOrderAdminAction,
  toggleOrderTestFlagAction,
} from "@/app/admin/actions";
import { formatCents } from "@/lib/catalog-seed";
import type { OrderStatus, PaymentGatewayId } from "@/types";
import { CheckCircle2, FlaskConical, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";

export function OrderDetailActions({
  orderId,
  status,
  needsAttention,
  paymentGateway,
  hasGatewayCheckoutId = false,
  amountDueCents = 0,
  isTest = false,
  testNote = null,
}: {
  orderId: string;
  status: OrderStatus;
  needsAttention: boolean;
  paymentGateway?: PaymentGatewayId;
  hasGatewayCheckoutId?: boolean;
  amountDueCents?: number;
  isTest?: boolean;
  testNote?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reasonNote, setReasonNote] = useState("");
  const [noteInput, setNoteInput] = useState(testNote ?? "");
  const [manualUsd, setManualUsd] = useState("");
  const [manualTx, setManualTx] = useState("");

  const canSyncZeno =
    paymentGateway === "zenobank" &&
    hasGatewayCheckoutId &&
    status !== "DELIVERED" &&
    status !== "REFUNDED_CREDIT";
  const canManualZeno =
    paymentGateway === "zenobank" &&
    status !== "DELIVERED" &&
    status !== "REFUNDED_CREDIT" &&
    status !== "CANCELLED";
  const canRetry =
    status === "PAID" ||
    status === "FULFILLING" ||
    status === "PARTIAL" ||
    status === "MANUAL_REVIEW";
  const canRefund = status !== "DELIVERED" && status !== "REFUNDED_CREDIT";

  return (
    <div className="rounded-3xl apple-glass p-6 space-y-5">
      <h2 className="text-base font-black text-white">Acciones de operador</h2>

      <div className="flex flex-wrap gap-3">
        {canSyncZeno && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await syncZenoBankOrderAdminAction(orderId);
                router.refresh();
                if (res.missingCents > 0) {
                  toast.warning(
                    `ZenoBank (${res.liveStatus}): Recibido ${formatCents(res.livePaidCents)} USD · Falta para soltar: ${formatCents(res.missingCents)} USD`,
                  );
                } else {
                  toast.success(
                    `ZenoBank (${res.liveStatus}): Pago completo detectado (${formatCents(res.livePaidCents)} USD). Estado: ${res.nextStatus}`,
                  );
                }
              } catch (err) {
                toast.error(
                  err instanceof Error
                    ? err.message
                    : "Error consultando ZenoBank",
                );
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-100 font-black text-xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
            <span>Verificar pago en ZenoBank</span>
          </button>
        )}

        {canRetry && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const nextStatus = await retryOrderFulfillmentAction(orderId);
                toast.success(`Reintento completado. Estado actual: ${nextStatus}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error al reintentar");
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-sky-300 text-slate-950 font-black text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reintentar entrega</span>
          </button>
        )}

        {needsAttention && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await resolveOrderAttentionAction(orderId);
                toast.success("Marcada como resuelta en consola");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 font-bold text-xs"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Quitar alerta</span>
          </button>
        )}
      </div>

      {canManualZeno && (
        <div className="pt-4 border-t border-white/[0.08] space-y-3">
          <div>
            <div className="text-xs font-bold text-slate-200">
              Conciliar pago manual ZenoBank / Binance Pay
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
              Úsalo si el cliente envió de más o de menos por Binance Pay y ZenoBank dejó el checkout en $0.00. Total esperado:{" "}
              <strong className="text-white">
                {formatCents(amountDueCents)} USD
              </strong>
              . Si cubre el total, suelta el código y acredita excedente; si es menor, registra lo pagado y muestra el faltante.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              inputMode="decimal"
              value={manualUsd}
              onChange={(e) => setManualUsd(e.target.value)}
              placeholder="Monto recibido USD (ej. 1.00)"
              className="sm:w-52 rounded-xl bg-slate-950 border border-white/15 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
            />
            <input
              type="text"
              value={manualTx}
              onChange={(e) => setManualTx(e.target.value)}
              placeholder="ID TX Binance Pay (opcional)"
              className="flex-1 rounded-xl bg-slate-950 border border-white/15 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !manualUsd.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await recordManualZenoPaymentAdminAction({
                    orderId,
                    receivedUsd: manualUsd,
                    txReference: manualTx,
                  });
                  setManualUsd("");
                  setManualTx("");
                  router.refresh();
                  if (res.mode === "fulfilled") {
                    toast.success(
                      res.surplusCents > 0
                        ? `Pago confirmado (${formatCents(res.receivedCents)} USD). Excedente acreditado: ${formatCents(res.surplusCents)} USD. Estado: ${res.nextStatus}`
                        : `Pago confirmado (${formatCents(res.receivedCents)} USD). Estado: ${res.nextStatus}`,
                    );
                  } else if (res.mode === "partial_pending") {
                    toast.warning(
                      `Abono registrado (${formatCents(res.receivedCents)} USD). Falta para soltar el código: ${formatCents(res.missingCents)} USD.`,
                    );
                  } else {
                    toast.success(
                      `Orden expirada: acreditados ${formatCents(res.receivedCents)} USD al saldo del cliente.`,
                    );
                  }
                } catch (err) {
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : "Error registrando pago manual",
                  );
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 text-slate-950 font-black text-xs shrink-0"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Registrar pago manual</span>
            </button>
          </div>
        </div>
      )}

      {canRefund && (
        <div className="pt-4 border-t border-white/[0.08] space-y-3">
          <div className="text-xs font-bold text-slate-200">
            Acreditar monto pendiente a saldo a favor interno
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder="Motivo obligatorio (ej. Proveedor sin stock para variante)"
              className="flex-1 rounded-xl bg-slate-950 border border-white/15 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || reasonNote.trim().length < 5}
              onClick={async () => {
                setBusy(true);
                try {
                  await refundOrderToCreditAction({ orderId, reasonNote });
                  setReasonNote("");
                  toast.success("Saldo a favor acreditado y orden cerrada.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Error al acreditar");
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-black text-xs shrink-0"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Acreditar saldo al cliente</span>
            </button>
          </div>
        </div>
      )}

      {/* Clasificación contable: Orden real vs Prueba interna */}
      <div className="pt-4 border-t border-white/[0.08] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
              <span>Clasificación Contable (Pruebas vs Ventas Reales)</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Las órdenes marcadas como prueba se ocultan de la contabilidad real del dashboard cuando el toggle global está en &quot;Pruebas: Ocultas&quot;.
            </p>
          </div>
          {isTest && (
            <span className="px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-400/35 text-amber-200 text-[10px] font-black uppercase">
              Marcada como Prueba
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="Nota opcional (ej. Prueba inicial FazerCards $14.6)"
            className="flex-1 rounded-xl bg-slate-950 border border-white/15 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await toggleOrderTestFlagAction({
                  orderId,
                  isTest: !isTest,
                  testNote: noteInput,
                });
                toast.success(
                  !isTest
                    ? "Orden marcada como prueba interna."
                    : "Orden restaurada como venta real."
                );
                router.refresh();
              } catch (err) {
                toast.error(
                  err instanceof Error
                    ? err.message
                    : "Error actualizando clasificación"
                );
              } finally {
                setBusy(false);
              }
            }}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs shrink-0 border transition-colors ${
              isTest
                ? "bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-400/35 text-emerald-200"
                : "bg-amber-500/15 hover:bg-amber-500/25 border-amber-400/35 text-amber-200"
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>
              {isTest ? "Restaurar a Venta Real" : "Marcar como Prueba"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
