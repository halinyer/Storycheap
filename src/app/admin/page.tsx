import React, { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ReconcileButton } from "@/components/admin/reconcile-button";
import { formatCents } from "@/lib/catalog-seed";
import {
  listCatalog,
  listInventoryAdmin,
  listOrdersAdmin,
  listProviderConfigs,
} from "@/lib/server/repository";
import { getReloadlyBalance } from "@/lib/server/suppliers/reloadly";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileKey2,
  Package,
  PlugZap,
  Receipt,
} from "lucide-react";

async function AdminOverviewContent() {
  await connection();
  const [orders, attentionOrders, catalog, inventory, providers, reloadly] =
    await Promise.all([
      listOrdersAdmin(),
      listOrdersAdmin({ needsAttentionOnly: true }),
      listCatalog(true),
      listInventoryAdmin({ status: "AVAILABLE" }),
      listProviderConfigs(),
      getReloadlyBalance(),
    ]);

  const paidRevenueCents = orders
    .filter((o) => o.status === "DELIVERED" || o.paidCents > 0)
    .reduce((acc, o) => acc + o.subtotalCents, 0);

  const lowStockVariants = catalog.flatMap((p) =>
    p.variants
      .filter((v) => v.active && v.availableStock <= v.lowStockThreshold)
      .map((v) => ({
        productName: p.name,
        variantId: v.id,
        denominationLabel: v.denominationLabel,
        availableStock: v.availableStock,
        threshold: v.lowStockThreshold,
      }))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Resumen Operativo</h1>
          <p className="text-xs text-slate-400 mt-1">
            Control de inventario propio cifrado, órdenes en curso y pasarelas.
          </p>
        </div>
        <ReconcileButton />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-3xl apple-glass p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Órdenes totales</span>
            <Receipt className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-black text-white">{orders.length}</div>
          <div className="text-[11px] text-slate-400">
            Volumen: {formatCents(paidRevenueCents)} USD
          </div>
        </div>

        <div
          className={`rounded-3xl apple-glass p-5 space-y-1 ${
            attentionOrders.length > 0 ? "border border-rose-500/40" : ""
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Requieren atención</span>
            <AlertTriangle
              className={`w-4 h-4 ${
                attentionOrders.length > 0 ? "text-rose-400" : "text-slate-500"
              }`}
            />
          </div>
          <div className="text-2xl font-black text-white">
            {attentionOrders.length}
          </div>
          <Link
            href="/admin/orders?attention=1"
            className="text-[11px] font-bold text-rose-300 hover:underline block"
          >
            Revisar cola →
          </Link>
        </div>

        <div className="rounded-3xl apple-glass p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Códigos CSV disponibles</span>
            <FileKey2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-white">{inventory.length}</div>
          <Link
            href="/admin/inventory"
            className="text-[11px] font-bold text-sky-400 hover:underline block"
          >
            Cargar lote CSV →
          </Link>
        </div>

        <div className="rounded-3xl apple-glass p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Reloadly API</span>
            <PlugZap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-lg font-black text-white">
            {reloadly.configured && reloadly.balanceCents !== null
              ? formatCents(reloadly.balanceCents)
              : "Desactivado (Manual-First)"}
          </div>
          <div className="text-[11px] text-slate-400">
            {providers.find((p) => p.id === "reloadly")?.enabled
              ? "Activo como fallback"
              : "Operando con bóveda propia"}
          </div>
        </div>
      </div>

      {/* Attention Required & Low Stock Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-3xl apple-glass p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-black text-white">
              Órdenes que requieren atención
            </h2>
            <Link
              href="/admin/orders"
              className="text-xs font-bold text-sky-400 hover:text-sky-300"
            >
              Ver todas
            </Link>
          </div>

          {attentionOrders.length === 0 ? (
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-5 flex items-center gap-3 text-xs text-emerald-200">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>Todo en orden. No hay entregas atascadas o pendientes de revisión.</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {attentionOrders.slice(0, 6).map((o) => (
                <Link
                  key={o.id}
                  href={`/admin/orders/${o.id}`}
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 hover:bg-rose-500/15 transition-colors"
                >
                  <div>
                    <div className="text-xs font-black text-white">
                      {o.orderNumber} • {o.email}
                    </div>
                    <div className="text-[11px] text-rose-200 mt-0.5 line-clamp-1">
                      {o.attentionReason ?? o.status}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-rose-300 shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl apple-glass p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-black text-white">
              Alertas de stock bajo
            </h2>
            <Link
              href="/admin/inventory"
              className="text-xs font-bold text-sky-400 hover:text-sky-300"
            >
              Inyectar códigos
            </Link>
          </div>

          {lowStockVariants.length === 0 ? (
            <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-5 flex items-center gap-3 text-xs text-slate-300">
              <Package className="w-5 h-5 text-sky-400 shrink-0" />
              <span>Todas las variantes están por encima de su umbral mínimo.</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {lowStockVariants.slice(0, 8).map((v) => (
                <div
                  key={v.variantId}
                  className="flex items-center justify-between p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-xs"
                >
                  <div>
                    <div className="font-bold text-white">{v.productName}</div>
                    <div className="text-[11px] text-amber-200">
                      {v.denominationLabel} (Umbral: {v.threshold})
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 font-black">
                    {v.availableStock} disp.
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<div className="text-xs text-slate-400">Cargando resumen...</div>}>
      <AdminOverviewContent />
    </Suspense>
  );
}
