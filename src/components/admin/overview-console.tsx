"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { captureMonthlyCapitalSnapshotAction } from "@/app/admin/actions";
import { ApiAuditSection } from "@/components/admin/api-audit-section";
import { BsRateCard } from "@/components/admin/bs-rate-card";
import {
  ReceiverLedgersSection,
  type MatchedPagoMovilSummary,
} from "@/components/admin/receiver-ledgers-section";
import { formatCents } from "@/lib/catalog-seed";
import type {
  CapitalSnapshotRecord,
  ZenoBinanceReceiverDTO,
  ZenoPaymentProofDTO,
} from "@/lib/server/repository";
import {
  formatBsCents,
  getOrderSnapshot,
  resolveFulfillmentProvider,
  type EffectiveProviderId,
} from "@/lib/server/sales-metrics";
import type { CentralOneOrdersReport } from "@/lib/server/suppliers/centralone";
import type {
  FazerCardsApiOrderSummary,
  SupplierOrdersReport,
} from "@/lib/server/suppliers/fazercards";
import type { OrderDTO, ReceiverBankAccountDTO } from "@/types";
import {
  AlertTriangle,
  ArrowUpRight,
  Bitcoin,
  Camera,
  CheckCircle2,
  Clock3,
  Landmark,
  Layers,
  Package,
  Receipt,
  Search,
  ShieldCheck,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

export interface ProviderCapitalCardData {
  id: "centralone" | "fazercards" | "manual" | "reloadly";
  label: string;
  subtitle: string;
  enabled: boolean;
  configured: boolean;
  healthy?: boolean;
  errorMessage?: string;
  balanceCents: number | null;
  previousBalanceCents: number | null;
  codesAvailableCount?: number;
  apiSpentCents?: number | null;
  apiOrdersCount?: number | null;
}

export interface LowStockVariantAlert {
  productName: string;
  variantId: string;
  denominationLabel: string;
  availableStock: number;
  threshold: number;
}

export interface CreditHolderSummary {
  id: string;
  email: string;
  creditBalanceCents: number;
  ordersCount: number;
}

type PeriodKey = "today" | "7d" | "month" | "all";
type ProviderFilterKey = "all" | "fazercards" | "centralone" | "manual" | "reloadly";
type StatusFilterKey = "all" | "settled" | "pending" | "attention";
type WorkspaceTabKey = "sales" | "receivers" | "credits" | "audit";

const EMPTY_COST_MAP: Record<string, number> = {};

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

const PROVIDER_LABELS: Record<EffectiveProviderId, string> = {
  fazercards: "FazerCards",
  centralone: "Central One",
  reloadly: "Reloadly",
  manual: "Stock CSV",
};

export function getOrderEffectiveProviders(
  order: OrderDTO,
  fallbackProviders?: EffectiveProviderId[]
): EffectiveProviderId[] {
  const seen = new Set<EffectiveProviderId>();
  for (const f of order.fulfillments) {
    seen.add(resolveFulfillmentProvider(f));
  }
  if (seen.size === 0 && fallbackProviders) {
    for (const provider of fallbackProviders) {
      seen.add(provider);
    }
  }
  return Array.from(seen);
}

function summarizeOrdersMetrics(
  list: OrderDTO[],
  costOverrides: Record<string, number>
) {
  let ordersCount = 0;
  let revenueCents = 0;
  let costCents = 0;
  let totalBsCents = 0;
  let bsCovered = 0;
  let zenobankCents = 0;
  let zenobankCount = 0;
  let pagomovilCents = 0;
  let pagomovilBsCents = 0;
  let pagomovilCount = 0;
  let creditAppliedCents = 0;
  let creditAppliedCount = 0;
  let pendingCents = 0;
  let pendingCount = 0;

  const byProvider: Record<
    EffectiveProviderId,
    { consumedCents: number; profitCents: number; deliveredCodes: number }
  > = {
    fazercards: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
    centralone: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
    manual: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
    reloadly: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
  };

  for (const order of list) {
    if (order.status === "PENDING_PAYMENT" || order.status === "CREATED") {
      pendingCount += 1;
      pendingCents += order.amountDueCents;
    }

    const snap = getOrderSnapshot(order, costOverrides);
    if (!snap.isSettledSale) continue;

    ordersCount += 1;
    revenueCents += snap.revenueCents;
    if (snap.costCents !== null) costCents += snap.costCents;
    if (snap.actualBsCents !== null) {
      totalBsCents += snap.actualBsCents;
      bsCovered += 1;
    }

    if (order.creditAppliedCents > 0) {
      creditAppliedCents += order.creditAppliedCents;
      creditAppliedCount += 1;
    }

    const cashPaidCents =
      order.paidCents > 0
        ? order.paidCents
        : Math.max(0, snap.revenueCents - order.creditAppliedCents);

    if (cashPaidCents > 0) {
      if (order.paymentGateway === "pagomovil" || order.paymentGateway === "pablito") {
        pagomovilCount += 1;
        pagomovilCents += cashPaidCents;
        if (snap.actualBsCents !== null) pagomovilBsCents += snap.actualBsCents;
      } else {
        zenobankCount += 1;
        zenobankCents += cashPaidCents;
      }
    }

    const itemById = new Map(order.items.map((it) => [it.id, it]));
    for (const f of order.fulfillments) {
      const providerKey = resolveFulfillmentProvider(f);
      const bucket = byProvider[providerKey];
      if (!bucket) continue;
      bucket.deliveredCodes += 1;
      const item = itemById.get(f.orderItemId);
      const realUnitCost =
        costOverrides[f.orderItemId] ??
        (item && typeof item.unitCostCents === "number" ? item.unitCostCents : null);
      if (item && realUnitCost !== null) {
        bucket.consumedCents += realUnitCost;
        bucket.profitCents += item.unitPriceCents - realUnitCost;
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
    zenobankCents,
    zenobankCount,
    pagomovilCents,
    pagomovilBsCents,
    pagomovilCount,
    creditAppliedCents,
    creditAppliedCount,
    pendingCents,
    pendingCount,
    byProvider,
  };
}

const EMPTY_FALLBACK_PROVIDERS: Record<string, EffectiveProviderId[]> = {};

export function OverviewConsole({
  orders,
  attentionCount,
  lowStockVariants,
  providerStatuses,
  initialSnapshots,
  bsRateCents,
  creditHolders = [],
  zenoConfigured = false,
  initialZenoReceiver = null,
  zenoProofs = {},
  activePagoMovilAccount = null,
  matchedPagoMovilByOrder = {},
  actualItemCostCents = EMPTY_COST_MAP,
  fazerOrdersReport = null,
  centralOneOrdersReport = null,
  fallbackProvidersByOrder = EMPTY_FALLBACK_PROVIDERS,
}: {
  orders: OrderDTO[];
  attentionCount: number;
  lowStockVariants: LowStockVariantAlert[];
  providerStatuses: ProviderCapitalCardData[];
  initialSnapshots: CapitalSnapshotRecord[];
  bsRateCents: number | null;
  creditHolders?: CreditHolderSummary[];
  zenoConfigured?: boolean;
  initialZenoReceiver?: ZenoBinanceReceiverDTO | null;
  zenoProofs?: Record<string, ZenoPaymentProofDTO>;
  activePagoMovilAccount?: ReceiverBankAccountDTO | null;
  matchedPagoMovilByOrder?: Record<string, MatchedPagoMovilSummary>;
  actualItemCostCents?: Record<string, number>;
  fazerOrdersReport?: SupplierOrdersReport<FazerCardsApiOrderSummary> | null;
  centralOneOrdersReport?: CentralOneOrdersReport | null;
  fallbackProvidersByOrder?: Record<string, EffectiveProviderId[]>;
}) {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [providerFilter, setProviderFilter] = useState<ProviderFilterKey>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("all");
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>("sales");
  const [search, setSearch] = useState("");
  const [snapshots, setSnapshots] = useState<CapitalSnapshotRecord[]>(initialSnapshots);
  const [capturing, setCapturing] = useState(false);

  const now = useMemo(() => new Date(), []);
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Never fall back to a same-month or $0 placeholder snapshot
  const previousSnapshot = useMemo(() => {
    return (
      snapshots.find((s) => s.month < currentMonthKey && s.totalCents > 0) ?? null
    );
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

  const periodOrders = useMemo(() => {
    if (periodSinceMs <= 0) return orders;
    return orders.filter((order) => {
      const ts = Date.parse(order.createdAt);
      return Number.isFinite(ts) && ts >= periodSinceMs;
    });
  }, [orders, periodSinceMs]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return periodOrders.filter((order) => {
      if (providerFilter !== "all") {
        const effectiveSources = getOrderEffectiveProviders(
          order,
          fallbackProvidersByOrder[order.id]
        );
        if (!effectiveSources.includes(providerFilter)) return false;
      }
      if (statusFilter === "settled") {
        if (!getOrderSnapshot(order, actualItemCostCents).isSettledSale) return false;
      } else if (statusFilter === "pending") {
        if (order.status !== "PENDING_PAYMENT" && order.status !== "CREATED") {
          return false;
        }
      } else if (statusFilter === "attention") {
        if (!order.needsAttention) return false;
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
  }, [
    periodOrders,
    providerFilter,
    statusFilter,
    search,
    actualItemCostCents,
    fallbackProvidersByOrder,
  ]);

  const periodMetrics = useMemo(
    () => summarizeOrdersMetrics(periodOrders, actualItemCostCents),
    [periodOrders, actualItemCostCents]
  );

  const metrics = useMemo(
    () => summarizeOrdersMetrics(filteredOrders, actualItemCostCents),
    [filteredOrders, actualItemCostCents]
  );

  const allTimeMetrics = useMemo(
    () => summarizeOrdersMetrics(orders, actualItemCostCents),
    [orders, actualItemCostCents]
  );

  const detectedZenoReceiver = useMemo(() => {
    const proofs = Object.values(zenoProofs).sort((a, b) =>
      b.processedAt.localeCompare(a.processedAt)
    );
    for (const p of proofs) {
      for (const tx of p.transactions) {
        const dest = (tx.to || tx.toLabel || "").trim();
        if (dest) return dest;
      }
    }
    return null;
  }, [zenoProofs]);

  const totalCreditLiabilityCents = useMemo(
    () => creditHolders.reduce((sum, h) => sum + h.creditBalanceCents, 0),
    [creditHolders]
  );

  const visibleProviders = useMemo(
    () =>
      providerStatuses.filter((p) => {
        if (p.id === "manual") {
          return p.enabled || (p.balanceCents ?? 0) > 0 || (p.codesAvailableCount ?? 0) > 0;
        }
        return p.enabled || p.configured;
      }),
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

  const fazerCard = providerStatuses.find((p) => p.id === "fazercards");
  const centralOneCard = providerStatuses.find((p) => p.id === "centralone");
  const manualCard = providerStatuses.find((p) => p.id === "manual");

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

  const renderPlatformCard = (
    card: ProviderCapitalCardData | undefined,
    accentBorder: string,
    accentDot: string
  ) => {
    if (!card) return null;
    const periodPerf = periodMetrics.byProvider[card.id];
    const allTimePerf = allTimeMetrics.byProvider[card.id];
    const isHealthy = card.healthy ?? card.balanceCents !== null;

    return (
      <div
        className={`rounded-2xl bg-slate-900/80 border ${accentBorder} p-5 flex flex-col justify-between gap-4`}
      >
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${accentDot}`} />
                <h2 className="text-sm font-bold text-white">{card.label}</h2>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{card.subtitle}</p>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                !card.configured
                  ? "bg-white/10 text-slate-400"
                  : isHealthy
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-rose-500/15 text-rose-300"
              }`}
            >
              {!card.configured
                ? "No configurada"
                : isHealthy
                  ? "Saldo en vivo"
                  : "Error API"}
            </span>
          </div>

          <div className="pt-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Saldo disponible
            </div>
            <div className="text-3xl font-black tracking-tight text-white mt-0.5">
              {card.balanceCents !== null ? formatCents(card.balanceCents) : "Sin respuesta"}
            </div>
          </div>

          {!isHealthy && card.errorMessage && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/25 px-2.5 py-1.5 text-[11px] text-rose-200">
              {card.errorMessage}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-white/[0.06] text-xs">
          <div>
            <div className="text-[11px] text-slate-400">Consumido real (API)</div>
            <div className="font-bold text-slate-100 mt-0.5">
              {typeof card.apiSpentCents === "number"
                ? formatCents(card.apiSpentCents)
                : formatCents(allTimePerf.consumedCents)}
            </div>
            <div className="text-[10px] text-slate-500">
              {typeof card.apiOrdersCount === "number"
                ? `${card.apiOrdersCount} órd. en proveedor`
                : `${allTimePerf.deliveredCodes} cód. histórico`}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-slate-400">En periodo / Ganancia</div>
            <div className="font-bold text-white mt-0.5">
              {formatCents(periodPerf.consumedCents)}
            </div>
            <div
              className={`text-[10px] font-semibold ${
                periodPerf.profitCents >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {periodPerf.profitCents >= 0 ? "+" : ""}
              {formatCents(periodPerf.profitCents)} · {periodPerf.deliveredCodes} cód.
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Centro Financiero y Saldos
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Saldos reales de FazerCards, Central One, Binance/ZenoBank y Pago Móvil sin datos mezclados.
          </p>
        </div>
        <BsRateCard initialRateCents={bsRateCents} />
      </div>

      {/* Urgent Action Pills */}
      {(attentionCount > 0 || lowStockVariants.length > 0) && (
        <div className="flex flex-wrap gap-2.5">
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

      {/* TOP LIVE STRIP: Both Platforms + Net Cash & Receivers side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {renderPlatformCard(
          fazerCard,
          "border-amber-500/25",
          "bg-amber-400"
        )}
        {renderPlatformCard(
          centralOneCard,
          "border-sky-500/25",
          "bg-sky-400"
        )}

        {/* Card 3: Total Plataformas + Receptoras + Créditos */}
        <div className="rounded-2xl bg-slate-900/80 border border-emerald-500/25 p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-bold text-white">
                    Capital en APIs y Receptoras
                  </h2>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Suma en vivo de distribuidores activos
                </p>
              </div>
              <button
                type="button"
                disabled={capturing}
                onClick={() => void handleCaptureSnapshot()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] font-semibold text-white disabled:opacity-50 shrink-0"
              >
                <Camera className="w-3 h-3 text-sky-400" />
                <span>{capturing ? "..." : "Foto mes"}</span>
              </button>
            </div>

            <div className="pt-1 flex items-baseline justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400">
                  Saldo total disponible
                </div>
                <div className="text-3xl font-black tracking-tight text-emerald-400 mt-0.5">
                  {formatCents(totalLiveCapitalCents)}
                </div>
              </div>
              {manualCard &&
                (manualCard.enabled ||
                  (manualCard.balanceCents ?? 0) > 0 ||
                  (manualCard.codesAvailableCount ?? 0) > 0) && (
                  <span className="text-[11px] text-slate-400">
                    CSV: {formatCents(manualCard.balanceCents ?? 0)}
                  </span>
                )}
            </div>
          </div>

          <div className="space-y-1.5 pt-3 border-t border-white/[0.06] text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400 truncate flex items-center gap-1.5">
                <Bitcoin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">
                  Binance Pay{" "}
                  {initialZenoReceiver?.binanceAccount || detectedZenoReceiver
                    ? `(${initialZenoReceiver?.binanceAccount || detectedZenoReceiver})`
                    : "(ZenoBank)"}
                </span>
              </span>
              <span className="font-bold text-white shrink-0">
                {formatCents(allTimeMetrics.zenobankCents)} ({allTimeMetrics.zenobankCount})
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400 truncate flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>
                  {activePagoMovilAccount
                    ? `Pago Móvil (${activePagoMovilAccount.bankName})`
                    : "Pago Móvil (Bs)"}
                </span>
              </span>
              <span className="font-bold text-sky-300 shrink-0">
                {formatBsCents(allTimeMetrics.pagomovilBsCents)} ·{" "}
                {formatCents(allTimeMetrics.pagomovilCents)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                <span>Créditos clientes</span>
              </span>
              <span className="font-bold text-violet-300 shrink-0">
                {formatCents(totalCreditLiabilityCents)} ({creditHolders.length})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Period + Filters Bar */}
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
            <option value="fazercards">FazerCards</option>
            <option value="centralone">Central One</option>
            <option value="manual">Stock CSV</option>
            <option value="reloadly">Reloadly</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilterKey)}
            className="rounded-xl bg-slate-900/90 border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 focus:outline-none"
          >
            <option value="all">Todos los estados</option>
            <option value="settled">Solo cobradas</option>
            <option value="pending">Abiertas / Esperando pago</option>
            <option value="attention">Requieren atención</option>
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

      {/* 4 Accurate KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Ventas cobradas</span>
            <span className="text-slate-300 font-medium">{metrics.ordersCount} ventas</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-white">
            {formatCents(metrics.revenueCents)}
          </div>
          <div className="text-xs text-slate-400">
            {metrics.bsCovered > 0
              ? `${formatBsCents(metrics.totalBsCents)} cobrados en Bs`
              : "100% cobrado en USD / USDT"}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-1">
          <div className="text-xs text-slate-400">Costo real en APIs</div>
          <div className="text-2xl font-bold tracking-tight text-white">
            {formatCents(metrics.costCents)}
          </div>
          <div className="text-xs text-slate-400">
            Fazer {formatCents(metrics.byProvider.fazercards.consumedCents)} · C1{" "}
            {formatCents(metrics.byProvider.centralone.consumedCents)}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Ganancia limpia real</span>
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
          <div className="text-xs text-slate-400">Sobre ventas liquidadas</div>
        </div>

        <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Capital neto operativo</span>
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
            {formatCents(totalLiveCapitalCents - totalCreditLiabilityCents)}
          </div>
          <div className="text-xs text-slate-400">
            {totalCreditLiabilityCents > 0
              ? `APIs ${formatCents(totalLiveCapitalCents)} − Créditos ${formatCents(totalCreditLiabilityCents)}`
              : previousSnapshot
                ? `Cierre ${previousSnapshot.month}: ${formatCents(previousSnapshot.totalCents)}`
                : `APIs ${formatCents(totalLiveCapitalCents)} · Sin pasivo en créditos`}
          </div>
        </div>
      </div>

      {/* Clean Tabbed Workspace */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] pb-3">
          {(
            [
              {
                id: "sales",
                label: `Ventas y Márgenes (${filteredOrders.length})`,
                icon: Receipt,
              },
              {
                id: "receivers",
                label: "Receptoras: Binance / Bs",
                icon: Landmark,
              },
              {
                id: "credits",
                label: `Créditos y Pendientes (${creditHolders.length})`,
                icon: Wallet,
              },
              {
                id: "audit",
                label: "Auditoría APIs",
                icon: Layers,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
                  active
                    ? "bg-white text-slate-950"
                    : "bg-slate-900/80 text-slate-300 border border-white/10 hover:text-white hover:bg-slate-800/80"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: Ventas y Margenes */}
        {activeTab === "sales" && (
          <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                Detalle de ventas, proveedor real y margen neto
              </h2>
              <Link
                href="/admin/orders"
                className="text-xs font-medium text-sky-400 hover:text-sky-300"
              >
                Ir a Órdenes →
              </Link>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="p-10 flex items-center justify-center gap-3 text-xs text-slate-400">
                <Receipt className="w-4 h-4 text-slate-500" />
                <span>No hay órdenes con estos filtros.</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400 border-b border-white/[0.06] bg-white/[0.02]">
                    <tr>
                      <th className="px-5 py-3 font-medium">Orden</th>
                      <th className="px-5 py-3 font-medium">Gift Card</th>
                      <th className="px-5 py-3 font-medium">Cliente</th>
                      <th className="px-5 py-3 font-medium">Proveedor real</th>
                      <th className="px-5 py-3 font-medium text-right">Cobro</th>
                      <th className="px-5 py-3 font-medium text-right">Costo API</th>
                      <th className="px-5 py-3 font-medium text-right">Ganancia</th>
                      <th className="px-5 py-3 font-medium text-right">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {filteredOrders.slice(0, 40).map((order) => {
                      const snap = getOrderSnapshot(order, actualItemCostCents);
                      const statusMeta = ORDER_STATUS_META[order.status];
                      const sources = getOrderEffectiveProviders(
                        order,
                        fallbackProvidersByOrder[order.id]
                      );
                      const zenoTx = zenoProofs[order.id]?.transactions?.[0];
                      const isBsOrder =
                        order.paymentGateway === "pagomovil" ||
                        order.paymentGateway === "pablito";

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
                                  className={`inline-block mr-1 px-2 py-0.5 rounded-md font-semibold ${
                                    src === "fazercards"
                                      ? "bg-amber-500/15 text-amber-300"
                                      : src === "centralone"
                                        ? "bg-sky-500/15 text-sky-300"
                                        : "bg-white/[0.06] text-slate-200"
                                  }`}
                                >
                                  {PROVIDER_LABELS[src]}
                                </span>
                              ))
                            )}
                          </td>

                          <td className="px-5 py-3.5 text-right">
                            <div className="font-semibold text-white">
                              {formatCents(snap.revenueCents)}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {order.creditAppliedCents > 0 && order.amountDueCents === 0
                                ? "Créditos"
                                : isBsOrder
                                  ? snap.actualBsCents !== null
                                    ? `Pago Móvil · ${formatBsCents(snap.actualBsCents)}`
                                    : "Pago Móvil"
                                  : zenoTx?.to
                                    ? `ZenoBank · Pay ${zenoTx.to}`
                                    : "ZenoBank USDT"}
                              {order.creditAppliedCents > 0 && order.amountDueCents > 0
                                ? ` + ${formatCents(order.creditAppliedCents)} créd.`
                                : ""}
                            </div>
                          </td>

                          <td className="px-5 py-3.5 text-right text-slate-300">
                            {snap.costCents !== null && snap.hasAllCosts
                              ? formatCents(snap.costCents)
                              : "—"}
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
        )}

        {/* TAB 2: Receptoras Binance / Pago Movil */}
        {activeTab === "receivers" && (
          <ReceiverLedgersSection
            allOrders={orders}
            filteredOrders={filteredOrders}
            zenoConfigured={zenoConfigured}
            initialZenoReceiver={initialZenoReceiver}
            zenoProofs={zenoProofs}
            activePagoMovilAccount={activePagoMovilAccount}
            matchedPagoMovilByOrder={matchedPagoMovilByOrder}
            actualItemCostCents={actualItemCostCents}
          />
        )}

        {/* TAB 3: Creditos y Flujo */}
        {activeTab === "credits" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-sky-400" />
                  <span>¿Dónde entró el dinero?</span>
                </h2>
                <span className="text-[11px] text-slate-400">Según filtro actual</span>
              </div>

              <div className="divide-y divide-white/[0.06] text-xs">
                <div className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">
                      ZenoBank → Binance{" "}
                      {initialZenoReceiver?.binanceAccount || detectedZenoReceiver
                        ? `(${initialZenoReceiver?.binanceAccount || detectedZenoReceiver})`
                        : "(USDT)"}
                    </div>
                    <div className="text-slate-400">
                      {metrics.zenobankCount} órdenes cobradas
                    </div>
                  </div>
                  <div className="text-right font-bold text-white">
                    {formatCents(metrics.zenobankCents)}
                  </div>
                </div>

                <div className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">
                      Bancamiga / Pago Móvil (Bs)
                    </div>
                    <div className="text-slate-400">
                      {metrics.pagomovilCount} órdenes ·{" "}
                      {metrics.pagomovilBsCents > 0
                        ? formatBsCents(metrics.pagomovilBsCents)
                        : "Bs 0,00"}
                    </div>
                  </div>
                  <div className="text-right font-bold text-white">
                    {formatCents(metrics.pagomovilCents)}
                  </div>
                </div>

                <div className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-violet-300">
                      Créditos de tienda usados
                    </div>
                    <div className="text-slate-400">
                      {metrics.creditAppliedCount} órdenes pagadas con saldo interno
                    </div>
                  </div>
                  <div className="text-right font-bold text-violet-300">
                    {formatCents(metrics.creditAppliedCents)}
                  </div>
                </div>

                <div className="pt-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Clock3 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-medium text-amber-200">
                        Por cobrar / Abiertas ({metrics.pendingCount})
                      </div>
                      <div className="text-slate-500">
                        En espera en ZenoBank o Pago Móvil
                      </div>
                    </div>
                  </div>
                  <div className="text-right font-semibold text-amber-300">
                    {formatCents(metrics.pendingCents)}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-emerald-400" />
                    <span>¿Quién tiene créditos a favor?</span>
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Pasivo total en créditos:{" "}
                    <span className="font-bold text-emerald-400">
                      {formatCents(totalCreditLiabilityCents)}
                    </span>{" "}
                    en {creditHolders.length} cliente(s)
                  </p>
                </div>
                <Link
                  href="/admin/customers"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-[11px] font-semibold text-slate-200 hover:text-white hover:bg-white/[0.06]"
                >
                  <span>Ver todos</span>
                  <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>

              {creditHolders.length === 0 ? (
                <div className="py-10 flex flex-col items-center justify-center gap-2 text-center text-xs text-slate-400">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span>Ningún cliente tiene saldo a favor pendiente ($0.00).</span>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06] max-h-56 overflow-y-auto pr-1 text-xs">
                  {creditHolders.map((holder) => (
                    <div
                      key={holder.id}
                      className="py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">
                          {holder.email}
                        </div>
                        <div className="text-slate-500">
                          {holder.ordersCount} órdenes
                        </div>
                      </div>
                      <div className="font-bold text-emerald-400 shrink-0">
                        {formatCents(holder.creditBalanceCents)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: Auditoria APIs */}
        {activeTab === "audit" && (
          <ApiAuditSection
            fazerBalanceCents={fazerCard?.balanceCents ?? null}
            fazerHealthy={fazerCard?.healthy ?? fazerCard?.balanceCents !== null}
            fazerError={fazerCard?.errorMessage}
            fazerOrdersReport={fazerOrdersReport}
            dbFazerConsumedCents={allTimeMetrics.byProvider.fazercards.consumedCents}
            dbFazerCodes={allTimeMetrics.byProvider.fazercards.deliveredCodes}
            centralOneBalanceCents={centralOneCard?.balanceCents ?? null}
            centralOneHealthy={
              centralOneCard?.healthy ?? centralOneCard?.balanceCents !== null
            }
            centralOneError={centralOneCard?.errorMessage}
            centralOneOrdersReport={centralOneOrdersReport}
            dbCentralOneConsumedCents={
              allTimeMetrics.byProvider.centralone.consumedCents
            }
            dbCentralOneCodes={allTimeMetrics.byProvider.centralone.deliveredCodes}
            snapshots={snapshots}
            currentMonthKey={currentMonthKey}
            capturing={capturing}
            onCaptureSnapshot={() => void handleCaptureSnapshot()}
          />
        )}
      </div>
    </div>
  );
}
