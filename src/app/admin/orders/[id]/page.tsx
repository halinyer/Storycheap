import React, { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { OrderDetailActions } from "@/components/admin/order-detail-actions";
import { formatCents } from "@/lib/catalog-seed";
import { getOrderById } from "@/lib/server/repository";
import {
  formatBsCents,
  formatBsRate,
  getOrderSnapshot,
} from "@/lib/server/sales-metrics";
import { AlertTriangle, ArrowLeft, Shield } from "lucide-react";

async function AdminOrderDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const order = await getOrderById(id);
  if (!order) notFound();
  const snap = getOrderSnapshot(order);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Volver a Órdenes</span>
      </Link>

      <div className="rounded-3xl apple-glass p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-mono text-slate-400">
              {order.orderNumber} • ID: {order.id}
            </div>
            <h1 className="text-2xl font-black text-white mt-1">
              {order.email}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Gateway: {order.paymentGateway.toUpperCase()} • Checkout ID:{" "}
              {order.gatewayCheckoutId ?? "N/A"}
            </p>
          </div>

          <span className="px-3.5 py-1.5 rounded-xl bg-white/[0.08] border border-white/15 text-xs font-black text-white">
            {order.status}
          </span>
        </div>

        {order.needsAttention && (
          <div className="rounded-2xl bg-rose-500/15 border border-rose-500/35 p-4 flex items-start gap-3 text-xs text-rose-100">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <span className="font-black block">Motivo de alerta:</span>
              <span>{order.attentionReason ?? "Revisión operativa requerida"}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Subtotal</span>
            <span className="font-black text-white text-sm">
              {formatCents(order.subtotalCents)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Crédito aplicado</span>
            <span className="font-black text-emerald-400 text-sm">
              {formatCents(order.creditAppliedCents)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Total esperado</span>
            <span className="font-black text-white text-sm">
              {formatCents(order.amountDueCents)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Pagado verificado</span>
            <span className="font-black text-sky-400 text-sm">
              {formatCents(order.paidCents)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Fotografía en Bs</span>
            <span className="font-black text-white text-sm">
              {snap.totalBsCents !== null && snap.bsRateCents !== null
                ? `${formatBsCents(snap.totalBsCents)} (${formatBsRate(snap.bsRateCents)})`
                : "Sin tasa registrada"}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Costo códigos</span>
            <span className="font-black text-slate-200 text-sm">
              {snap.costCents !== null ? formatCents(snap.costCents) : "Sin costo"}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Ganancia estimada</span>
            <span
              className={`font-black text-sm ${
                snap.profitCents !== null && snap.profitCents < 0
                  ? "text-rose-400"
                  : "text-emerald-400"
              }`}
            >
              {snap.profitCents !== null ? formatCents(snap.profitCents) : "—"}
            </span>
          </div>
        </div>
      </div>

      <OrderDetailActions
        orderId={order.id}
        status={order.status}
        needsAttention={order.needsAttention}
      />

      {/* Fulfillments (Privacy Enforced: Last 4 Chars Only) */}
      <div className="rounded-3xl apple-glass p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-white">
            Entregas registradas ({order.fulfillments.length})
          </h2>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-300 font-bold">
            <Shield className="w-3.5 h-3.5" />
            Privacidad: PINs ocultos para admin
          </span>
        </div>

        {order.fulfillments.length === 0 ? (
          <p className="text-xs text-slate-400">
            Aún no hay códigos asignados a esta orden.
          </p>
        ) : (
          <div className="space-y-2">
            {order.fulfillments.map((f) => (
              <div
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-4 p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-xs"
              >
                <div>
                  <div className="font-bold text-white">
                    {f.productName} ({f.denominationLabel})
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Origen: <span className="uppercase">{f.source}</span> •
                    Revelado por cliente:{" "}
                    {f.revealedAt
                      ? new Date(f.revealedAt).toLocaleString()
                      : "Pendiente"}
                  </div>
                </div>
                <span className="font-mono font-bold text-slate-200 bg-slate-950 px-3 py-1.5 rounded-lg border border-white/10">
                  ••••-{f.codeLast4}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<div className="text-xs text-slate-400">Cargando detalle...</div>}>
      <AdminOrderDetailContent params={params} />
    </Suspense>
  );
}
