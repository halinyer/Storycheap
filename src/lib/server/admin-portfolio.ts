import "server-only";
import { getAdminIncludeTestsPreference } from "@/lib/server/admin-preferences";
import { listBankNotifications } from "@/lib/server/pagomovil-store";
import {
  getBsRateCents,
  listCatalog,
  listCustomersAdmin,
  listInventoryAdmin,
  listOrdersAdmin,
  listProviderConfigs,
  listSupplierItemCostsAdmin,
  listTreasuryMovementsAdmin,
} from "@/lib/server/repository";
import { fetchSuppliersPortfolioSnapshot } from "@/lib/server/suppliers/registry";
import { computeTreasuryPosition } from "@/lib/server/treasury-metrics";

export async function loadAdminPortfolioSnapshot(options?: {
  includeOrdersReports?: boolean;
}) {
  const [
    orders,
    movements,
    catalog,
    inventory,
    providers,
    customers,
    bsRateCents,
    actualItemCostCents,
    includeTestOrders,
    pagoMovilNotifications,
  ] = await Promise.all([
    listOrdersAdmin(),
    listTreasuryMovementsAdmin(),
    listCatalog(true),
    listInventoryAdmin({ status: "AVAILABLE" }),
    listProviderConfigs(),
    listCustomersAdmin(),
    getBsRateCents(),
    listSupplierItemCostsAdmin(),
    getAdminIncludeTestsPreference(),
    listBankNotifications(150),
  ]);

  const matchedBsByOrder: Record<string, number | null> = {};
  let unreviewedPagoMovilCount = 0;
  for (const n of pagoMovilNotifications) {
    if (n.status === "MATCHED" && n.matchedOrderId && !(n.matchedOrderId in matchedBsByOrder)) {
      matchedBsByOrder[n.matchedOrderId] = n.amountBsCents;
    } else if (n.status === "UNMATCHED") {
      unreviewedPagoMovilCount += 1;
    }
  }

  const creditLiabilityUsdCents = customers.reduce(
    (sum, c) => sum + Math.max(0, c.creditBalanceCents),
    0
  );

  const prePosition = computeTreasuryPosition({
    orders,
    movements,
    suppliers: [],
    actualItemCostCents,
    matchedBsByOrder,
    creditLiabilityUsdCents,
    includeTestOrders,
    bsRateCents,
  });

  const suppliers = await fetchSuppliersPortfolioSnapshot({
    providers,
    catalog,
    availableInventoryCount: inventory.length,
    allOrders: orders,
    periodOrders: orders,
    actualItemCostCents,
    fundedBySupplierUsdCents: prePosition.fundedBySupplierUsdCents,
    includeTestOrders,
    includeOrdersReports: Boolean(options?.includeOrdersReports),
  });

  const position = computeTreasuryPosition({
    orders,
    movements,
    suppliers,
    actualItemCostCents,
    matchedBsByOrder,
    creditLiabilityUsdCents,
    includeTestOrders,
    bsRateCents,
  });

  return {
    orders,
    movements,
    catalog,
    inventoryCount: inventory.length,
    providers,
    customers,
    bsRateCents,
    actualItemCostCents,
    includeTestOrders,
    matchedBsByOrder,
    unreviewedPagoMovilCount,
    suppliers,
    position,
  };
}
