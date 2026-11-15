import type { FulfillmentSource, OrderDTO } from "@/types";

export type EffectiveProviderId = "fazercards" | "centralone" | "manual" | "reloadly";

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

const SETTLED_STATUSES = new Set(["PAID", "FULFILLING", "DELIVERED", "PARTIAL"]);

export function formatBsCents(cents: number): string {
  return `Bs ${(cents / 100).toLocaleString("es-VE", {
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
    revenueCents: order.subtotalCents,
    costCents,
    profitCents,
    hasAllCosts,
    bsRateCents: order.bsRateCents ?? null,
    totalBsCents: order.totalBsCents ?? null,
    actualBsCents: isBsGateway ? (order.totalBsCents ?? null) : null,
  };
}

export function computePeriodSales(
  orders: OrderDTO[],
  now = new Date(),
  actualItemCostCents?: Record<string, number>
): PeriodSalesSummary[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  const settled = orders
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
