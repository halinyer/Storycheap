"use client";

import React, { useState } from "react";
import {
  refundOrderToCreditAction,
  resolveOrderAttentionAction,
  retryOrderFulfillmentAction,
} from "@/app/admin/actions";
import type { OrderStatus } from "@/types";
import { CheckCircle2, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";

export function OrderDetailActions({
  orderId,
  status,
  needsAttention,
}: {
  orderId: string;
  status: OrderStatus;
  needsAttention: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [reasonNote, setReasonNote] = useState("");

  const canRetry =
    status === "PAID" || status === "PARTIAL" || status === "MANUAL_REVIEW";
  const canRefund = status !== "DELIVERED" && status !== "REFUNDED_CREDIT";

  return (
    <div className="rounded-3xl apple-glass p-6 space-y-5">
      <h2 className="text-base font-black text-white">Acciones de operador</h2>

      <div className="flex flex-wrap gap-3">
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
    </div>
  );
}
