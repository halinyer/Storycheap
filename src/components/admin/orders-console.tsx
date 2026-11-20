"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/catalog-seed";
import {
  formatBsCents,
  formatBsRate,
  getOrderSnapshot,
  resolveFulfillmentProvider,
} from "@/lib/server/sales-metrics";
import type { OrderDTO } from "@/types";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  ChevronDown,
  Filter,
  FlaskConical,
  KeyRound,
  RotateCcw,
  Search,
  X,
  Zap,
} from "lucide-react";

type ScopeFilter = "real" | "test" | "all" | "attention";
type StatusGroup =
  | "all"
  | "DELIVERED"
  | "PAID_ACTIVE"
  | "PENDING"
  | "ISSUE"
  | "CLOSED"
  | "REFUNDED";
type GatewayFilter = "all" | "zenobank" | "pagomovil";
type ProviderFilter =
  | "all"
  | "fazercards"
  | "centralone"
  | "manual"
  | "reloadly"
  | "none";
type DeliveryFilter = "all" | "pin" | "topup";
type DatePreset = "all" | "today" | "yesterday" | "7d" | "30d" | "month" | "custom";
type SortBy = "newest" | "oldest" | "amount_desc" | "amount_asc" | "profit_desc";

const PROVIDER_LABELS: Record<string, string> = {
  fazercards: "FazerCards",
  centralone: "Central One",
  manual: "Stock CSV",
  reloadly: "Reloadly",
};

function getOrderProviders(order: OrderDTO): string[] {
  const set = new Set<string>();
  for (const f of order.fulfillments ?? []) {
    set.add(resolveFulfillmentProvider(f));
  }
  for (const so of order.supplierOrders ?? []) {
    if (so.provider) set.add(so.provider);
  }
  return Array.from(set);
}

function isOrderDirectTopup(order: OrderDTO): boolean {
  return (order.items ?? []).some((item) => Boolean(item.targetInfo));
}

function matchesStatusGroup(status: OrderDTO["status"], group: StatusGroup): boolean {
  switch (group) {
    case "all":
      return true;
    case "DELIVERED":
      return status === "DELIVERED";
    case "PAID_ACTIVE":
      return status === "PAID" || status === "FULFILLING";
    case "PENDING":
      return status === "PENDING_PAYMENT" || status === "CREATED";
    case "ISSUE":
      return status === "MANUAL_REVIEW" || status === "PARTIAL";
    case "CLOSED":
      return status === "EXPIRED" || status === "CANCELLED";
    case "REFUNDED":
      return status === "REFUNDED_CREDIT";
  }
}

function matchesDateFilter(
  createdAtIso: string,
  preset: DatePreset,
  dateFrom: string,
  dateTo: string
): boolean {
  if (preset === "all") return true;
  const ts = new Date(createdAtIso).getTime();
  if (!Number.isFinite(ts)) return true;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (preset === "today") return ts >= startOfToday;
  if (preset === "yesterday") {
    const startOfYesterday = startOfToday - 86_400_000;
    return ts >= startOfYesterday && ts < startOfToday;
  }
  if (preset === "7d") return ts >= now.getTime() - 7 * 86_400_000;
  if (preset === "30d") return ts >= now.getTime() - 30 * 86_400_000;
  if (preset === "month") {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return ts >= startOfMonth;
  }
  if (preset === "custom") {
    if (dateFrom) {
      const fromTs = new Date(`${dateFrom}T00:00:00`).getTime();
      if (Number.isFinite(fromTs) && ts < fromTs) return false;
    }
    if (dateTo) {
      const toTs = new Date(`${dateTo}T23:59:59.999`).getTime();
      if (Number.isFinite(toTs) && ts > toTs) return false;
    }
    return true;
  }
  return true;
}

export interface OrdersConsoleProps {
  orders: OrderDTO[];
  actualItemCostCents: Record<string, number>;
  initialScope: ScopeFilter;
  initialQuery?: string;
  initialStatus?: StatusGroup;
  initialGateway?: GatewayFilter;
}

