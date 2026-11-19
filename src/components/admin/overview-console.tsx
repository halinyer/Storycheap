"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/catalog-seed";
import {
  formatBsCents,
  formatBsRate,
  getOrderSnapshot,
  summarizeOrdersMetrics,
} from "@/lib/server/sales-metrics";
import type {
  BsRateAutoSyncPolicy,
  LiveVenezuelaRatesSnapshot,
  OrderDTO,
  SupplierPortfolioRow,
  TreasuryMovementDTO,
  TreasuryPositionSummary,
} from "@/types";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FlaskConical,
  Landmark,
  PackageSearch,
  PlugZap,
  Receipt,
  Smartphone,
  TrendingUp,
  Wallet,
} from "lucide-react";

type PeriodKey = "today" | "7d" | "30d" | "all";

const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string; short: string }> = [
  { key: "today", label: "Hoy", short: "hoy" },
  { key: "7d", label: "7 días", short: "7 días" },
  { key: "30d", label: "30 días", short: "30 días" },
  { key: "all", label: "Histórico", short: "histórico" },
];

function startOfPeriod(period: PeriodKey): number | null {
  if (period === "all") return null;
  const now = new Date();
  if (period === "today") {
    now.setHours(0, 0, 0, 0);
    return now.getTime();
  }
  const days = period === "7d" ? 7 : 30;
  return now.getTime() - days * 86_400_000;
}

