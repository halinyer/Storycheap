import React, { Suspense } from "react";
import { connection } from "next/server";
import { BanksConsole } from "@/components/admin/banks-console";
import type { MatchedPagoMovilSummary } from "@/components/admin/receiver-ledgers-section";
import { getAdminIncludeTestsPreference } from "@/lib/server/admin-preferences";
import { isZenoBankConfigured } from "@/lib/server/env";
import {
  fetchLiveVenezuelaRates,
  getBsRateAutoSyncPolicy,
} from "@/lib/server/exchange-rates";
import {
  getActiveReceiverBankAccount,
  getPagoMovilSettings,
  listBankNotifications,
} from "@/lib/server/pagomovil-store";
import {
  getBsRateCents,
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

async function AdminBanksContent() {
  await connection();
  const [
    orders,
    movements,
    catalog,
    inventory,
    providers,
    includeTestOrders,
    bsRateCents,
    customers,
    activePagoMovilAccount,
    pagoMovilNotifications,
    pagoMovilSettings,
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
    getAdminIncludeTestsPreference(),
    getBsRateCents(),
    listCustomersAdmin(),
    getActiveReceiverBankAccount(),
    listBankNotifications(150),
    getPagoMovilSettings(),
    getZenoBinanceReceiver(),
    listZenoPaymentProofsAdmin(),
    listSupplierItemCostsAdmin(),
    fetchLiveVenezuelaRates().catch(() => null),
    getBsRateAutoSyncPolicy(),
  ]);

  const replacementUsdtRateCents =
    liveRates?.replacementUsdtRateCents ?? bsRateCents;

  const matchedPagoMovilByOrder: Record<string, MatchedPagoMovilSummary> = {};
  const matchedBsByOrder: Record<string, number | null> = {};
  for (const n of pagoMovilNotifications) {
    if (
      n.status === "MATCHED" &&
      n.matchedOrderId &&
      !matchedPagoMovilByOrder[n.matchedOrderId]
    ) {
      matchedPagoMovilByOrder[n.matchedOrderId] = {
        referenceFull: n.referenceFull,
        amountBsCents: n.amountBsCents,
        senderPhone: n.senderPhone,
        senderBankCode: n.senderBankCode,
        postedAt: n.postedAt,
      };
      matchedBsByOrder[n.matchedOrderId] = n.amountBsCents;
    }
  }

  const suppliers = await fetchSuppliersPortfolioSnapshot({
    providers,
    catalog,
    availableInventoryCount: inventory.length,
    allOrders: orders,
    periodOrders: orders,
    actualItemCostCents,
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
    pagomovilIncomingFeePct: pagoMovilSettings.incomingFeePct,
    pagomovilOutgoingFeePct: pagoMovilSettings.outgoingFeePct,
    pagomovilFeePassThroughMode: pagoMovilSettings.feePassThroughMode,
  });

  return (
    <BanksConsole
      orders={orders}
      suppliers={suppliers}
      position={position}
      bsRateCents={bsRateCents}
      bsRatePolicy={bsRatePolicy}
      liveRates={liveRates}
      includeTestOrders={includeTestOrders}
      zenoConfigured={isZenoBankConfigured()}
      initialZenoReceiver={zenoReceiver}
      zenoProofs={zenoProofs}
      activePagoMovilAccount={activePagoMovilAccount}
      matchedPagoMovilByOrder={matchedPagoMovilByOrder}
      actualItemCostCents={actualItemCostCents}
    />
  );
}

export default function AdminBanksPage() {
  return (
    <Suspense
      fallback={
        <div className="text-xs text-slate-400 py-8">
          Cargando cuentas bancarias y receptoras...
        </div>
      }
    >
      <AdminBanksContent />
    </Suspense>
  );
}
