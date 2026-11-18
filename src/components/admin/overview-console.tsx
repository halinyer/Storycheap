"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { BsExchangeDeskCard } from "@/components/admin/bs-exchange-desk-card";
import { SupplierPortfolioList } from "@/components/admin/supplier-portfolio-list";
import {
  TreasuryMovementModal,
  type TreasuryMovementModalPreset,
} from "@/components/admin/treasury-movement-modal";
import { formatCents } from "@/lib/catalog-seed";
import {
  formatBsCents,
  getOrderCashPaidCents,
  getOrderSnapshot,
  summarizeOrdersMetrics,
} from "@/lib/server/sales-metrics";
import type {
  BsRateAutoSyncPolicy,
  LiveVenezuelaRatesSnapshot,
  OrderDTO,
  SupplierPortfolioRow,
  TreasuryMovementDTO,
  TreasuryMovementType,
  TreasuryPositionSummary,
} from "@/types";
import {
  AlertTriangle,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  Bitcoin,
  CheckCircle2,
  CreditCard,
  FlaskConical,
  Plus,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Smartphone,
  TrendingDown,
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

const ACCOUNT_LABELS: Record<string, string> = {
  external: "Externo",
  zenobank: "Binance / Zeno",
  pagomovil: "Pago Móvil",
  fazercards: "FazerCards",
  centralone: "Central One",
  manual: "Stock CSV",
  reloadly: "Reloadly",
  partner_payout: "Retiro Socio",
  expense: "Gasto",
  adjustment: "Ajuste",
};

const MOVEMENT_BADGES: Record<
  TreasuryMovementType,
  { label: string; tone: string }
> = {
  CAPITAL_IN: {
    label: "Aporte Capital",
    tone: "bg-sky-500/15 text-sky-300 border-sky-400/25",
  },
  SUPPLIER_TOPUP: {
    label: "Recarga Prov.",
    tone: "bg-indigo-500/15 text-indigo-300 border-indigo-400/25",
  },
  INTERNAL_TRANSFER: {
    label: "Cambio P2P",
    tone: "bg-cyan-500/15 text-cyan-300 border-cyan-400/25",
  },
  PROFIT_WITHDRAWAL: {
    label: "Retiro Ganancia",
    tone: "bg-emerald-500/15 text-emerald-300 border-emerald-400/25",
  },
  EXPENSE_FEE: {
    label: "Gasto / Fee",
    tone: "bg-amber-500/15 text-amber-300 border-amber-400/25",
  },
  RECONCILIATION_ADJUSTMENT: {
    label: "Ajuste Cuadre",
    tone: "bg-purple-500/15 text-purple-300 border-purple-400/25",
  },
};

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
  movements,
  suppliers,
  position,
  actualItemCostCents,
  matchedBsByOrder,
  bsRateCents,
  bsRatePolicy = null,
  liveRates = null,
  includeTestOrders,
  unreviewedPagoMovilCount,
  historicalTestCandidateCount,
}: {
  orders: OrderDTO[];
  movements: TreasuryMovementDTO[];
  suppliers: SupplierPortfolioRow[];
  position: TreasuryPositionSummary;
  actualItemCostCents: Record<string, number>;
  matchedBsByOrder: Record<string, number | null>;
  bsRateCents: number | null;
  bsRatePolicy?: BsRateAutoSyncPolicy | null;
  liveRates?: LiveVenezuelaRatesSnapshot | null;
  includeTestOrders: boolean;
  unreviewedPagoMovilCount: number;
  historicalTestCandidateCount: number;
}) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [activityTab, setActivityTab] = useState<"orders" | "movements">(
    "orders"
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPreset, setModalPreset] = useState<
    TreasuryMovementModalPreset | undefined
  >(undefined);

  const openModal = (preset?: TreasuryMovementModalPreset) => {
    setModalPreset(preset);
    setModalOpen(true);
  };

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

  const periodSuppliers = useMemo(() => {
    return suppliers.map((s) => {
      const bucket = periodSummary.byProvider[s.id];
      return {
        ...s,
        periodConsumedCents: bucket?.consumedCents ?? 0,
        periodProfitCents: bucket?.profitCents ?? 0,
        periodCodesCount: bucket?.deliveredCodes ?? 0,
      };
    });
  }, [suppliers, periodSummary]);

  const recentOrders = useMemo(() => {
    return orders
      .filter((o) => includeTestOrders || !o.isTest)
      .slice(0, 7);
  }, [orders, includeTestOrders]);

  const recentMovements = useMemo(
    () => movements.filter((m) => !m.voidedAt).slice(0, 7),
    [movements]
  );

  const needsAttentionCount = useMemo(
    () => orders.filter((o) => o.needsAttention).length,
    [orders]
  );

  const activeSuppliersCount = useMemo(
    () => suppliers.filter((s) => s.enabled && s.configured).length,
    [suppliers]
  );

  const discrepancyAbs = Math.abs(position.suppliersDiscrepancyUsdCents);
  const isBalanced = discrepancyAbs <= 5;
  const periodMeta =
    PERIOD_OPTIONS.find((p) => p.key === period) ?? PERIOD_OPTIONS[2];
  const periodDeliveredCodes = useMemo(
    () =>
      Object.values(periodSummary.byProvider).reduce(
        (sum, b) => sum + b.deliveredCodes,
        0
      ),
    [periodSummary]
  );
  const periodAttentionCount = useMemo(
    () => periodOrders.filter((o) => o.needsAttention).length,
    [periodOrders]
  );

  return (
    <div className="space-y-6">
      {/* Enterprise Hero Header */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-400">
            Panel Ejecutivo · Reseller Control
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
            Resumen del Negocio
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Liquidez neta en receptoras, saldo vivo en distribuidores, ganancias
            realizadas vs retiradas y actividad reciente.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() =>
              openModal({
                movementType: "SUPPLIER_TOPUP",
                sourceAccount: "zenobank",
                targetAccount: "fazercards",
              })
            }
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs shadow-[0_6px_22px_rgba(99,102,241,0.35)] transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Reinvertir / Fondear</span>
          </button>

          <Link
            href="/admin/treasury"
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-slate-200 font-semibold text-xs transition-colors"
          >
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tesorería y Cuadre</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Asymmetrical Top Row: At a Glance (8 cols) + Quick Actions (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left: At a Glance Card */}
        <div className="xl:col-span-8 rounded-2xl bg-gradient-to-br from-[#121526] via-[#0d101b] to-[#0b0e18] border border-white/[0.09] p-6 flex flex-col justify-between gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-black tracking-tight text-white">
                  StoryCheap
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
                    {includeTestOrders
                      ? "Incluye órdenes de prueba"
                      : "Solo órdenes reales"}
                  </span>
                </span>
              </div>
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 mt-1">
                Vista General de Caja (En Vivo)
              </div>
            </div>

            {historicalTestCandidateCount > 0 && movements.length === 0 && (
              <Link
                href="/admin/treasury#cuadre-historico"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-200 text-[11px] font-bold transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {historicalTestCandidateCount} órdenes sin conciliar en caja →
                </span>
              </Link>
            )}
          </div>

          {/* 3 Primary At-a-Glance Metric Tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                En Receptoras Netas
              </div>
              <div className="text-2xl font-black font-mono text-white mt-1.5">
                {formatCents(position.totalReceiversUsdCents)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1.5">
                Binance {formatCents(position.zenobankBalanceUsdCents)} · PM{" "}
                {formatCents(position.pagomovilBalanceUsdCents)}
              </div>
            </div>

            <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                En Distribuidores
              </div>
              <div className="text-2xl font-black font-mono text-indigo-200 mt-1.5">
                {formatCents(position.totalSuppliersUsdCents)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1.5">
                {activeSuppliersCount} proveedores activos · Patrimonio{" "}
                {formatCents(position.totalBusinessEquityUsdCents)}
              </div>
            </div>

            <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Ganancia Neta Real
              </div>
              <div
                className={`text-2xl font-black font-mono mt-1.5 ${
                  position.netBusinessProfitUsdCents >= 0
                    ? "text-emerald-300"
                    : "text-rose-300"
                }`}
              >
                {formatCents(position.netBusinessProfitUsdCents)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1.5">
                Sin retirar {formatCents(position.undistributedProfitUsdCents)} ·
                Retirada {formatCents(position.withdrawnProfitUsdCents)}
              </div>
            </div>
          </div>

          {/* Bottom Reconciliation Status Strip */}
          <div
            className={`rounded-xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${
              isBalanced
                ? "bg-emerald-500/[0.08] border-emerald-400/25"
                : "bg-amber-500/[0.09] border-amber-400/30"
            }`}
          >
            <div className="flex items-center gap-3">
              {isBalanced ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              )}
              <div>
                <div
                  className={`text-xs font-bold ${
                    isBalanced ? "text-emerald-200" : "text-amber-200"
                  }`}
                >
                  {isBalanced
                    ? "Caja Cuadrada"
                    : `Descuadre en distribuidores: ${formatCents(position.suppliersDiscrepancyUsdCents)}`}
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5">
                  Capital aportado {formatCents(position.netContributedCapitalUsdCents)} ·
                  Pasivo saldo a favor {formatCents(position.creditLiabilityUsdCents)} ·
                  Patrimonio neto {formatCents(position.netEquityAfterCreditsUsdCents)}
                </div>
              </div>
            </div>

            <Link
              href="/admin/treasury"
              className="px-3.5 py-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.14] border border-white/15 text-xs font-bold text-white transition-colors"
            >
              Auditar / Cuadrar →
            </Link>
          </div>
        </div>

        {/* Right: Quick Actions Stack */}
        <div className="xl:col-span-4 rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 flex flex-col justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white">Acciones Rápidas</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Registra movimientos reales sin salir del panel
            </p>
          </div>

          <div className="space-y-2.5 flex-1 flex flex-col justify-center">
            <button
              type="button"
              onClick={() =>
                openModal({
                  movementType: "SUPPLIER_TOPUP",
                  sourceAccount: "zenobank",
                  targetAccount: "fazercards",
                })
              }
              className="w-full text-left rounded-xl bg-white/[0.03] hover:bg-indigo-500/15 border border-white/[0.07] hover:border-indigo-400/35 px-4 py-3 flex items-center justify-between gap-3 transition-colors group"
            >
              <div>
                <div className="text-xs font-bold text-white">
                  Reinvertir en Distribuidor
                </div>
                <div className="text-[11px] text-slate-400">
                  Mueve Binance / PM hacia FazerCards o Central One
                </div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-indigo-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </button>

            <button
              type="button"
              onClick={() =>
                openModal({
                  movementType: "INTERNAL_TRANSFER",
                  sourceAccount: "pagomovil",
                  targetAccount: "zenobank",
                })
              }
              className="w-full text-left rounded-xl bg-white/[0.03] hover:bg-sky-500/15 border border-white/[0.07] hover:border-sky-400/35 px-4 py-3 flex items-center justify-between gap-3 transition-colors group"
            >
              <div>
                <div className="text-xs font-bold text-white">
                  Registrar Cambio P2P (Bs → USDT)
                </div>
                <div className="text-[11px] text-slate-400">
                  Registra bolívares y diferencial cambiario real
                </div>
              </div>
              <ArrowRightLeft className="w-4 h-4 text-sky-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </button>

            <button
              type="button"
              onClick={() =>
                openModal({
                  movementType: "PROFIT_WITHDRAWAL",
                  sourceAccount: "zenobank",
                  targetAccount: "partner_payout",
                })
              }
              className="w-full text-left rounded-xl bg-white/[0.03] hover:bg-emerald-500/15 border border-white/[0.07] hover:border-emerald-400/35 px-4 py-3 flex items-center justify-between gap-3 transition-colors group"
            >
              <div>
                <div className="text-xs font-bold text-white">
                  Retirar Ganancias / Socios
                </div>
                <div className="text-[11px] text-slate-400">
                  Retira utilidad manteniendo $400+ en operación
                </div>
              </div>
              <Banknote className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </button>

            <div className="grid grid-cols-2 gap-2.5 pt-0.5">
              <Link
                href="/admin/products"
                className="rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.07] px-3.5 py-2.5 flex items-center justify-between gap-2 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">
                    Gift Cards
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    Precios y SKUs
                  </div>
                </div>
                <CreditCard className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </Link>

              <Link
                href="/admin/orders"
                className="rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.07] px-3.5 py-2.5 flex items-center justify-between gap-2 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">
                    Órdenes
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {needsAttentionCount > 0
                      ? `${needsAttentionCount} con alerta`
                      : "Ver historial"}
                  </div>
                </div>
                <ShoppingBag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Period Performance Bar */}
      <section className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white">
              Rendimiento Comercial
            </h2>
            <p className="text-[11px] text-slate-400">
              Ventas, costo de códigos consumidos y margen neto en el período
              seleccionado.
            </p>
          </div>

          <div className="inline-flex items-center rounded-xl bg-white/[0.04] border border-white/[0.08] p-1 gap-1">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPeriod(opt.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  period === opt.key
                    ? "bg-indigo-500 text-white shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>Órdenes Contabilizadas</span>
              <Receipt className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="text-xl font-black font-mono text-white mt-1.5">
              {periodSummary.ordersCount}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {periodDeliveredCodes} códigos entregados ·{" "}
              {periodAttentionCount} en atención
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>Ventas Cobradas</span>
              <TrendingUp className="w-3.5 h-3.5 text-sky-400" />
            </div>
            <div className="text-xl font-black font-mono text-white mt-1.5">
              {formatCents(periodSummary.revenueCents)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              PM {formatBsCents(periodSummary.pagomovilBsCents)} · Zeno{" "}
              {formatCents(periodSummary.zenobankCents)}
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>Costo Stock / APIs</span>
              <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-black font-mono text-amber-200 mt-1.5">
              {formatCents(periodSummary.costCents)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Costo real descontado de distribuidores
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>Utilidad Bruta</span>
              {periodSummary.profitCents >= 0 ? (
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
              )}
            </div>
            <div
              className={`text-xl font-black font-mono mt-1.5 ${
                periodSummary.profitCents >= 0
                  ? "text-emerald-300"
                  : "text-rose-300"
              }`}
            >
              {formatCents(periodSummary.profitCents)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Margen promedio {periodSummary.marginPct}% ({periodMeta.short})
            </div>
          </div>
        </div>
      </section>

      {/* Scalable Distributors List ("hacia abajo") */}
      <SupplierPortfolioList
        suppliers={periodSuppliers}
        totalSuppliersUsdCents={position.totalSuppliersUsdCents}
        periodLabel={periodMeta.short}
        mode="compact"
        onTopup={(s) =>
          openModal({
            movementType: "SUPPLIER_TOPUP",
            sourceAccount: "zenobank",
            targetAccount: s.id,
          })
        }
      />

      {/* Bottom 2-Column Split: Net Receivers + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Net Receivers Snapshot */}
        <section className="lg:col-span-5 rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">
                Receptoras Netas (Hoy)
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Efectivo disponible después de recargas P2P y retiros.
              </p>
            </div>
            <Link
              href="/admin/treasury"
              className="text-xs font-bold text-indigo-300 hover:text-indigo-200 transition-colors shrink-0"
            >
              Conciliar →
            </Link>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-400/25 flex items-center justify-center shrink-0">
                  <Bitcoin className="w-4 h-4 text-amber-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">
                    ZenoBank / Binance (USDT)
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    Cobros USDT {formatCents(position.zenobankSalesGrossUsdCents)}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-black font-mono text-white">
                  {formatCents(position.zenobankBalanceUsdCents)}
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/25 flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4 text-sky-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">
                    Pago Móvil (Bs en Banco)
                  </div>
                  <div className="text-[11px] text-slate-400 truncate font-mono tabular-nums">
                    {position.weightedBookBsRateCents
                      ? `Cobrado a Bs ${(position.weightedBookBsRateCents / 100).toFixed(2)}/$ (congelado)`
                      : "Se congela a la tasa de cada cobro"}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0 font-mono tabular-nums">
                <div className="text-sm font-black text-white">
                  {formatBsCents(position.pagomovilBalanceBsCents)}
                </div>
                <div className="text-[11px] text-sky-300">
                  {position.pagomovilBalanceBsCents > 0
                    ? `Hoy ≈ ${formatCents(position.pagomovilMarkToMarketUsdtCents)} USDT`
                    : formatCents(position.pagomovilBalanceUsdCents)}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-400">
              Diferencial cambiario P2P:{" "}
              <strong
                className={
                  position.exchangeDiffUsdCents >= 0
                    ? "text-emerald-300 font-mono"
                    : "text-amber-300 font-mono"
                }
              >
                {formatCents(position.exchangeDiffUsdCents)}
              </strong>
            </span>
            {unreviewedPagoMovilCount > 0 ? (
              <Link
                href="/admin/pagomovil"
                className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-200 border border-amber-400/25 font-bold"
              >
                {unreviewedPagoMovilCount} PM sin asignar
              </Link>
            ) : (
              <span className="text-emerald-400 font-semibold">
                Notificaciones PM al día
              </span>
            )}
          </div>
        </section>

        {/* Right: Recent Orders or Treasury Movements */}
        <section className="lg:col-span-7 rounded-2xl bg-[#0d101b] border border-white/[0.08] overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">
                Actividad Reciente
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Últimas ventas y asientos de caja registrados
              </p>
            </div>

            <div className="inline-flex rounded-xl bg-white/[0.04] border border-white/[0.08] p-1 gap-1">
              <button
                type="button"
                onClick={() => setActivityTab("orders")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                  activityTab === "orders"
                    ? "bg-indigo-500 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Últimas Ventas
              </button>
              <button
                type="button"
                onClick={() => setActivityTab("movements")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                  activityTab === "movements"
                    ? "bg-indigo-500 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Movimientos de Caja
              </button>
            </div>
          </div>

          <div className="divide-y divide-white/[0.05] flex-1">
            {activityTab === "orders" ? (
              recentOrders.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No hay órdenes visibles con el filtro actual.
                </div>
              ) : (
                recentOrders.map((o) => {
                  const snap = getOrderSnapshot(o, actualItemCostCents);
                  const paidUsd = getOrderCashPaidCents(o, o.subtotalCents);
                  const firstTitle =
                    o.items[0]?.productName ?? "Pedido StoryCheap";
                  const itemExtra =
                    o.items.length > 1 ? ` +${o.items.length - 1}` : "";
                  return (
                    <Link
                      key={o.id}
                      href={`/admin/orders/${o.id}`}
                      className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-indigo-300">
                            #{o.id.slice(0, 8)}
                          </span>
                          <span className="text-xs font-semibold text-white truncate">
                            {firstTitle}
                            {itemExtra}
                          </span>
                          {o.isTest && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30 text-[9px] font-black uppercase">
                              Prueba
                            </span>
                          )}
                          {o.needsAttention && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-200 border border-rose-400/30 text-[9px] font-black uppercase">
                              Atención
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {o.email} · {o.paymentGateway} · {o.status}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-xs font-black font-mono text-white">
                          {formatCents(paidUsd)}
                        </div>
                        <div
                          className={`text-[10px] font-mono ${
                            snap.profitCents !== null && snap.profitCents >= 0
                              ? "text-emerald-300"
                              : snap.profitCents !== null
                                ? "text-rose-300"
                                : "text-slate-500"
                          }`}
                        >
                          {snap.profitCents !== null
                            ? `${snap.profitCents >= 0 ? "+" : ""}${formatCents(snap.profitCents)} neto`
                            : "Sin costo"}
                        </div>
                      </div>
                    </Link>
                  );
                })
              )
            ) : recentMovements.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Aún no has registrado reinversiones, cambios P2P o retiros en la
                bitácora de tesorería.
              </div>
            ) : (
              recentMovements.map((m) => {
                const badge = MOVEMENT_BADGES[m.movementType];
                return (
                  <div
                    key={m.id}
                    className="px-5 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.tone}`}
                        >
                          {badge.label}
                        </span>
                        <span className="text-xs font-semibold text-white">
                          {ACCOUNT_LABELS[m.sourceAccount] ?? m.sourceAccount} →{" "}
                          {ACCOUNT_LABELS[m.targetAccount] ?? m.targetAccount}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        {m.notes || m.reference || m.occurredAt.slice(0, 10)}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs font-black font-mono text-white">
                        {formatCents(m.amountUsdCents)}
                      </div>
                      {m.amountBsCents ? (
                        <div className="text-[10px] font-mono text-sky-300">
                          {formatBsCents(m.amountBsCents)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="px-5 py-3 border-t border-white/[0.06] bg-white/[0.015] flex items-center justify-between text-[11px]">
            <span className="text-slate-500">
              {activityTab === "orders"
                ? `Mostrando últimas ${recentOrders.length}`
                : `Mostrando últimos ${recentMovements.length} asientos activos`}
            </span>
            <Link
              href={activityTab === "orders" ? "/admin/orders" : "/admin/treasury"}
              className="font-bold text-indigo-300 hover:text-indigo-200 transition-colors"
            >
              {activityTab === "orders"
                ? "Ver todas las órdenes →"
                : "Ir a Tesorería completa →"}
            </Link>
          </div>
        </section>
      </div>

      {/* Dedicated, Comfortable Space for Bolívares Rate (+% Cushion) & P2P Balance */}
      <BsExchangeDeskCard
        bsRateCents={bsRateCents}
        initialPolicy={bsRatePolicy}
        initialLiveRates={liveRates}
        position={position}
        onOpenSwapModal={() =>
          openModal({
            movementType: "INTERNAL_TRANSFER",
            sourceAccount: "pagomovil",
            targetAccount: "zenobank",
          })
        }
      />

      {/* Quick Movement Modal */}
      <TreasuryMovementModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        suppliers={suppliers}
        preset={modalPreset}
        receiverBalances={{
          zenobankUsdCents: position.zenobankBalanceUsdCents,
          pagomovilUsdCents: position.pagomovilBalanceUsdCents,
          pagomovilBsCents: position.pagomovilBalanceBsCents,
          weightedBookBsRateCents: position.weightedBookBsRateCents,
          liveP2pRateCents: position.replacementUsdtRateCents,
        }}
      />
    </div>
  );
}
