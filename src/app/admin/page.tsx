import React, { Suspense } from "react";
import { connection } from "next/server";
import { OverviewConsole } from "@/components/admin/overview-console";
import { loadAdminPortfolioSnapshot } from "@/lib/server/admin-portfolio";

async function AdminOverviewContent() {
  await connection();
  const snap = await loadAdminPortfolioSnapshot({ includeOrdersReports: false });

  const historicalTestCandidateCount = snap.orders.filter(
    (o) =>
      !o.isTest &&
      (o.status === "DELIVERED" || o.paidCents > 0 || o.status === "PAID")
  ).length;

  return (
    <OverviewConsole
      orders={snap.orders}
      movements={snap.movements}
      suppliers={snap.suppliers}
      position={snap.position}
      actualItemCostCents={snap.actualItemCostCents}
      matchedBsByOrder={snap.matchedBsByOrder}
      bsRateCents={snap.bsRateCents}
      bsRatePolicy={snap.bsRatePolicy}
      liveRates={snap.liveRates}
      includeTestOrders={snap.includeTestOrders}
      unreviewedPagoMovilCount={snap.unreviewedPagoMovilCount}
      historicalTestCandidateCount={historicalTestCandidateCount}
    />
  );
}

export default function AdminOverviewPage() {
  return (
    <Suspense
      fallback={
        <div className="text-xs text-slate-400 py-8">
          Cargando resumen ejecutivo...
        </div>
      }
    >
      <AdminOverviewContent />
    </Suspense>
  );
}