export function OrdersConsole({
  orders,
  actualItemCostCents,
  initialScope,
  initialQuery = "",
  initialStatus = "all",
  initialGateway = "all",
}: OrdersConsoleProps) {
  const [scope, setScope] = useState<ScopeFilter>(initialScope);
  const [query, setQuery] = useState(initialQuery);
  const [statusGroup, setStatusGroup] = useState<StatusGroup>(initialStatus);
  const [gateway, setGateway] = useState<GatewayFilter>(initialGateway);
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [delivery, setDelivery] = useState<DeliveryFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("newest");

  const counts = useMemo(() => {
    let real = 0;
    let test = 0;
    let attention = 0;
    for (const o of orders) {
      if (o.isTest) test++;
      else real++;
      if (o.needsAttention) attention++;
    }
    return { real, test, all: orders.length, attention };
  }, [orders]);

  const enriched = useMemo(() => {
    return orders.map((o) => ({
      order: o,
      snap: getOrderSnapshot(o, actualItemCostCents),
      providers: getOrderProviders(o),
      isDirectTopup: isOrderDirectTopup(o),
    }));
  }, [orders, actualItemCostCents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");

    const list = enriched.filter(({ order: o, providers, isDirectTopup }) => {
      if (scope === "real" && o.isTest) return false;
      if (scope === "test" && !o.isTest) return false;
      if (scope === "attention" && !o.needsAttention) return false;

      if (!matchesStatusGroup(o.status, statusGroup)) return false;

      if (gateway !== "all" && o.paymentGateway !== gateway) return false;

      if (provider === "none") {
        if (providers.length > 0) return false;
      } else if (provider !== "all") {
        if (!providers.includes(provider)) return false;
      }

      if (delivery === "topup" && !isDirectTopup) return false;
      if (delivery === "pin" && isDirectTopup) return false;

      if (!matchesDateFilter(o.createdAt, datePreset, dateFrom, dateTo)) {
        return false;
      }

      if (q) {
        const matchOrder =
          o.orderNumber.toLowerCase().includes(q) ||
          o.id.toLowerCase().startsWith(q) ||
          o.email.toLowerCase().includes(q) ||
          (o.gatewayCheckoutId ?? "").toLowerCase().includes(q) ||
          (o.items ?? []).some(
            (it) =>
              it.productName.toLowerCase().includes(q) ||
              it.denominationLabel.toLowerCase().includes(q) ||
              (it.targetInfo?.displaySummary ?? "").toLowerCase().includes(q) ||
              (it.targetInfo?.playerName ?? "").toLowerCase().includes(q)
          );
        if (!matchOrder) return false;
      }

      return true;
    });

    list.sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return a.order.createdAt.localeCompare(b.order.createdAt);
        case "amount_desc":
          return b.order.subtotalCents - a.order.subtotalCents;
        case "amount_asc":
          return a.order.subtotalCents - b.order.subtotalCents;
        case "profit_desc":
          return (b.snap.profitCents ?? -999999) - (a.snap.profitCents ?? -999999);
        case "newest":
        default:
          return b.order.createdAt.localeCompare(a.order.createdAt);
      }
    });

    return list;
  }, [
    enriched,
    scope,
    statusGroup,
    gateway,
    provider,
    delivery,
    datePreset,
    dateFrom,
    dateTo,
    query,
    sortBy,
  ]);

  const filterMetrics = useMemo(() => {
    let paidCashCents = 0;
    let settledRevenueCents = 0;
    let costCents = 0;
    let profitCents = 0;
    let settledCount = 0;

    for (const { order: o, snap } of filtered) {
      paidCashCents += o.paidCents ?? 0;
      if (snap.isSettledSale) {
        settledCount++;
        settledRevenueCents += snap.revenueCents;
        if (snap.costCents !== null) costCents += snap.costCents;
        if (snap.profitCents !== null) profitCents += snap.profitCents;
      }
    }

    const marginPct =
      settledRevenueCents > 0
        ? ((profitCents / settledRevenueCents) * 100).toFixed(1)
        : "0.0";

    return {
      totalCount: filtered.length,
      settledCount,
      paidCashCents,
      settledRevenueCents,
      costCents,
      profitCents,
      marginPct,
    };
  }, [filtered]);

  const hasExtraFilters =
    query.trim() !== "" ||
    statusGroup !== "all" ||
    gateway !== "all" ||
    provider !== "all" ||
    delivery !== "all" ||
    datePreset !== "today" ||
    sortBy !== "newest";

  const resetFilters = () => {
    setQuery("");
    setStatusGroup("all");
    setGateway("all");
    setProvider("all");
    setDelivery("all");
    setDatePreset("today");
    setDateFrom("");
    setDateTo("");
    setSortBy("newest");
  };

  return (
    <div className="space-y-5">
      {/* Header + Scope Tabs */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-400">
            Departamento · Ventas y Operaciones
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
            Gestión de Órdenes
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Filtra en tiempo real por estado, pasarela, fecha, distribuidor, tipo de entrega o cliente.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setScope("real")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              scope === "real"
                ? "bg-white text-slate-950 border-white"
                : "bg-white/[0.04] text-slate-300 border-white/10 hover:text-white"
            }`}
          >
            Reales ({counts.real})
          </button>
          <button
            type="button"
            onClick={() => setScope("test")}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              scope === "test"
                ? "bg-amber-400 text-slate-950 border-amber-400"
                : "bg-white/[0.04] text-amber-200 border-amber-500/25 hover:bg-amber-500/15"
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>Pruebas ({counts.test})</span>
          </button>
          <button
            type="button"
            onClick={() => setScope("all")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              scope === "all"
                ? "bg-indigo-500 text-white border-indigo-400"
                : "bg-white/[0.04] text-slate-300 border-white/10 hover:text-white"
            }`}
          >
            Todas ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setScope("attention")}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              scope === "attention"
                ? "bg-rose-500 text-white border-rose-500"
                : "bg-white/[0.04] text-rose-300 border-rose-500/30 hover:bg-rose-500/15"
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Atención ({counts.attention})</span>
          </button>
        </div>
      </div>

      {/* Multi-Filter Control Bar */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-4 space-y-3.5">
        {/* Row 1: Search + Quick Date Pills */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar N° de orden, correo, producto, UID o referencia..."
              className="w-full rounded-xl bg-[#141722] border border-white/[0.12] hover:border-white/25 focus:border-sky-400 pl-10 pr-9 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400 mr-0.5 hidden sm:inline" />
            {(
              [
                { id: "all", label: "Todo" },
                { id: "today", label: "Hoy" },
                { id: "yesterday", label: "Ayer" },
                { id: "7d", label: "7 días" },
                { id: "30d", label: "30 días" },
                { id: "month", label: "Mes" },
                { id: "custom", label: "Rango" },
              ] as Array<{ id: DatePreset; label: string }>
            ).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDatePreset(d.id)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  datePreset === d.id
                    ? "bg-white text-slate-950"
                    : "bg-white/[0.04] text-slate-300 hover:text-white border border-white/[0.07]"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Range Picker (only if custom selected) */}
        {datePreset === "custom" && (
          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
            <label className="flex items-center gap-2 text-slate-300">
              <span className="text-[11px] text-slate-400">Desde:</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg bg-[#141722] border border-white/15 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
              />
            </label>
            <label className="flex items-center gap-2 text-slate-300">
              <span className="text-[11px] text-slate-400">Hasta:</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg bg-[#141722] border border-white/15 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
              />
            </label>
          </div>
        )}

        {/* Row 2: Structured Dropdown Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1 border-t border-white/[0.06]">
          {/* Status */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
              Estado
            </span>
            <div className="relative">
              <select
                value={statusGroup}
                onChange={(e) => setStatusGroup(e.target.value as StatusGroup)}
                className="w-full appearance-none rounded-xl bg-[#141722] border border-white/[0.1] px-3 py-2 pr-8 text-xs font-semibold text-white focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="all" className="bg-[#11131c]">Todos</option>
                <option value="DELIVERED" className="bg-[#11131c]">Entregadas</option>
                <option value="PAID_ACTIVE" className="bg-[#11131c]">Pagadas / Proceso</option>
                <option value="PENDING" className="bg-[#11131c]">Pendientes</option>
                <option value="ISSUE" className="bg-[#11131c]">Revisión / Parcial</option>
                <option value="CLOSED" className="bg-[#11131c]">Expiradas / Canceladas</option>
                <option value="REFUNDED" className="bg-[#11131c]">Reembolsadas</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Gateway */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
              Pasarela
            </span>
            <div className="relative">
              <select
                value={gateway}
                onChange={(e) => setGateway(e.target.value as GatewayFilter)}
                className="w-full appearance-none rounded-xl bg-[#141722] border border-white/[0.1] px-3 py-2 pr-8 text-xs font-semibold text-white focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="all" className="bg-[#11131c]">Todas</option>
                <option value="zenobank" className="bg-[#11131c]">Binance / Zeno</option>
                <option value="pagomovil" className="bg-[#11131c]">Pago Móvil (Bs)</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Provider */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
              Proveedor
            </span>
            <div className="relative">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderFilter)}
                className="w-full appearance-none rounded-xl bg-[#141722] border border-white/[0.1] px-3 py-2 pr-8 text-xs font-semibold text-white focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="all" className="bg-[#11131c]">Todos</option>
                <option value="fazercards" className="bg-[#11131c]">FazerCards</option>
                <option value="centralone" className="bg-[#11131c]">Central One</option>
                <option value="manual" className="bg-[#11131c]">Stock CSV</option>
                <option value="reloadly" className="bg-[#11131c]">Reloadly</option>
                <option value="none" className="bg-[#11131c]">Sin despachar</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Delivery Type */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
              Tipo entrega
            </span>
            <div className="relative">
              <select
                value={delivery}
                onChange={(e) => setDelivery(e.target.value as DeliveryFilter)}
                className="w-full appearance-none rounded-xl bg-[#141722] border border-white/[0.1] px-3 py-2 pr-8 text-xs font-semibold text-white focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="all" className="bg-[#11131c]">Todas</option>
                <option value="pin" className="bg-[#11131c]">Gift Card (PIN)</option>
                <option value="topup" className="bg-[#11131c]">Recarga por ID</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Sort */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
              Ordenar por
            </span>
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="w-full appearance-none rounded-xl bg-[#141722] border border-white/[0.1] px-3 py-2 pr-8 text-xs font-semibold text-white focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="newest" className="bg-[#11131c]">Más recientes</option>
                <option value="oldest" className="bg-[#11131c]">Más antiguas</option>
                <option value="amount_desc" className="bg-[#11131c]">Mayor monto</option>
                <option value="amount_asc" className="bg-[#11131c]">Menor monto</option>
                <option value="profit_desc" className="bg-[#11131c]">Mayor ganancia</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Reset Button */}
          <div className="flex items-end">
            <button
              type="button"
              disabled={!hasExtraFilters}
              onClick={resetFilters}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] disabled:opacity-35 border border-white/[0.1] text-xs font-bold text-slate-200 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpiar</span>
            </button>
          </div>
        </div>
      </div>

      {/* Live Filtered Totals Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-[#0d101b] border border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Filter className="w-3 h-3 text-sky-400" />
            <span>Resultado del filtro</span>
          </div>
          <div className="text-lg font-black font-mono text-white mt-1">
            {filterMetrics.totalCount}{" "}
            <span className="text-xs font-normal text-slate-400">
              ({filterMetrics.settledCount} liquidadas)
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-[#0d101b] border border-white/[0.07] px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Cobrado en filtro
          </div>
          <div className="text-lg font-black font-mono text-white mt-1">
            {formatCents(filterMetrics.paidCashCents)}
          </div>
        </div>

        <div className="rounded-xl bg-[#0d101b] border border-white/[0.07] px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Costo proveedor
          </div>
          <div className="text-lg font-black font-mono text-slate-200 mt-1">
            {formatCents(filterMetrics.costCents)}
          </div>
        </div>

        <div className="rounded-xl bg-[#0d101b] border border-white/[0.07] px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Ganancia del filtro
          </div>
          <div
            className={`text-lg font-black font-mono mt-1 ${
              filterMetrics.profitCents >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {filterMetrics.profitCents >= 0 ? "+" : ""}
            {formatCents(filterMetrics.profitCents)}{" "}
            <span className="text-xs font-normal text-slate-400">
              ({filterMetrics.marginPct}%)
            </span>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-xs text-slate-400">
              Ninguna orden coincide con los filtros seleccionados.
            </p>
            {hasExtraFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-4 py-2 rounded-xl bg-white text-slate-950 text-xs font-black cursor-pointer"
              >
                Restablecer filtros
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="px-5 py-3">Orden</th>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Producto / Prov.</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3">Total / Pagado</th>
                  <th className="px-5 py-3">Bs</th>
                  <th className="px-5 py-3">Ganancia</th>
                  <th className="px-5 py-3">Pasarela</th>
                  <th className="px-5 py-3 text-right">Ver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {filtered.map(({ order: o, snap, providers, isDirectTopup }) => {
                  const firstItem = o.items?.[0];
                  const extraItems = Math.max(0, (o.items?.length ?? 0) - 1);
                  return (
                    <tr key={o.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3.5 whitespace-nowrap">
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

                      <td className="px-5 py-3.5 text-slate-200 max-w-[180px] truncate">
                        {o.email}
                      </td>

                      <td className="px-5 py-3.5 max-w-[230px]">
                        <div className="flex items-center gap-1.5 text-slate-100 font-semibold truncate">
                          {isDirectTopup ? (
                            <Zap className="w-3 h-3 text-sky-400 shrink-0" />
                          ) : (
                            <KeyRound className="w-3 h-3 text-slate-500 shrink-0" />
                          )}
                          <span className="truncate">
                            {firstItem
                              ? `${firstItem.productName} · ${firstItem.denominationLabel}`
                              : "—"}
                            {extraItems > 0 ? ` (+${extraItems})` : ""}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          {providers.length > 0 ? (
                            providers.map((p) => (
                              <span
                                key={p}
                                className="px-1.5 py-0.5 rounded bg-white/[0.05] text-[10px] font-semibold text-slate-300"
                              >
                                {PROVIDER_LABELS[p] ?? p}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-slate-500">
                              Sin despachar
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                              o.needsAttention
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                : o.status === "DELIVERED"
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : o.status === "EXPIRED" || o.status === "CANCELLED"
                                    ? "bg-slate-800 text-slate-400"
                                    : "bg-white/[0.06] text-slate-200"
                            }`}
                          >
                            {o.status}
                          </span>
                          {o.paidCents > 0 && o.paidCents < o.amountDueCents && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-500/15 border border-amber-500/35 text-amber-300">
                              Falta {formatCents(o.amountDueCents - o.paidCents)}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-5 py-3.5 whitespace-nowrap font-mono">
                        <div className="font-bold text-white">
                          {formatCents(o.subtotalCents)}
                        </div>
                        {o.paidCents > 0 && o.paidCents !== o.subtotalCents && (
                          <div className="text-[10px] text-slate-400">
                            Pagado {formatCents(o.paidCents)}
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-3.5 whitespace-nowrap text-slate-300">
                        {snap.actualBsCents !== null && snap.bsRateCents !== null ? (
                          <div>
                            <div className="font-bold text-white font-mono">
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

                      <td className="px-5 py-3.5 whitespace-nowrap font-mono font-black">
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
                          <span className="text-slate-500 font-normal">—</span>
                        )}
                      </td>

                      <td className="px-5 py-3.5 whitespace-nowrap text-slate-300 text-[11px] uppercase">
                        {o.paymentGateway === "zenobank"
                          ? "Binance"
                          : o.paymentGateway === "pagomovil"
                            ? "Pago Móvil"
                            : o.paymentGateway}
                      </td>

                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
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
