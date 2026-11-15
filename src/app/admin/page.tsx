import React, { Suspense } from "react";
import { connection } from "next/server";
import {
  OverviewConsole,
  type ProviderCapitalCardData,
} from "@/components/admin/overview-console";
import { isZenoBankConfigured } from "@/lib/server/env";
import {
  getActiveReceiverBankAccount,
  listBankNotifications,
} from "@/lib/server/pagomovil-store";
import {
  getBsRateCents,
  getMonthlyCapitalSnapshots,
  getZenoBinanceReceiver,
  listCatalog,
  listCustomersAdmin,
  listInventoryAdmin,
  listOrdersAdmin,
  listProviderConfigs,
  listSupplierItemCostsAdmin,
  listSupplierProvidersByOrderAdmin,
  listZenoPaymentProofsAdmin,
} from "@/lib/server/repository";
import type { EffectiveProviderId } from "@/lib/server/sales-metrics";
import {
  getCentralOneBalance,
  listCentralOneOrders,
} from "@/lib/server/suppliers/centralone";
import {
  getFazerCardsBalance,
  isFazerCardsProductId,
  listFazerCardsOrders,
} from "@/lib/server/suppliers/fazercards";
import { getReloadlyBalance } from "@/lib/server/suppliers/reloadly";

async function AdminOverviewContent() {
  await connection();
  const [
    orders,
    attentionOrders,
    catalog,
    inventory,
    providers,
    reloadly,
    centralOne,
    fazerCards,
    fazerOrdersReport,
    centralOneOrdersReport,
    bsRateCents,
    capitalSnapshots,
    customers,
    activePagoMovilAccount,
    pagoMovilNotifications,
    zenoReceiver,
    zenoProofs,
    actualItemCostCents,
    supplierProvidersByOrder,
  ] = await Promise.all([
    listOrdersAdmin(),
    listOrdersAdmin({ needsAttentionOnly: true }),
    listCatalog(true),
    listInventoryAdmin({ status: "AVAILABLE" }),
    listProviderConfigs(),
    getReloadlyBalance(),
    getCentralOneBalance(),
    getFazerCardsBalance(),
    listFazerCardsOrders(50),
    listCentralOneOrders(50),
    getBsRateCents(),
    getMonthlyCapitalSnapshots(),
    listCustomersAdmin(),
    getActiveReceiverBankAccount(),
    listBankNotifications(150),
    getZenoBinanceReceiver(),
    listZenoPaymentProofsAdmin(),
    listSupplierItemCostsAdmin(),
    listSupplierProvidersByOrderAdmin(),
  ]);

  let manualCostCents = 0;
  for (const product of catalog) {
    for (const variant of product.variants) {
      if (variant.availableStock > 0 && typeof variant.unitCostCents === "number") {
        manualCostCents += variant.availableStock * variant.unitCostCents;
      }
    }
  }

  const providerMap = new Map(providers.map((p) => [p.id, p]));

  const providerStatuses: ProviderCapitalCardData[] = [
    {
      id: "fazercards",
      label: "FazerCards API v2",
      subtitle: "Netflix, Gift Cards y Top-Ups",
      enabled: providerMap.get("fazercards")?.enabled ?? true,
      configured: fazerCards.configured,
      healthy: fazerCards.healthy,
      errorMessage: fazerCards.errorMessage,
      balanceCents: fazerCards.balanceCents,
      previousBalanceCents: null,
      apiSpentCents: fazerOrdersReport.healthy ? fazerOrdersReport.totalSpentCents : null,
      apiOrdersCount: fazerOrdersReport.healthy ? fazerOrdersReport.completedCount : null,
    },
    {
      id: "centralone",
      label: "Central One API",
      subtitle: "Gift Cards & PINs en vivo",
      enabled: providerMap.get("centralone")?.enabled ?? false,
      configured: centralOne.configured,
      healthy: centralOne.healthy,
      errorMessage: centralOne.errorMessage,
      balanceCents: centralOne.balanceCents,
      previousBalanceCents: null,
      apiSpentCents: centralOneOrdersReport.healthy
        ? centralOneOrdersReport.totalSpentCents
        : null,
      apiOrdersCount: centralOneOrdersReport.healthy
        ? centralOneOrdersReport.completedCount
        : null,
    },
    {
      id: "manual",
      label: "Stock Propio (CSV)",
      subtitle: "Inventario valorizado al costo",
      enabled: providerMap.get("manual_inventory")?.enabled ?? true,
      configured: true,
      healthy: true,
      balanceCents: manualCostCents,
      previousBalanceCents: null,
      codesAvailableCount: inventory.length,
    },
    {
      id: "reloadly",
      label: "Reloadly API",
      subtitle: "Solo cuentas KYC verificadas",
      enabled: providerMap.get("reloadly")?.enabled ?? false,
      configured: reloadly.configured,
      healthy: reloadly.healthy,
      errorMessage: reloadly.errorMessage,
      balanceCents: reloadly.balanceCents,
      previousBalanceCents: null,
    },
  ];

  const lowStockVariants = catalog.flatMap((p) =>
    p.variants
      .filter((v) => v.active && v.availableStock <= v.lowStockThreshold)
      .map((v) => ({
        productName: p.name,
        variantId: v.id,
        denominationLabel: v.denominationLabel,
        availableStock: v.availableStock,
        threshold: v.lowStockThreshold,
      }))
  );

  const creditHolders = customers
    .filter((c) => c.creditBalanceCents > 0)
    .sort((a, b) => b.creditBalanceCents - a.creditBalanceCents)
    .map((c) => ({
      id: c.id,
      email: c.email,
      creditBalanceCents: c.creditBalanceCents,
      ordersCount: c.ordersCount,
    }));

  const matchedNotificationByOrder: Record<
    string,
    {
      referenceFull: string | null;
      amountBsCents: number | null;
      senderPhone: string | null;
      senderBankCode: string | null;
      postedAt: string;
    }
  > = {};
  for (const n of pagoMovilNotifications) {
    if (n.status === "MATCHED" && n.matchedOrderId && !matchedNotificationByOrder[n.matchedOrderId]) {
      matchedNotificationByOrder[n.matchedOrderId] = {
        referenceFull: n.referenceFull,
        amountBsCents: n.amountBsCents,
        senderPhone: n.senderPhone,
        senderBankCode: n.senderBankCode,
        postedAt: n.postedAt,
      };
    }
  }

  const variantsById = new Map(
    catalog.flatMap((product) => product.variants.map((v) => [v.id, v] as const))
  );
  const fallbackProvidersByOrder: Record<string, EffectiveProviderId[]> = {};
  for (const order of orders) {
    if (order.fulfillments.length > 0) continue;
    const seen = new Set<EffectiveProviderId>(
      supplierProvidersByOrder[order.id] ?? []
    );
    if (seen.size === 0) {
      for (const item of order.items) {
        const variant = variantsById.get(item.variantId);
        if (!variant) continue;
        const isFazer =
          Boolean(variant.centraloneProductId) &&
          isFazerCardsProductId(variant.centraloneProductId);
        if (variant.sourcePriority === "centralone_only") {
          seen.add(isFazer ? "fazercards" : "centralone");
        } else if (variant.sourcePriority === "manual_then_centralone") {
          if (variant.availableStock <= 0 && variant.centraloneProductId) {
            seen.add(isFazer ? "fazercards" : "centralone");
          } else if (variant.availableStock > 0) {
            seen.add("manual");
          }
        } else if (variant.sourcePriority === "reloadly_only") {
          seen.add("reloadly");
        } else if (variant.sourcePriority === "manual_then_reloadly") {
          seen.add(variant.availableStock > 0 ? "manual" : "reloadly");
        } else if (variant.sourcePriority === "manual_only") {
          seen.add("manual");
        }
      }
    }
    if (seen.size > 0) {
      fallbackProvidersByOrder[order.id] = Array.from(seen);
    }
  }

  return (
    <OverviewConsole
      orders={orders}
      attentionCount={attentionOrders.length}
      lowStockVariants={lowStockVariants}
      providerStatuses={providerStatuses}
      initialSnapshots={capitalSnapshots}
      bsRateCents={bsRateCents}
      creditHolders={creditHolders}
      zenoConfigured={isZenoBankConfigured()}
      initialZenoReceiver={zenoReceiver}
      zenoProofs={zenoProofs}
      activePagoMovilAccount={activePagoMovilAccount}
      matchedPagoMovilByOrder={matchedNotificationByOrder}
      actualItemCostCents={actualItemCostCents}
      fazerOrdersReport={fazerOrdersReport}
      centralOneOrdersReport={centralOneOrdersReport}
      fallbackProvidersByOrder={fallbackProvidersByOrder}
    />
  );
}

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<div className="text-xs text-slate-400">Cargando panel ejecutivo...</div>}>
      <AdminOverviewContent />
    </Suspense>
  );
}