export function OverviewConsole({
  orders,
  suppliers,
  position,
  actualItemCostCents,
  matchedBsByOrder,
  bsRateCents,
  includeTestOrders,
  unreviewedPagoMovilCount,
}: {
  orders: OrderDTO[];
  movements?: TreasuryMovementDTO[];
  suppliers: SupplierPortfolioRow[];
  position: TreasuryPositionSummary;
  actualItemCostCents: Record<string, number>;
  matchedBsByOrder: Record<string, number | null>;
  bsRateCents: number | null;
  bsRatePolicy?: BsRateAutoSyncPolicy | null;
  liveRates?: LiveVenezuelaRatesSnapshot | null;
  includeTestOrders: boolean;
  unreviewedPagoMovilCount: number;
  historicalTestCandidateCount?: number;
}) {
  const [period, setPeriod] = useState<PeriodKey>("30d");

  const periodCutoff = useMemo(() => startOfPeriod(period), [period]);

  const periodOrders = useMemo(() => {
    if (!periodCutoff) return orders;
    return orders.filter(
      (o) => new Date(o.createdAt).getTime() >= periodCutoff
    );
  }, [orders, periodCutoff]);

  const periodSummary = useMemo(
    () =>
      summarizeOrdersMetrics(periodOrders, actualItemCostCents, {
        includeTestOrders,
        matchedBsByOrder,
      }),
    [periodOrders, actualItemCostCents, includeTestOrders, matchedBsByOrder]
  );

  const recentOrders = useMemo(
    () =>
      orders
        .filter((o) => includeTestOrders || !o.isTest)
        .slice(0, 8),
    [orders, includeTestOrders]
  );

  const needsAttentionCount = useMemo(
    () => orders.filter((o) => o.needsAttention).length,
    [orders]
  );

  const activeSuppliers = useMemo(
    () => suppliers.filter((s) => s.enabled && s.configured),
    [suppliers]
  );

  const unhealthySuppliers = useMemo(
    () => activeSuppliers.filter((s) => !s.healthy),
    [activeSuppliers]
  );

  const discrepancyAbs = Math.abs(position.suppliersDiscrepancyUsdCents);
  const isBalanced = discrepancyAbs <= 5;
  const periodMeta =
    PERIOD_OPTIONS.find((p) => p.key === period) ?? PERIOD_OPTIONS[2];

  const periodDeliveredCount = useMemo(
    () =>
      periodOrders.filter(
        (o) => (includeTestOrders || !o.isTest) && o.status === "DELIVERED"
      ).length,
    [periodOrders, includeTestOrders]
  );

  return (
    <div className="space-y-6">
      {/* Executive Header */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-400">
              Dirección · Resumen Ejecutivo
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                includeTestOrders
                  ? "bg-amber-500/15 text-amber-200 border-amber-400/30"
                  : "bg-white/[0.05] text-slate-300 border-white/10"
              }`}
            >
              <FlaskConical className="w-2.5 h-2.5" />
              <span>
                {includeTestOrders ? "Incluye pruebas" : "Solo órdenes reales"}
              </span>
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-1">
            Estado General de la Empresa
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Vista ejecutiva por departamento. El cuadre de caja, tasa Bs y movimientos viven en{" "}
            <Link
              href="/admin/treasury"
              className="text-sky-400 hover:text-sky-300 font-semibold"
            >
              Finanzas y Tesorería
            </Link>
            .
          </p>
        </div>

        {/* Clean Period Switcher */}
        <div className="inline-flex items-center rounded-xl bg-slate-950 border border-white/[0.08] p-1">
          {PERIOD_OPTIONS.map((opt) => {
            const active = period === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPeriod(opt.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  active
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Actionable Operational Alerts (Only when needed) */}
      {(needsAttentionCount > 0 ||
        !isBalanced ||
        unhealthySuppliers.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {needsAttentionCount > 0 && (
            <Link
              href="/admin/orders?attention=1"
              className="rounded-xl bg-rose-500/[0.09] hover:bg-rose-500/[0.15] border border-rose-500/30 px-4 py-3 flex items-center justify-between gap-3 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-rose-200 truncate">
                    {needsAttentionCount}{" "}
                    {needsAttentionCount === 1
                      ? "orden requiere atención"
                      : "órdenes requieren atención"}
                  </div>
                  <div className="text-[11px] text-rose-300/80">
                    Ir a Ventas y Operaciones
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-rose-300 shrink-0" />
            </Link>
          )}

          {!isBalanced && (
            <Link
              href="/admin/treasury"
              className="rounded-xl bg-amber-500/[0.09] hover:bg-amber-500/[0.15] border border-amber-500/30 px-4 py-3 flex items-center justify-between gap-3 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-amber-200 truncate">
                    Descuadre de caja: {formatCents(position.suppliersDiscrepancyUsdCents)}
                  </div>
                  <div className="text-[11px] text-amber-300/80">
                    Cuadrar en Finanzas y Tesorería
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-amber-300 shrink-0" />
            </Link>
          )}

          {unhealthySuppliers.length > 0 && (
            <Link
              href="/admin/providers"
              className="rounded-xl bg-amber-500/[0.09] hover:bg-amber-500/[0.15] border border-amber-500/30 px-4 py-3 flex items-center justify-between gap-3 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <PlugZap className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-amber-200 truncate">
                    {unhealthySuppliers.length} proveedor(es) con alerta
                  </div>
                  <div className="text-[11px] text-amber-300/80 truncate">
                    {unhealthySuppliers.map((s) => s.label).join(", ")}
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-amber-300 shrink-0" />
            </Link>
          )}
        </div>
      )}

      {/* 4 Clean Executive KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Ventas ({periodMeta.short})
            </span>
            <TrendingUp className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-black font-mono text-white mt-2">
            {formatCents(periodSummary.revenueCents)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1.5">
            {periodSummary.ordersCount} órdenes liquidadas · Costo{" "}
            {formatCents(periodSummary.costCents)}
          </div>
        </div>

        <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Ganancia Bruta ({periodMeta.short})
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div
            className={`text-2xl font-black font-mono mt-2 ${
              periodSummary.profitCents >= 0 ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {periodSummary.profitCents >= 0 ? "+" : ""}
            {formatCents(periodSummary.profitCents)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1.5">
            Margen {periodSummary.marginPct}% · Neta acumulada{" "}
            {formatCents(position.netBusinessProfitUsdCents)}
          </div>
        </div>

        <Link
          href="/admin/banks"
          className="group rounded-2xl bg-[#0d101b] hover:bg-[#111524] border border-white/[0.08] hover:border-emerald-400/30 p-5 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              En Bancos / Receptoras
            </span>
            <Wallet className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black font-mono text-white mt-2">
            {formatCents(position.totalReceiversUsdCents)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1.5 flex items-center justify-between gap-2">
            <span>
              Binance {formatCents(position.zenobankBalanceUsdCents)} · BDV{" "}
              {formatCents(position.pagomovilBalanceUsdCents)}
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-white shrink-0" />
          </div>
        </Link>

        <Link
          href="/admin/providers"
          className="group rounded-2xl bg-[#0d101b] hover:bg-[#111524] border border-white/[0.08] hover:border-indigo-400/30 p-5 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              En Distribuidores (APIs)
            </span>
            <PlugZap className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-black font-mono text-indigo-200 mt-2">
            {formatCents(position.totalSuppliersUsdCents)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1.5 flex items-center justify-between gap-2">
            <span>
              {activeSuppliers.length} APIs activas · {periodDeliveredCount} entregas
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-white shrink-0" />
          </div>
        </Link>
      </div>

      {/* Department Directory (4 Clean Enterprise Modules) */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-3 px-0.5">
          Departamentos
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Link
            href="/admin/orders"
            className="group rounded-2xl bg-[#0d101b] hover:bg-[#121626] border border-white/[0.08] hover:border-white/20 p-5 flex flex-col justify-between gap-4 transition-all"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/25 text-sky-300 flex items-center justify-center">
                  <Receipt className="w-4 h-4" />
                </span>
                <ArrowUpRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
              </div>
              <h2 className="text-sm font-bold text-white">
                Ventas y Órdenes
              </h2>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Filtra órdenes por estado, pasarela, fecha, proveedor y tipo de entrega.
              </p>
            </div>
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Binance / PM ({periodMeta.short})</span>
              <span className="font-mono font-bold text-white">
                {periodSummary.zenobankCount} / {periodSummary.pagomovilCount}
              </span>
            </div>
          </Link>

          <Link
            href="/admin/banks"
            className="group rounded-2xl bg-[#0d101b] hover:bg-[#121626] border border-white/[0.08] hover:border-white/20 p-5 flex flex-col justify-between gap-4 transition-all"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-300 flex items-center justify-center">
                  <Landmark className="w-4 h-4" />
                </span>
                <ArrowUpRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
              </div>
              <h2 className="text-sm font-bold text-white">
                Bancos y Cuentas
              </h2>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Saldos en Binance USDT y BDV Bs, retiros Binance API, tasa Bs/P2P y extractos.
              </p>
            </div>
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Binance · BDV</span>
              <span className="font-mono font-bold text-white">
                {formatCents(position.zenobankBalanceUsdCents)} ·{" "}
                {formatCents(position.pagomovilBalanceUsdCents)}
              </span>
            </div>
          </Link>

          <Link
            href="/admin/treasury"
            className="group rounded-2xl bg-[#0d101b] hover:bg-[#121626] border border-white/[0.08] hover:border-white/20 p-5 flex flex-col justify-between gap-4 transition-all"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-400/25 text-indigo-300 flex items-center justify-center">
                  <Smartphone className="w-4 h-4" />
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    isBalanced
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-amber-500/15 text-amber-300"
                  }`}
                >
                  {isBalanced ? "Cuadrada" : "Revisar"}
                </span>
              </div>
              <h2 className="text-sm font-bold text-white">
                Tesorería y Movimientos
              </h2>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Capital aportado, reinversiones, retiros de ganancia, cierres y libro diario.
              </p>
            </div>
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px]">
              <span className="text-slate-400">
                {unreviewedPagoMovilCount > 0
                  ? `${unreviewedPagoMovilCount} PM sin revisar`
                  : "Tasa tienda"}
              </span>
              <span className="font-mono font-bold text-white">
                {bsRateCents ? formatBsRate(bsRateCents) : "Sin tasa"}
              </span>
            </div>
          </Link>

          <Link
            href="/admin/providers"
            className="group rounded-2xl bg-[#0d101b] hover:bg-[#121626] border border-white/[0.08] hover:border-white/20 p-5 flex flex-col justify-between gap-4 transition-all"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-400/25 text-purple-300 flex items-center justify-center">
                  <PackageSearch className="w-4 h-4" />
                </span>
                <ArrowUpRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
              </div>
              <h2 className="text-sm font-bold text-white">
                Catálogo y Proveedores
              </h2>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Saldos en vivo de FazerCards y Central One, SKUs, precios y stock CSV.
              </p>
            </div>
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px]">
              <span className="text-slate-400">
                {activeSuppliers.length} APIs activas
              </span>
              <span className="font-mono font-bold text-indigo-300">
                {formatCents(position.totalSuppliersUsdCents)}
              </span>
            </div>
          </Link>
        </div>
      </div>

      {/* Clean Recent Orders Table */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white">
              Últimas Órdenes
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Resumen rápido de ventas recientes. Para filtrar por estado, fecha, pasarela o proveedor entra a Órdenes.
            </p>
          </div>
          <Link
            href="/admin/orders"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white text-slate-200 hover:text-slate-950 text-xs font-bold transition-colors"
          >
            <span>Abrir gestor de órdenes</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {recentOrders.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">
            No hay órdenes registradas todavía.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="px-5 py-3">Orden</th>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3">Total</th>
                  <th className="px-5 py-3">Ganancia</th>
                  <th className="px-5 py-3">Pasarela</th>
                  <th className="px-5 py-3 text-right">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {recentOrders.map((o) => {
                  const snap = getOrderSnapshot(o, actualItemCostCents);
                  const displayBsCents =
                    matchedBsByOrder[o.id] ?? snap.actualBsCents;
                  return (
                    <tr key={o.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3.5">
                        <div className="font-mono font-bold text-white">
                          {o.orderNumber}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {new Date(o.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-200 max-w-[200px] truncate">
                        {o.email}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                            o.needsAttention
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/35"
                              : o.status === "DELIVERED"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-white/[0.06] text-slate-300"
                          }`}
                        >
                          {o.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono font-bold text-white">
                        <div>{formatCents(o.subtotalCents)}</div>
                        {displayBsCents !== null && (
                          <div className="text-[10px] font-normal text-slate-400">
                            {formatBsCents(displayBsCents)}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono font-bold">
                        {snap.profitCents !== null ? (
                          <span
                            className={
                              snap.profitCents >= 0
                                ? "text-emerald-400"
                                : "text-rose-400"
                            }
                          >
                            {snap.profitCents >= 0 ? "+" : ""}
                            {formatCents(snap.profitCents)}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-slate-300 text-[11px] uppercase">
                        {o.paymentGateway === "zenobank"
                          ? "Binance"
                          : o.paymentGateway === "pagomovil"
                            ? "Pago Móvil"
                            : o.paymentGateway}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white text-slate-200 hover:text-slate-950 font-bold text-[11px] transition-colors"
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
