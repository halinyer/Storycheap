import React, { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminTopbar } from "@/components/layout/admin-topbar";
import { getAdminIncludeTestsPreference } from "@/lib/server/admin-preferences";
import { AuthError, requireAdminUser } from "@/lib/server/auth";
import {
  getBsRateCents,
  listCatalog,
  listCustomersAdmin,
  listInventoryAdmin,
  listOrdersAdmin,
  listProviderConfigs,
  listSupplierItemCostsAdmin,
  listSupportTicketsAdmin,
  listTreasuryMovementsAdmin,
} from "@/lib/server/repository";
import { fetchSuppliersPortfolioSnapshot } from "@/lib/server/suppliers/registry";
import { computeTreasuryPosition } from "@/lib/server/treasury-metrics";
import { Lock } from "lucide-react";

async function AdminAuthGate({ children }: { children: React.ReactNode }) {
  await connection();
  let adminUserEmail = "admin@storycheap.com";
  try {
    const adminUser = await requireAdminUser();
    adminUserEmail = adminUser.email;
  } catch (err) {
    const message =
      err instanceof AuthError
        ? err.message
        : "Acceso restringido a operadores autorizados.";
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="text-2xl font-black text-white">Acceso Administrativo</h1>
        <p className="text-xs text-slate-400 leading-relaxed">{message}</p>
        <Link
          href="/login?next=/admin"
          className="inline-flex px-5 py-3 rounded-2xl bg-white text-slate-950 font-black text-xs"
        >
          Iniciar sesión Admin
        </Link>
      </div>
    );
  }

  const [
    attentionOrders,
    allOrders,
    catalog,
    inventory,
    providers,
    movements,
    customers,
    bsRateCents,
    actualItemCostCents,
    includeTestOrders,
    supportTickets,
  ] = await Promise.all([
    listOrdersAdmin({ needsAttentionOnly: true }),
    listOrdersAdmin(),
    listCatalog(true),
    listInventoryAdmin({ status: "AVAILABLE" }),
    listProviderConfigs(),
    listTreasuryMovementsAdmin(),
    listCustomersAdmin(),
    getBsRateCents(),
    listSupplierItemCostsAdmin(),
    getAdminIncludeTestsPreference(),
    listSupportTicketsAdmin(),
  ]);

  const openSupportTicketsCount = supportTickets.filter(
    (t) => t.status !== "RESOLVED"
  ).length;

  const lowStockCount = catalog
    .flatMap((p) => p.variants)
    .filter((v) => v.active && v.availableStock <= v.lowStockThreshold).length;

  const suppliers = await fetchSuppliersPortfolioSnapshot({
    providers,
    catalog,
    availableInventoryCount: inventory.length,
    allOrders,
    periodOrders: allOrders,
    actualItemCostCents,
    includeTestOrders,
    includeOrdersReports: false,
  });

  const creditLiabilityUsdCents = customers.reduce(
    (sum, c) => sum + Math.max(0, c.creditBalanceCents),
    0
  );

  const treasury = computeTreasuryPosition({
    orders: allOrders,
    movements,
    suppliers,
    actualItemCostCents,
    creditLiabilityUsdCents,
    includeTestOrders,
    bsRateCents,
  });

  const unhealthySuppliersCount = suppliers.filter(
    (s) => s.enabled && s.configured && !s.healthy
  ).length;

  return (
    <div className="min-h-screen flex flex-col bg-[#08090f]">
      <AdminTopbar
        totalLiveEquityUsdCents={treasury.totalBusinessEquityUsdCents}
        totalSuppliersUsdCents={treasury.totalSuppliersUsdCents}
        totalReceiversUsdCents={treasury.totalReceiversUsdCents}
        bsRateCents={bsRateCents}
        includeTestOrders={includeTestOrders}
        needsAttentionCount={attentionOrders.length}
        lowStockCount={lowStockCount}
        unhealthySuppliersCount={unhealthySuppliersCount}
        adminEmail={adminUserEmail}
      />
      <div className="max-w-[1680px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1">
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <AdminSidebar
            needsAttentionCount={attentionOrders.length}
            lowStockCount={lowStockCount}
            unhealthySuppliersCount={unhealthySuppliersCount}
            openSupportTicketsCount={openSupportTicketsCount}
          />
          <div className="flex-1 min-w-0 w-full pb-12">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="max-w-[1680px] mx-auto px-6 py-20 text-center text-xs text-slate-400">
          Cargando consola administrativa...
        </div>
      }
    >
      <AdminAuthGate>{children}</AdminAuthGate>
    </Suspense>
  );
}
