import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { OrdersConsole } from "@/components/admin/orders-console";
import { getAdminIncludeTestsPreference } from "@/lib/server/admin-preferences";
import {
  listOrdersAdmin,
  listSupplierItemCostsAdmin,
} from "@/lib/server/repository";

async function AdminOrdersContent({
  searchParams,
}: {
  searchParams: Promise<{
    attention?: string;
    status?: string;
    scope?: string;
    gateway?: string;
    q?: string;
  }>;
}) {
  await connection();
  const sp = await searchParams;
  const attentionOnly = sp.attention === "1";
  const query = (sp.q ?? "").trim().slice(0, 80);
  const queryNorm = query.toLowerCase().replace(/^#/, "");

  const [allOrders, actualItemCostCents, includeTestOrders] = await Promise.all([
    listOrdersAdmin(),
    listSupplierItemCostsAdmin(),
    getAdminIncludeTestsPreference(),
  ]);

  if (queryNorm) {
    const exact = allOrders.filter(
      (o) => o.orderNumber.toLowerCase() === queryNorm
    );
    if (exact.length === 1) {
      redirect(`/admin/orders/${exact[0].id}`);
    }
  }

  const initialScope: "real" | "test" | "all" | "attention" = attentionOnly
    ? "attention"
    : sp.scope === "real" || sp.scope === "test" || sp.scope === "all"
      ? sp.scope
      : queryNorm
        ? "all"
        : includeTestOrders
          ? "all"
          : "real";

  const initialGateway =
    sp.gateway === "zenobank" || sp.gateway === "pagomovil"
      ? sp.gateway
      : "all";

  return (
    <OrdersConsole
      orders={allOrders}
      actualItemCostCents={actualItemCostCents}
      initialScope={initialScope}
      initialQuery={query}
      initialGateway={initialGateway}
    />
  );
}

export default function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    attention?: string;
    status?: string;
    scope?: string;
    gateway?: string;
    q?: string;
  }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="text-xs text-slate-400 py-8">Cargando órdenes...</div>
      }
    >
      <AdminOrdersContent searchParams={searchParams} />
    </Suspense>
  );
}
