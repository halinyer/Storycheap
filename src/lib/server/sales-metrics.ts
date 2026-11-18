import type { FulfillmentSource, OrderDTO } from "@/types";

export type EffectiveProviderId =
  | "fazercards"
  | "centralone"
  | "manual"
  | "reloadly"
  | (string & {});

export function resolveFulfillmentProvider(f: {
  source: FulfillmentSource | string;
  supplierTxId?: string | null;
}): EffectiveProviderId {
  if (f.supplierTxId && f.supplierTxId.trim().toLowerCase().startsWith("fazer:")) {
    return "fazercards";
  }
  if (f.source === "centralone" || f.source === "manual" || f.source === "reloadly" || f.source === "fazercards") {
    return f.source;
  }
  return "manual";
}

export interface OrderFinancialSnapshot {
  isSettledSale: boolean;
  isTestOrder: boolean;
  revenueCents: number;
  costCents: number | null;
  profitCents: number | null;
  hasAllCosts: boolean;
  bsRateCents: number | null;
  totalBsCents: number | null;
  actualBsCents: number | null;
}

export interface PeriodSalesSummary {
  label: string;
  ordersCount: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  missingCostOrders: number;
  totalBsCents: number;
  bsCoveredOrders: number;
}

export interface OrdersAggregateMetrics {
  ordersCount: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  marginPct: string;
  totalBsCents: number;
  bsCovered: number;
  zenobankCents: number;
  zenobankCount: number;
  pagomovilCents: number;
  pagomovilBsCents: number;
  pagomovilCostCents: number;
  pagomovilCount: number;
  creditAppliedCents: number;
  creditAppliedCount: number;
  pendingCents: number;
  pendingCount: number;
  byProvider: Record<
    string,
    { consumedCents: number; profitCents: number; deliveredCodes: number }
  >;
}

const SETTLED_STATUSES = new Set(["PAID", "FULFILLING", "DELIVERED", "PARTIAL"]);

