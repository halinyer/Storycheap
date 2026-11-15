import "server-only";
import type {
  OrderDTO,
  ProductDTO,
  ProviderConfigDTO,
  SupplierPortfolioRow,
} from "@/types";
import { summarizeOrdersMetrics } from "../sales-metrics";
import { getCentralOneBalance, listCentralOneOrders } from "./centralone";
import { getFazerCardsBalance, listFazerCardsOrders } from "./fazercards";
import { getReloadlyBalance } from "./reloadly";
import type { SupplierBalanceStatus } from "./types";

export interface SupplierAdapterDescriptor {
  id: string;
  configId: ProviderConfigDTO["id"];
  label: string;
  subtitle: string;
  kind: "api" | "inventory";
  accentColor: string;
  defaultEnabled: boolean;
  defaultMinAlertCents: number;
  getBalance: (context: { manualCostCents: number }) => Promise<SupplierBalanceStatus>;
  getOrdersReport?: (limit: number) => Promise<{
    healthy: boolean;
    totalSpentCents: number;
    completedCount: number;
  }>;
}

/**
 * Central extensible registry of stock / API suppliers.
 * Adding a new distributor requires adding one entry here — every admin screen
 * (Overview, Treasury, Providers, Audit) scales vertically automatically.
 */
export const SUPPLIER_REGISTRY: SupplierAdapterDescriptor[] = [
  {
    id: "fazercards",
    configId: "fazercards",
    label: "FazerCards API v2",
    subtitle: "Netflix, Gift Cards y Top-Ups",
    kind: "api",
    accentColor: "#f59e0b",
    defaultEnabled: true,
    defaultMinAlertCents: 1000,
    getBalance: () => getFazerCardsBalance(),
    getOrdersReport: async (limit) => {
      const report = await listFazerCardsOrders(limit);
      return {
        healthy: report.healthy,
        totalSpentCents: report.totalSpentCents,
        completedCount: report.completedCount,
      };
    },
  },
  {
    id: "centralone",
    configId: "centralone",
    label: "Central One API",
    subtitle: "Gift Cards & PINs en vivo",
    kind: "api",
    accentColor: "#38bdf8",
    defaultEnabled: false,
    defaultMinAlertCents: 5000,
    getBalance: () => getCentralOneBalance(),
    getOrdersReport: async (limit) => {
      const report = await listCentralOneOrders(limit);
      return {
        healthy: report.healthy,
        totalSpentCents: report.totalSpentCents,
        completedCount: report.completedCount,
      };
    },
  },
  {
    id: "manual",
    configId: "manual_inventory",
    label: "Stock Propio (CSV)",
    subtitle: "Inventario físico cifrado al costo",
    kind: "inventory",
    accentColor: "#10b981",
    defaultEnabled: true,
    defaultMinAlertCents: 0,
    getBalance: async ({ manualCostCents }) => ({
      configured: true,
      sandbox: false,
      balanceCents: manualCostCents,
      currency: "USD",
      healthy: true,
    }),
  },
  {
    id: "reloadly",
    configId: "reloadly",
    label: "Reloadly API",
    subtitle: "Solo cuentas KYC verificadas",
    kind: "api",
    accentColor: "#a855f7",
    defaultEnabled: false,
    defaultMinAlertCents: 10000,
    getBalance: () => getReloadlyBalance(),
  },
];

export function computeManualInventoryCostCents(catalog: ProductDTO[]): number {
  let sum = 0;
  for (const product of catalog) {
    for (const variant of product.variants) {
      if (variant.availableStock > 0 && typeof variant.unitCostCents === "number") {
        sum += variant.availableStock * variant.unitCostCents;
      }
    }
  }
  return sum;
}

export async function fetchSuppliersPortfolioSnapshot(params: {
  providers: ProviderConfigDTO[];
  catalog: ProductDTO[];
  availableInventoryCount: number;
  allOrders: OrderDTO[];
  periodOrders: OrderDTO[];
  actualItemCostCents: Record<string, number>;
  fundedBySupplierUsdCents?: Record<string, number>;
  includeTestOrders?: boolean;
  includeOrdersReports?: boolean;
}): Promise<SupplierPortfolioRow[]> {
  const providerMap = new Map(params.providers.map((p) => [p.id, p]));
  const manualCostCents = computeManualInventoryCostCents(params.catalog);

  const allTimeMetrics = summarizeOrdersMetrics(
    params.allOrders,
    params.actualItemCostCents,
    { includeTestOrders: params.includeTestOrders }
  );
  const periodMetrics = summarizeOrdersMetrics(
    params.periodOrders,
    params.actualItemCostCents,
    { includeTestOrders: params.includeTestOrders }
  );

  const settled = await Promise.all(
    SUPPLIER_REGISTRY.map(async (adapter) => {
      const cfg = providerMap.get(adapter.configId);
      const [balance, ordersReport] = await Promise.all([
        adapter.getBalance({ manualCostCents }),
        params.includeOrdersReports && adapter.getOrdersReport
          ? adapter.getOrdersReport(50)
          : Promise.resolve(null),
      ]);

      const enabled = cfg?.enabled ?? adapter.defaultEnabled;
      const minAlert = cfg?.minBalanceAlertCents ?? adapter.defaultMinAlertCents;
      const allBucket = allTimeMetrics.byProvider[adapter.id] ?? {
        consumedCents: 0,
        profitCents: 0,
        deliveredCodes: 0,
      };
      const periodBucket = periodMetrics.byProvider[adapter.id] ?? {
        consumedCents: 0,
        profitCents: 0,
        deliveredCodes: 0,
      };

      const needsTopup =
        enabled &&
        adapter.kind === "api" &&
        minAlert > 0 &&
        typeof balance.balanceCents === "number" &&
        balance.balanceCents < minAlert;

      return {
        id: adapter.id,
        label: adapter.label,
        subtitle: adapter.subtitle,
        kind: adapter.kind,
        accentColor: adapter.accentColor,
        enabled,
        configured: balance.configured,
        healthy: balance.healthy,
        errorMessage: balance.errorMessage,
        balanceCents: balance.balanceCents,
        exactBalanceUsd: balance.exactBalanceUsd ?? null,
        minBalanceAlertCents: minAlert,
        needsTopup,
        fundedCents: params.fundedBySupplierUsdCents?.[adapter.id] ?? 0,
        apiSpentAllTimeCents:
          ordersReport && ordersReport.healthy ? ordersReport.totalSpentCents : null,
        apiOrdersCount:
          ordersReport && ordersReport.healthy ? ordersReport.completedCount : null,
        periodConsumedCents: periodBucket.consumedCents,
        periodProfitCents: periodBucket.profitCents,
        periodCodesCount: periodBucket.deliveredCodes,
        allTimeConsumedCents: allBucket.consumedCents,
        allTimeProfitCents: allBucket.profitCents,
        allTimeCodesCount: allBucket.deliveredCodes,
        codesAvailableCount:
          adapter.id === "manual" ? params.availableInventoryCount : undefined,
      } satisfies SupplierPortfolioRow;
    })
  );

  return settled;
}
