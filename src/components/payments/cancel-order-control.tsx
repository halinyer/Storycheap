"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RotateCcw, ShoppingCart, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/context/store-context";
import { formatCents } from "@/lib/catalog-seed";
import type { OrderDTO } from "@/types";
import { buildCartEntriesFromOrderItems } from "./payment-helpers";

interface CancelOrderControlProps {
  order: Pick<
    OrderDTO,
    | "id"
    | "orderNumber"
    | "status"
    | "amountDueCents"
    | "creditAppliedCents"
    | "paidCents"
    | "paymentGateway"
    | "items"
  >;
  variant?: "inline" | "hosted-footer";
  tone?: "dark" | "light";
  onCancelled?: (result: {
    order: OrderDTO;
    refundedCreditCents: number;
  }) => void;
}

type ConfirmStage = "idle" | "confirm" | "reported_warning";

export function CancelOrderControl({
  order,
  variant = "inline",
  tone = "dark",
  onCancelled,
}: CancelOrderControlProps) {
  const router = useRouter();
  const { cartItems, addToCart, refreshSession } = useStore();

  const [stage, setStage] = useState<ConfirmStage>("idle");
  const [busyMode, setBusyMode] = useState<"cancel" | "restore" | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);

  const canCancel =
    (order.status === "PENDING_PAYMENT" || order.status === "CREATED") &&
    order.paidCents === 0;

  if (!canCancel) return null;

  const restoreOrderItemsToCart = () => {
    const existingIds = new Set(cartItems.map((c) => c.variantId));
    const entries = buildCartEntriesFromOrderItems(order.items);
    let restoredCount = 0;

    for (const entry of entries) {
      if (!existingIds.has(entry.item.variantId)) {
        addToCart(entry.item, entry.quantity);
        restoredCount += entry.quantity;
      }
    }
    return restoredCount;
  };

  const executeCancel = async (options: {
    forceAfterReport: boolean;
    restoreAndGoCheckout: boolean;
  }) => {
    setBusyMode(options.restoreAndGoCheckout ? "restore" : "cancel");
    try {
      const res = await fetch(
        `/api/orders/${encodeURIComponent(order.id)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            forceAfterReport: options.forceAfterReport,
          }),
        }
      );

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        order?: OrderDTO;
        refundedCreditCents?: number;
      };

      if (!res.ok) {
        if (data.code === "REPORTED_REFERENCE_PENDING") {
          setWarningMsg(
            data.error ??
              "Ya reportaste una referencia bancaria para esta orden. Confirma si deseas cancelarla de todas formas."
          );
          setStage("reported_warning");
          return;
        }
        toast.error(data.error ?? "No se pudo cancelar la orden.");
        return;
      }

      await refreshSession();

      const refundedCents = data.refundedCreditCents ?? 0;
      if (refundedCents > 0) {
        toast.success(
          `Orden cancelada. Reembolsamos ${formatCents(refundedCents)} USD a tu saldo a favor.`
        );
      } else {
        toast.success(`Orden #${order.orderNumber} cancelada.`);
      }

      setStage("idle");
      setWarningMsg(null);

      if (options.restoreAndGoCheckout) {
        restoreOrderItemsToCart();
        router.push("/checkout");
        return;
      }

      if (onCancelled && data.order) {
        onCancelled({
          order: data.order,
          refundedCreditCents: refundedCents,
        });
      } else {
        router.refresh();
      }
    } catch {
      toast.error("Error de conexión al cancelar la orden.");
    } finally {
      setBusyMode(null);
    }
  };

  const isLight = tone === "light";

  if (stage === "idle") {
    if (variant === "hosted-footer") {
      return (
        <div
          className={`pt-4 border-t flex flex-wrap items-center justify-between gap-2 ${
            isLight ? "border-slate-200" : "border-white/[0.08]"
          }`}
        >
          <span
            className={`text-[11px] ${
              isLight ? "text-slate-500" : "text-slate-400"
            }`}
          >
            ¿Cambiaste de opinión?
          </span>
          <button
            type="button"
            onClick={() => setStage("confirm")}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors ${
              isLight
                ? "text-slate-600 hover:text-rose-600"
                : "text-slate-300 hover:text-rose-300"
            }`}
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Cancelar orden</span>
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setStage("confirm")}
        className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
          isLight
            ? "border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 text-slate-700 hover:text-rose-700"
            : "border-white/10 bg-white/[0.03] hover:bg-rose-500/10 hover:border-rose-500/30 text-slate-300 hover:text-rose-200"
        }`}
      >
        <XCircle className="w-3.5 h-3.5" />
        <span>Cancelar orden</span>
      </button>
    );
  }

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 text-left ${
        isLight
          ? "bg-white border-slate-200 shadow-sm"
          : "bg-[#0a0c12] border-white/15"
      }`}
    >
      {stage === "reported_warning" ? (
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            className={`w-4 h-4 shrink-0 mt-0.5 ${
              isLight ? "text-amber-600" : "text-amber-400"
            }`}
          />
          <div className="space-y-1">
            <div
              className={`text-xs font-bold ${
                isLight ? "text-amber-900" : "text-amber-200"
              }`}
            >
              Referencia bancaria reportada
            </div>
            <p
              className={`text-[11px] leading-relaxed ${
                isLight ? "text-amber-800" : "text-amber-100/85"
              }`}
            >
              {warningMsg}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <div
            className={`text-xs font-bold ${
              isLight ? "text-slate-900" : "text-white"
            }`}
          >
            ¿Cancelar la orden #{order.orderNumber}?
          </div>
          <p
            className={`text-[11px] leading-relaxed ${
              isLight ? "text-slate-600" : "text-slate-400"
            }`}
          >
            Se liberarán las gift cards reservadas
            {order.creditAppliedCents > 0
              ? ` y se reembolsarán ${formatCents(order.creditAppliedCents)} USD a tu saldo StoryCheap.`
              : " de inmediato sin cargos."}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={busyMode !== null}
          onClick={() =>
            executeCancel({
              forceAfterReport: stage === "reported_warning",
              restoreAndGoCheckout: false,
            })
          }
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border font-bold text-[11px] transition-colors disabled:opacity-50 ${
            isLight
              ? "bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700"
              : "bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/40 text-rose-200"
          }`}
        >
          {busyMode === "cancel" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <XCircle className="w-3.5 h-3.5" />
          )}
          <span>
            {stage === "reported_warning"
              ? "Sí, cancelar de todas formas"
              : "Confirmar cancelación"}
          </span>
        </button>

        {order.items.length > 0 && (
          <button
            type="button"
            disabled={busyMode !== null}
            onClick={() =>
              executeCancel({
                forceAfterReport: stage === "reported_warning",
                restoreAndGoCheckout: true,
              })
            }
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold text-[11px] transition-colors disabled:opacity-50 ${
              isLight
                ? "bg-[#0a2540] hover:bg-[#163859] text-white"
                : "bg-white text-slate-950 hover:bg-sky-200"
            }`}
          >
            {busyMode === "restore" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShoppingCart className="w-3.5 h-3.5" />
            )}
            <span>Cancelar y editar en checkout</span>
          </button>
        )}

        <button
          type="button"
          disabled={busyMode !== null}
          onClick={() => {
            setStage("idle");
            setWarningMsg(null);
          }}
          className={`inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-colors ${
            isLight
              ? "text-slate-500 hover:text-slate-900"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <RotateCcw className="w-3 h-3" />
          <span>Mantener orden</span>
        </button>
      </div>
    </div>
  );
}
