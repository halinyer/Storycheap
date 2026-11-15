import React, { Suspense } from "react";
import { connection } from "next/server";
import { AuditConsole } from "@/components/admin/audit-console";
import { getAdminIncludeTestsPreference } from "@/lib/server/admin-preferences";
import {
  getMonthlyCapitalSnapshots,
  listAuditLogsAdmin,
  listOrdersAdmin,
  listSupplierItemCostsAdmin,
} from "@/lib/server/repository";
import { summarizeOrdersMetrics } from "@/lib/server/sales-metrics";
import {
  getCentralOneBalance,
  listCentralOneOrders,
} from "@/lib/server/suppliers/centralone";
import {
  getFazerCardsBalance,
  listFazerCardsOrders,
} from "@/lib/server/suppliers/fazercards";

async function AdminAuditContent() {
  await connection();

  const [
    logs,
    fazerBal,
    fazerOrdersReport,
    centralOneBal,
    centralOneOrdersReport,
    orders,
    actualItemCostCents,
    snapshots,
    includeTestOrders,
  ] = await Promise.all([
    listAuditLogsAdmin(150),
    getFazerCardsBalance(),
    listFazerCardsOrders(50),
    getCentralOneBalance(),
    listCentralOneOrders(50),
    listOrdersAdmin(),
    listSupplierItemCostsAdmin(),
    getMonthlyCapitalSnapshots(),
    getAdminIncludeTestsPreference(),
  ]);

  const metrics = summarizeOrdersMetrics(orders, actualItemCostCents, {
    includeTestOrders,
  });

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}`;

  return (
    <AuditConsole
      logs={logs}
      fazerBalanceCents={fazerBal.balanceCents}
      fazerHealthy={fazerBal.healthy}
      fazerError={fazerBal.errorMessage}
      fazerOrdersReport={fazerOrdersReport}
      dbFazerConsumedCents={metrics.byProvider.fazercards?.consumedCents ?? 0}
      dbFazerCodes={metrics.byProvider.fazercards?.deliveredCodes ?? 0}
      centralOneBalanceCents={centralOneBal.balanceCents}
      centralOneHealthy={centralOneBal.healthy}
      centralOneError={centralOneBal.errorMessage}
      centralOneOrdersReport={centralOneOrdersReport}
      dbCentralOneConsumedCents={
        metrics.byProvider.centralone?.consumedCents ?? 0
      }
      dbCentralOneCodes={metrics.byProvider.centralone?.deliveredCodes ?? 0}
      initialSnapshots={snapshots}
      currentMonthKey={currentMonthKey}
      includeTestOrders={includeTestOrders}
    />
  );
}

export default function AdminAuditPage() {
  return (
    <Suspense
      fallback={
        <div className="text-xs text-slate-400 py-8">
          Cargando auditoría API y bitácora...
        </div>
      }
    >
      <AdminAuditContent />
    </Suspense>
  );
}
