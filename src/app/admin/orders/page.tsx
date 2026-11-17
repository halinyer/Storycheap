import React, { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { formatCents } from "@/lib/catalog-seed";
import { getAdminIncludeTestsPreference } from "@/lib/server/admin-preferences";
import {
  listOrdersAdmin,
  listSupplierItemCostsAdmin,
} from "@/lib/server/repository";
import {
  formatBsCents,
  formatBsRate,
  getOrderSnapshot,
} from "@/lib/server/sales-metrics";
import { AlertTriangle, ArrowRight, FlaskConical } from "lucide-react";

async function AdminOrdersContent({
  searchParams,
}: {
  searchParams: Promise<{ attention?: string; status?: string; scope?: string }>;
}) {
  await connection();
  const sp = await searchParams;
  const attentionOnly = sp.attention === "1";

  const [allOrders, actualItemCostCents, includeTestOrders] = await Promise.all([
    listOrdersAdmin({ needsAttentionOnly: attentionOnly }),
    listSupplierItemCostsAdmin(),
    getAdminIncludeTestsPreference(),
  ]);

  const activeScope: "all" | "real" | "test" =
    sp.scope === "real" || sp.scope === "test" || sp.scope === "all"
      ? sp.scope
      : attentionOnly
        ? "all"
        : includeTestOrders
          ? "all"
          : "real";

  const orders = allOrders.filter((o) => {
    if (activeScope === "real") return !o.isTest;
    if (activeScope === "test") return Boolean(o.isTest);
    return true;
  });

  const testCount = allOrders.filter((o) => o.isTest).length;
  const realCount = allOrders.length - testCount;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Gestión de Órdenes</h1>
          <p className="text-xs text-slate-400 mt-1">
            Revisa entregas, clasifica órdenes de prueba, reintenta fallos o acredita saldo a favor interno.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/orders?scope=real"
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
              !attentionOnly && activeScope === "real"
                ? "bg-white text-slate-950 border-white"
                : "bg-white/[0.04] text-slate-300 border-white/10 hover:text-white"
            }`}
          >
            Reales ({realCount})
          </Link>
          <Link
            href="/admin/orders?scope=test"
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
              !attentionOnly && activeScope === "test"
                ? "bg-amber-400 text-slate-950 border-amber-400"
                : "bg-white/[0.04] text-amber-200 border-amber-500/25 hover:bg-amber-500/15"
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>Pruebas ({testCount})</span>
          </Link>
          <Link
            href="/admin/orders?scope=all"
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
              !attentionOnly && activeScope === "all"
                ? "bg-indigo-500 text-white border-indigo-400"
                : "bg-white/[0.04] text-slate-300 border-white/10 hover:text-white"
            }`}
          >
            Todas ({allOrders.length})
          </Link>
          <Link
            href="/admin/orders?attention=1"
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
              attentionOnly
                ? "bg-rose-500 text-white border-rose-500"
                : "bg-white/[0.04] text-rose-300 border-rose-500/30 hover:bg-rose-500/15"
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Requieren atención</span>
          </Link>
        </div>
      </div>

      <div className="rounded-3xl apple-glass overflow-hidden">
        {orders.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            No hay órdenes registradas con este filtro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="px-5 py-3">Orden</th>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3">Total USD</th>
                  <th className="px-5 py-3">Bs (congelado)</th>
                  <th className="px-5 py-3">Ganancia</th>
                  <th className="px-5 py-3">Pasarela</th>
                  <th className="px-5 py-3 text-right">Inspeccionar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {orders.map((o) => {
                  const snap = getOrderSnapshot(o, actualItemCostCents);
                  return (
                  <tr key={o.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 font-mono font-bold text-white">
                        <span>{o.orderNumber}</span>
                        {o.isTest && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30 font-sans text-[9px] font-black uppercase">
                            Prueba
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {new Date(o.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-200">{o.email}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                            o.needsAttention
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                              : o.status === "DELIVERED"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-white/[0.06] text-slate-200"
                          }`}
                        >
                          {o.status}
                        </span>
                        {o.paidCents > 0 && o.paidCents < o.amountDueCents && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-500/15 border border-amber-500/35 text-amber-300 whitespace-nowrap">
                            Falta {formatCents(o.amountDueCents - o.paidCents)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 font-black text-white">
                      {formatCents(o.subtotalCents)} USD
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {snap.actualBsCents !== null && snap.bsRateCents !== null ? (
                        <div>
                          <div className="font-bold text-white">
                            {formatBsCents(snap.actualBsCents)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            @ {formatBsRate(snap.bsRateCents)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 font-black">
                      {snap.profitCents !== null ? (
                        <span
                          className={
                            snap.profitCents >= 0 ? "text-emerald-400" : "text-rose-400"
                          }
                        >
                          {snap.profitCents >= 0 ? "+" : ""}
                          {formatCents(snap.profitCents)}
                        </span>
                      ) : (
                        <span className="text-slate-500 font-normal">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-300 uppercase">
                      {o.paymentGateway}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white text-white hover:text-slate-950 font-bold text-[11px] transition-colors"
                      >
                        <span>Ver</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ attention?: string; status?: string }>;
}) {
  return (
    <Suspense fallback={<div className="text-xs text-slate-400">Cargando órdenes...</div>}>
      <AdminOrdersContent searchParams={searchParams} />
    </Suspense>
  );
}
