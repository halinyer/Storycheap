import React, { Suspense } from "react";
import fs from "fs";
import path from "path";
import { connection } from "next/server";
import type { MatchedPagoMovilSummary } from "@/components/admin/receiver-ledgers-section";
import { TreasuryConsole } from "@/components/admin/treasury-console";
import { isZenoBankConfigured } from "@/lib/server/env";
import {
  fetchLiveVenezuelaRates,
  getBsRateAutoSyncPolicy,
} from "@/lib/server/exchange-rates";
import { getAdminIncludeTestsPreference } from "@/lib/server/admin-preferences";
import {
  getActiveReceiverBankAccount,
  listBankNotifications,
} from "@/lib/server/pagomovil-store";
import {
  getBsRateCents,
  getMonthlyCapitalSnapshots,
  getTreasurySchemaStatus,
  getZenoBinanceReceiver,
  listCatalog,
  listCustomersAdmin,
  listInventoryAdmin,
  listOrdersAdmin,
  listProviderConfigs,
  listSupplierItemCostsAdmin,
  listTreasuryMovementsAdmin,
  listZenoPaymentProofsAdmin,
} from "@/lib/server/repository";
import { fetchSuppliersPortfolioSnapshot } from "@/lib/server/suppliers/registry";
import { computeTreasuryPosition } from "@/lib/server/treasury-metrics";

function readMigration0006Sql(): string {
  try {
    const sqlPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "0006_treasury_and_test_orders.sql"
    );
    return fs.readFileSync(sqlPath, "utf8");
  } catch {
    return "-- Ver supabase/migrations/0006_treasury_and_test_orders.sql en el repositorio.";
  }
}

async function AdminTreasuryContent() {
  await connection();
  const [
    orders,
    movements,
    catalog,
    inventory,
    providers,
    snapshots,
    schemaStatus,
    includeTestOrders,
    bsRateCents,
    customers,
    activePagoMovilAccount,
    pagoMovilNotifications,
    zenoReceiver,
    zenoProofs,
    actualItemCostCents,
    liveRates,
    bsRatePolicy,
  ] = await Promise.all([
    listOrdersAdmin(),
    listTreasuryMovementsAdmin(),
    listCatalog(true),
    listInventoryAdmin({ status: "AVAILABLE" }),
    listProviderConfigs(),
    getMonthlyCapitalSnapshots(),
    getTreasurySchemaStatus(),
    getAdminIncludeTestsPreference(),
    getBsRateCents(),
    listCustomersAdmin(),
    getActiveReceiverBankAccount(),
    listBankNotifications(150),
    getZenoBinanceReceiver(),
    listZenoPaymentProofsAdmin(),
    listSupplierItemCostsAdmin(),
    fetchLiveVenezuelaRates().catch(() => null),
    getBsRateAutoSyncPolicy(),
  ]);

  const replacementUsdtRateCents =
    liveRates?.replacementUsdtRateCents ?? bsRateCents;

  const matchedNotificationByOrder: Record<string, MatchedPagoMovilSummary> = {};
  const matchedBsByOrder: Record<string, number | null> = {};
  for (const n of pagoMovilNotifications) {
    if (
      n.status === "MATCHED" &&
      n.matchedOrderId &&
      !matchedNotificationByOrder[n.matchedOrderId]
    ) {
      matchedNotificationByOrder[n.matchedOrderId] = {
        referenceFull: n.referenceFull,
        amountBsCents: n.amountBsCents,
        senderPhone: n.senderPhone,
        senderBankCode: n.senderBankCode,
        postedAt: n.postedAt,
      };
      matchedBsByOrder[n.matchedOrderId] = n.amountBsCents;
    }
  }

  const prePos = computeTreasuryPosition({
    orders,
    movements,
    suppliers: [],
    actualItemCostCents,
    matchedBsByOrder,
    includeTestOrders,
    bsRateCents,
    replacementUsdtRateCents,
  });

  const suppliers = await fetchSuppliersPortfolioSnapshot({
    providers,
    catalog,
    availableInventoryCount: inventory.length,
    allOrders: orders,
    periodOrders: orders,
    actualItemCostCents,
    fundedBySupplierUsdCents: prePos.fundedBySupplierUsdCents,
    includeTestOrders,
    includeOrdersReports: false,
  });

  const creditLiabilityUsdCents = customers.reduce(
    (sum, c) => sum + Math.max(0, c.creditBalanceCents),
    0
  );

  const position = computeTreasuryPosition({
    orders,
    movements,
    suppliers,
    actualItemCostCents,
    matchedBsByOrder,
    creditLiabilityUsdCents,
    includeTestOrders,
    bsRateCents,
    replacementUsdtRateCents,
  });

  return (
    <TreasuryConsole
      orders={orders}
      movements={movements}
      suppliers={suppliers}
      position={position}
      bsRateCents={bsRateCents}
      bsRatePolicy={bsRatePolicy}
      liveRates={liveRates}
      snapshots={snapshots}
      sqlMigrationApplied={schemaStatus.sqlMigrationApplied}
      migrationSqlSnippet={readMigration0006Sql()}
      includeTestOrders={includeTestOrders}
      zenoConfigured={isZenoBankConfigured()}
      initialZenoReceiver={zenoReceiver}
      zenoProofs={zenoProofs}
      activePagoMovilAccount={activePagoMovilAccount}
      matchedPagoMovilByOrder={matchedNotificationByOrder}
      actualItemCostCents={actualItemCostCents}
    />
  );
}

export default function AdminTreasuryPage() {
  return (
    <Suspense
      fallback={
        <div className="text-xs text-slate-400 py-8">Cargando tesorería...</div>
      }
    >
      <AdminTreasuryContent />
    </Suspense>
  );
}
