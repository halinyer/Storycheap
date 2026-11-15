import React, { Suspense } from "react";
import { connection } from "next/server";
import { ProvidersConsole } from "@/components/admin/providers-console";
import { loadAdminPortfolioSnapshot } from "@/lib/server/admin-portfolio";
import { listWebhookEventsAdmin } from "@/lib/server/repository";

async function AdminProvidersContent() {
  await connection();
  const [snap, webhooks] = await Promise.all([
    loadAdminPortfolioSnapshot({ includeOrdersReports: true }),
    listWebhookEventsAdmin(),
  ]);

  return (
    <ProvidersConsole
      initialProviders={snap.providers}
      webhooks={webhooks}
      suppliers={snap.suppliers}
      totalSuppliersUsdCents={snap.position.totalSuppliersUsdCents}
    />
  );
}

export default function AdminProvidersPage() {
  return (
    <Suspense
      fallback={
        <div className="text-xs text-slate-400 py-8">
          Cargando distribuidores y proveedores...
        </div>
      }
    >
      <AdminProvidersContent />
    </Suspense>
  );
}
