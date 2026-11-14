"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { captureMonthlyCapitalSnapshotAction } from "@/app/admin/actions";
import { BsRateCard } from "@/components/admin/bs-rate-card";
import { formatCents } from "@/lib/catalog-seed";
import type { CapitalSnapshotRecord } from "@/lib/server/repository";
import {
  formatBsCents,
  formatBsRate,
  getOrderSnapshot,
} from "@/lib/server/sales-metrics";
import type { OrderDTO } from "@/types";
import {
  AlertTriangle,
  Camera,
  Package,
  Receipt,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

export interface ProviderCapitalCardData {
  id: "centralone" | "fazercards" | "manual" | "reloadly";
  label: string;
  subtitle: string;
  enabled: boolean;
  configured: boolean;
  balanceCents: number | null;
  previousBalanceCents: number | null;
  codesAvailableCount?: number;
}

export interface LowStockVariantAlert {
  productName: string;
  variantId: string;
  denominationLabel: string;
  availableStock: number;
  threshold: number;
}

type PeriodKey = "today" | "7d" | "month" | "all";
type ProviderFilterKey = "all" | "centralone" | "manual" | "reloadly";

const ORDER_STATUS_META: Record<
  OrderDTO["status"],
  { label: string; cls: string }
> = {
  DELIVERED: {
    label: "Entregado",
    cls: "bg-emerald-500/15 text-emerald-300",
  },
  FULFILLING: {
    label: "Procesando",
    cls: "bg-sky-500/15 text-sky-300",
  },
  PAID: {
    label: "Pagado",
    cls: "bg-sky-500/15 text-sky-300",
  },
  PARTIAL: {
    label: "Parcial",
    cls: "bg-amber-500/15 text-amber-300",
  },
  MANUAL_REVIEW: {
    label: "Revisión",
    cls: "bg-rose-500/15 text-rose-300",
  },
  PENDING_PAYMENT: {
    label: "Esperando pago",
    cls: "bg-white/10 text-slate-300",
  },
  CREATED: {
    label: "Creada",
    cls: "bg-white/10 text-slate-300",
  },
  EXPIRED: {
    label: "Expirada",
    cls: "bg-white/5 text-slate-400",
  },
  CANCELLED: {
    label: "Cancelada",
    cls: "bg-white/5 text-slate-400",
  },
  REFUNDED_CREDIT: {
    label: "Reembolsada",
    cls: "bg-violet-500/15 text-violet-300",
  },
};

function getOrderSources(order: OrderDTO): Set<string> {
  return new Set(order.fulfillments.map((f) => f.source));
}

export function OverviewConsole({
  orders,
  attentionCount,
  lowStockVariants,
  providerStatuses,
  initialSnapshots,
  bsRateCents,
}: {
  orders: OrderDTO[];
  attentionCount: number;
  lowStockVariants: LowStockVariantAlert[];
  providerStatuses: ProviderCapitalCardData[];
  initialSnapshots: CapitalSnapshotRecord[];
  bsRateCents: number | null;
}) {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [providerFilter, setProviderFilter] = useState<ProviderFilterKey>("all");
  const [search, setSearch] = useState("");
  const [snapshots, setSnapshots] = useState<CapitalSnapshotRecord[]>(initialSnapshots);
  const [capturing, setCapturing] = useState(false);

  const now = useMemo(() => new Date(), []);
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const previousSnapshot = useMemo(() => {
    const older = snapshots.find((s) => s.month < currentMonthKey);
    return older ?? snapshots[0] ?? null;
  }, [snapshots, currentMonthKey]);

  const periodSinceMs = useMemo(() => {
    const d = new Date(now);
    if (period === "today") {
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    if (period === "7d") {
      return d.getTime() - 7 * 24 * 60 * 60 * 1000;
    }
    if (period === "month") {
      return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
    }
    return 0;
  }, [now, period]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      const ts = Date.parse(order.createdAt);
      if (periodSinceMs > 0 && (!Number.isFinite(ts) || ts < periodSinceMs)) {
        return false;
      }
      if (providerFilter !== "all") {
        if (!getOrderSources(order).has(providerFilter)) return false;
      }
      if (q) {
        const itemsText = order.items
          .map((i) => `${i.productName} ${i.denominationLabel}`)
          .join(" ");
        const haystack = `${order.orderNumber} ${order.email} ${itemsText}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [orders, periodSinceMs, providerFilter, search]);

  const metrics = useMemo(() => {
    let ordersCount = 0;
    let revenueCents = 0;
    let costCents = 0;
    let totalBsCents = 0;
    let bsCovered = 0;

    const byProvider: Record<
      "centralone" | "fazercards" | "manual" | "reloadly",
      { consumedCents: number; profitCents: number; deliveredCodes: number }
    > = {
      centralone: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
      fazercards: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
      manual: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
      reloadly: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
    };

    for (const order of filteredOrders) {
      const snap = getOrderSnapshot(order);
      if (!snap.isSettledSale) continue;

      ordersCount += 1;
      revenueCents += snap.revenueCents;
      if (snap.costCents !== null) costCents += snap.costCents;
      if (snap.totalBsCents !== null) {
        totalBsCents += snap.totalBsCents;
        bsCovered += 1;
      }

      const itemById = new Map(order.items.map((it) => [it.id, it]));
      for (const f of order.fulfillments) {
        const bucket = byProvider[f.source];
        if (!bucket) continue;
        bucket.deliveredCodes += 1;
        const item = itemById.get(f.orderItemId);
        if (item && typeof item.unitCostCents === "number") {
          bucket.consumedCents += item.unitCostCents;
          bucket.profitCents += item.unitPriceCents - item.unitCostCents;
        }
      }
    }

    const profitCents = revenueCents - costCents;
    const marginPct =
      revenueCents > 0 ? ((profitCents / revenueCents) * 100).toFixed(1) : "0.0";

    return {
      ordersCount,
      revenueCents,
      costCents,
      profitCents,
      marginPct,
      totalBsCents,
      bsCovered,
      byProvider,
    };
  }, [filteredOrders]);

  // Only show providers that are active or configured (hides unused noise like unconfigured Reloadly)
  const visibleProviders = useMemo(
    () => providerStatuses.filter((p) => p.enabled || p.configured),
    [providerStatuses]
  );

  const totalLiveCapitalCents = useMemo(
    () =>
      visibleProviders.reduce(
        (sum, p) => sum + (typeof p.balanceCents === "number" ? p.balanceCents : 0),
        0
      ),
    [visibleProviders]
  );

  const capitalDiffCents = previousSnapshot
    ? totalLiveCapitalCents - previousSnapshot.totalCents
    : null;
  const capitalGrowthPct =
    previousSnapshot && previousSnapshot.totalCents > 0 && capitalDiffCents !== null
      ? ((capitalDiffCents / previousSnapshot.totalCents) * 100).toFixed(1)
      : null;

  const handleCaptureSnapshot = async () => {
    setCapturing(true);
    try {
      const updated = await captureMonthlyCapitalSnapshotAction(currentMonthKey);
      setSnapshots(updated);
      toast.success(
        `Foto guardada (${currentMonthKey}): ${formatCents(updated[0]?.totalCents ?? totalLiveCapitalCents)}`
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo guardar la foto de capital"
      );
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Clean Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Resumen Financiero
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Ventas, ganancia neta y capital disponible en distribuidores.
          </p>
        </div>
        <BsRateCard initialRateCents={bsRateCents} />
      </div>

      {/* Compact Alerts only if an issue exists */}
      {(attentionCount > 0 || lowStockVariants.length > 0) && (
        <div className="flex flex-wrap gap-3">
          {attentionCount > 0 && (
            <Link
              href="/admin/orders?attention=1"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>{attentionCount} orden(es) por revisar</span>
            </Link>
          )}
          {lowStockVariants.length > 0 && (
            <Link
              href="/admin/inventory"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
            >
              <Package className="w-3.5 h-3.5 text-amber-400" />
              <span>{lowStockVariants.length} producto(s) con poco stock CSV</span>
            </Link>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center rounded-xl bg-slate-900/90 border border-white/10 p-1">
            {(
              [
                { id: "today", label: "Hoy" },
                { id: "7d", label: "7 días" },
                { id: "month", label: "Este mes" },
                { id: "all", label: "Todo" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPeriod(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  period === opt.id
                    ? "bg-white text-slate-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value as ProviderFilterKey)}
            className="rounded-xl bg-slate-900/90 border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 focus:outline-none"
          >
            <option value="all">Todos los distribuidores</option>
            <option value="centralone">Central One</option>
            <option value="manual">Stock CSV</option>
            <option value="reloadly">Reloadly</option>
          </select>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar orden, cliente o card..."
            className="w-full rounded-xl bg-slate-900/90 border border-white/10 pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-white/25"
          />
        </div>
      </div>

      {/* 4 Crisp KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Ingresos</span>
            <span className="text-slate-300 font-medium">{metrics.ordersCount} ventas</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-white">
            {formatCents(metrics.revenueCents)}
          </div>
          <div className="text-xs text-slate-500">
            {metrics.bsCovered > 0 ? formatBsCents(metrics.totalBsCents) : "Sin cobros en Bs"}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-1">
          <div className="text-xs text-slate-400">Costo de reposición</div>
          <div className="text-2xl font-bold tracking-tight text-white">
            {formatCents(metrics.costCents)}
          </div>
          <div className="text-xs text-slate-500">Saldo consumido en entregas</div>
        </div>

        <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Ganancia limpia</span>
            <span className="text-emerald-400 font-semibold">{metrics.marginPct}%</span>
          </div>
          <div
            className={`text-2xl font-bold tracking-tight ${
              metrics.profitCents >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {metrics.profitCents >= 0 ? "+" : ""}
            {formatCents(metrics.profitCents)}
          </div>
          <div className="text-xs text-slate-500">Margen libre del periodo</div>
        </div>

        <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Capital total</span>
            {capitalGrowthPct !== null && capitalDiffCents !== null && (
              <span
                className={`inline-flex items-center gap-1 font-semibold ${
                  capitalDiffCents >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {capitalDiffCents >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {capitalDiffCents >= 0 ? "+" : ""}
                {capitalGrowthPct}%
              </span>
            )}
          </div>
          <div className="text-2xl font-bold tracking-tight text-white">
            {formatCents(totalLiveCapitalCents)}
          </div>
          <div className="text-xs text-slate-500">
            {previousSnapshot
              ? `Cierre ${previousSnapshot.month}: ${formatCents(previousSnapshot.totalCents)}`
              : "Guarda una foto para comparar meses"}
          </div>
        </div>
      </div>

      {/* Clean Compact Provider Balances Strip */}
      <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Saldos y rendimiento por distribuidor
            </h2>
            <p className="text-xs text-slate-400">
              Capital disponible actual vs. ganancia generada en el periodo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={capturing}
              onClick={() => void handleCaptureSnapshot()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white disabled:opacity-50"
            >
              <Camera className="w-3.5 h-3.5 text-sky-400" />
              <span>{capturing ? "Guardando..." : `Guardar foto (${currentMonthKey})`}</span>
            </button>
            <Link
              href="/admin/providers"
              className="px-3 py-1.5 rounded-lg border border-white/10 text-xs font-medium text-slate-300 hover:text-white"
            >
              Configurar APIs
            </Link>
          </div>
        </div>

        <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
          {visibleProviders.map((prov) => {
            const perf = metrics.byProvider[prov.id];
            const prevBal =
              previousSnapshot?.byProvider?.[prov.id] ?? prov.previousBalanceCents;
            const diff =
              typeof prov.balanceCents === "number" && typeof prevBal === "number"
                ? prov.balanceCents - prevBal
                : null;
            const pct =
              diff !== null && prevBal && prevBal > 0
                ? ((diff / prevBal) * 100).toFixed(1)
                : null;

            return (
              <div
                key={prov.id}
                className="py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs"
              >
                <div className="flex items-center gap-3 min-w-[200px]">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      prov.enabled ? "bg-emerald-400" : "bg-slate-500"
                    }`}
                  />
                  <div>
                    <div className="font-semibold text-white">{prov.label}</div>
                    <div className="text-slate-400">{prov.subtitle}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-8">
                  <div>
                    <div className="text-slate-400">Saldo actual</div>
                    <div className="font-bold text-sm text-white">
                      {prov.balanceCents !== null
                        ? formatCents(prov.balanceCents)
                        : "Sin conectar"}
                      {pct !== null && diff !== null && (
                        <span
                          className={`ml-2 text-xs font-medium ${
                            diff >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          ({diff >= 0 ? "+" : ""}
                          {pct}%)
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-400">Entregado</div>
                    <div className="font-semibold text-slate-200">
                      {perf.deliveredCodes} códs · {formatCents(perf.consumedCents)}
                    </div>
                  </div>

                  <div className="text-right min-w-[90px]">
                    <div className="text-slate-400">Ganancia</div>
                    <div className="font-bold text-emerald-400">
                      +{formatCents(perf.profitCents)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Clean Sales Table */}
      <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Últimas ventas</h2>
          <Link
            href="/admin/orders"
            className="text-xs font-medium text-sky-400 hover:text-sky-300"
          >
            Ver todas →
          </Link>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="p-10 flex items-center justify-center gap-3 text-xs text-slate-400">
            <Receipt className="w-4 h-4 text-slate-500" />
            <span>No hay ventas en este periodo.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400 border-b border-white/[0.06] bg-white/[0.02]">
                <tr>
                  <th className="px-5 py-3 font-medium">Orden</th>
                  <th className="px-5 py-3 font-medium">Gift Card</th>
                  <th className="px-5 py-3 font-medium">Cliente</th>
                  <th className="px-5 py-3 font-medium">Proveedor</th>
                  <th className="px-5 py-3 font-medium text-right">Cobrado</th>
                  <th className="px-5 py-3 font-medium text-right">Ganancia</th>
                  <th className="px-5 py-3 font-medium text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filteredOrders.slice(0, 30).map((order) => {
                  const snap = getOrderSnapshot(order);
                  const statusMeta = ORDER_STATUS_META[order.status];
                  const sources = Array.from(getOrderSources(order));

                  return (
                    <tr key={order.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="font-mono font-semibold text-white hover:text-sky-300"
                        >
                          {order.orderNumber}
                        </Link>
                        <div className="text-slate-500 mt-0.5">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        {order.items.map((it) => (
                          <div key={it.id} className="text-slate-200 font-medium">
                            {it.productName} {it.denominationLabel}
                            {it.quantity > 1 ? ` ×${it.quantity}` : ""}
                          </div>
                        ))}
                      </td>

                      <td className="px-5 py-3.5 text-slate-300">{order.email}</td>

                      <td className="px-5 py-3.5">
                        {sources.length === 0 ? (
                          <span className="text-slate-500">—</span>
                        ) : (
                          sources.map((src) => (
                            <span
                              key={src}
                              className="inline-block mr-1 px-2 py-0.5 rounded-md bg-white/[0.06] text-slate-200 font-medium"
                            >
                              {src === "centralone"
                                ? "Central One"
                                : src === "reloadly"
                                  ? "Reloadly"
                                  : "Stock CSV"}
                            </span>
                          ))
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="font-semibold text-white">
                          {formatCents(snap.revenueCents)}
                        </div>
                        {snap.totalBsCents !== null && snap.bsRateCents !== null && (
                          <div className="text-slate-500 mt-0.5">
                            {formatBsCents(snap.totalBsCents)}
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-right font-semibold">
                        {snap.profitCents !== null && snap.hasAllCosts ? (
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

                      <td className="px-5 py-3.5 text-right">
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded-full font-medium ${statusMeta.cls}`}
                        >
                          {statusMeta.label}
                        </span>
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