export function formatBsCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}Bs ${(Math.abs(cents) / 100).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatBsRate(rateCents: number): string {
  return `Bs ${(rateCents / 100).toFixed(2)}/$`;
}

export function getOrderSnapshot(
  order: OrderDTO,
  actualItemCostCents?: Record<string, number>
): OrderFinancialSnapshot {
  const isSettledSale =
    SETTLED_STATUSES.has(order.status) &&
    (order.paidCents > 0 || order.creditAppliedCents > 0 || order.status === "DELIVERED");

  let costSum = 0;
  let hasAnyCost = false;
  let hasAllCosts = order.items.length > 0;

  for (const item of order.items) {
    const unitCost =
      actualItemCostCents && typeof actualItemCostCents[item.id] === "number"
        ? actualItemCostCents[item.id]
        : item.unitCostCents;
    if (typeof unitCost === "number") {
      costSum += unitCost * item.quantity;
      hasAnyCost = true;
    } else {
      hasAllCosts = false;
    }
  }

  const costCents = hasAnyCost ? costSum : null;
  const profitCents = costCents !== null ? order.subtotalCents - costCents : null;
  const isBsGateway =
    order.paymentGateway === "pagomovil" || order.paymentGateway === "pablito";

  return {
    isSettledSale,
    isTestOrder: Boolean(order.isTest),
    revenueCents: order.subtotalCents,
    costCents,
    profitCents,
    hasAllCosts,
    bsRateCents: order.bsRateCents ?? null,
    totalBsCents: order.totalBsCents ?? null,
    actualBsCents: isBsGateway ? (order.totalBsCents ?? null) : null,
  };
}

export function getOrderCashPaidCents(
  order: OrderDTO,
  revenueCents: number
): number {
  return order.paidCents > 0
    ? order.paidCents
    : Math.max(0, revenueCents - order.creditAppliedCents);
}

export function summarizeOrdersMetrics(
  list: OrderDTO[],
  costOverrides: Record<string, number> = {},
  options?: { includeTestOrders?: boolean; matchedBsByOrder?: Record<string, number | null> }
): OrdersAggregateMetrics {
  const includeTestOrders = Boolean(options?.includeTestOrders);
  let ordersCount = 0;
  let revenueCents = 0;
  let costCents = 0;
  let totalBsCents = 0;
  let bsCovered = 0;
  let zenobankCents = 0;
  let zenobankCount = 0;
  let pagomovilCents = 0;
  let pagomovilBsCents = 0;
  let pagomovilCostCents = 0;
  let pagomovilCount = 0;
  let creditAppliedCents = 0;
  let creditAppliedCount = 0;
  let pendingCents = 0;
  let pendingCount = 0;

  const byProvider: Record<
    string,
    { consumedCents: number; profitCents: number; deliveredCodes: number }
  > = {
    fazercards: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
    centralone: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
    manual: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
    reloadly: { consumedCents: 0, profitCents: 0, deliveredCodes: 0 },
  };

  for (const order of list) {
    if (!includeTestOrders && order.isTest) continue;

    if (order.status === "PENDING_PAYMENT" || order.status === "CREATED") {
      pendingCount += 1;
      pendingCents += order.amountDueCents;
    }

    const snap = getOrderSnapshot(order, costOverrides);
    if (!snap.isSettledSale) continue;

    ordersCount += 1;
    revenueCents += snap.revenueCents;
    if (snap.costCents !== null) costCents += snap.costCents;
    const effectiveBs = options?.matchedBsByOrder?.[order.id] ?? snap.actualBsCents;
    if (typeof effectiveBs === "number" && effectiveBs > 0) {
      totalBsCents += effectiveBs;
      bsCovered += 1;
    }

    if (order.creditAppliedCents > 0) {
      creditAppliedCents += order.creditAppliedCents;
      creditAppliedCount += 1;
    }

    const cashPaidCents = getOrderCashPaidCents(order, snap.revenueCents);
    if (cashPaidCents > 0) {
      if (order.paymentGateway === "pagomovil" || order.paymentGateway === "pablito") {
        pagomovilCount += 1;
        pagomovilCents += cashPaidCents;
        if (typeof effectiveBs === "number" && effectiveBs > 0) {
          pagomovilBsCents += effectiveBs;
        }
        if (snap.costCents !== null) {
          const allocatedCost =
            order.creditAppliedCents > 0 && snap.revenueCents > 0
              ? Math.round((snap.costCents * cashPaidCents) / snap.revenueCents)
              : snap.costCents;
          pagomovilCostCents += allocatedCost;
        }
      } else {
        zenobankCount += 1;
        zenobankCents += cashPaidCents;
      }
    }

    const itemById = new Map(order.items.map((it) => [it.id, it]));
    for (const f of order.fulfillments) {
      const providerKey = resolveFulfillmentProvider(f);
      if (!byProvider[providerKey]) {
        byProvider[providerKey] = {
          consumedCents: 0,
          profitCents: 0,
          deliveredCodes: 0,
        };
      }
      const bucket = byProvider[providerKey];
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
    pagomovilCostCents,
    pagomovilCount,
    creditAppliedCents,
    creditAppliedCount,
    pendingCents,
    pendingCount,
    byProvider,
  };
}

export function computePeriodSales(
  orders: OrderDTO[],
  now = new Date(),
  actualItemCostCents?: Record<string, number>,
  options?: { includeTestOrders?: boolean }
): PeriodSalesSummary[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const includeTestOrders = Boolean(options?.includeTestOrders);

  const settled = orders
    .filter((o) => includeTestOrders || !o.isTest)
    .map((o) => ({
      order: o,
      snap: getOrderSnapshot(o, actualItemCostCents),
      ts: Date.parse(o.createdAt),
    }))
    .filter((x) => x.snap.isSettledSale && Number.isFinite(x.ts));

  const summarize = (label: string, sinceMs: number): PeriodSalesSummary => {
    const subset = settled.filter((x) => x.ts >= sinceMs);
    let revenueCents = 0;
    let costCents = 0;
    let missingCostOrders = 0;
    let totalBsCents = 0;
    let bsCoveredOrders = 0;

    for (const { snap } of subset) {
      revenueCents += snap.revenueCents;
      if (snap.costCents !== null && snap.hasAllCosts) {
        costCents += snap.costCents;
      } else {
        missingCostOrders += 1;
        if (snap.costCents !== null) costCents += snap.costCents;
      }
      if (snap.actualBsCents !== null) {
        totalBsCents += snap.actualBsCents;
        bsCoveredOrders += 1;
      }
    }

    return {
      label,
      ordersCount: subset.length,
      revenueCents,
      costCents,
      profitCents: revenueCents - costCents,
      missingCostOrders,
      totalBsCents,
      bsCoveredOrders,
    };
  };

  return [
    summarize("Hoy", startOfToday.getTime()),
    summarize("Últimos 7 días", sevenDaysAgo.getTime()),
    summarize("Este mes", startOfMonth.getTime()),
  ];
}
