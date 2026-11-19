import React, { Suspense } from "react";
import { connection } from "next/server";
import { PagoMovilBdvConsole } from "@/components/admin/pagomovil-bdv-console";
import { loadAdminPortfolioSnapshot } from "@/lib/server/admin-portfolio";
import { getBdvApiBaseUrl, isBdvConciliacionConfigured } from "@/lib/server/env";
import {
  getPagoMovilSettings,
  listBankNotifications,
  listReceiverBankAccounts,
} from "@/lib/server/pagomovil-store";
import { getVenezuelaDateYmd } from "@/lib/server/payments/bdv-api";
import { getProviderConfig } from "@/lib/server/repository";

async function AdminPagoMovilContent() {
  await connection();
  const [
    providerCfg,
    portfolio,
    settings,
    receiverAccounts,
    notifications,
  ] = await Promise.all([
    getProviderConfig("pagomovil"),
    loadAdminPortfolioSnapshot({ includeOrdersReports: false }),
    getPagoMovilSettings(),
    listReceiverBankAccounts(),
    listBankNotifications(100),
  ]);

  const pendingOrders = portfolio.orders.filter(
    (o) =>
      (o.paymentGateway === "pagomovil" || o.paymentGateway === "pablito") &&
      (o.status === "PENDING_PAYMENT" ||
        o.status === "MANUAL_REVIEW" ||
        (o.status === "EXPIRED" && o.needsAttention))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">
          Pago Móvil · API Conciliación BDV
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Conciliación directa 24/7 con el Banco de Venezuela, control real de
          comisiones BDV (entrada/retiro) y gestión de tasa Bs/USD.
        </p>
      </div>

      <PagoMovilBdvConsole
        providerEnabled={Boolean(providerCfg?.enabled)}
        bdvApiConfigured={isBdvConciliacionConfigured()}
        bdvEndpoint={getBdvApiBaseUrl()}
        todayDateVe={getVenezuelaDateYmd()}
        bsRateCents={portfolio.bsRateCents}
        initialBsRatePolicy={portfolio.bsRatePolicy}
        initialLiveRates={portfolio.liveRates}
        position={portfolio.position}
        settings={settings}
        receiverAccounts={receiverAccounts}
        notifications={notifications}
        pendingOrders={pendingOrders}
      />
    </div>
  );
}

export default function AdminPagoMovilPage() {
  return (
    <Suspense
      fallback={
        <div className="text-xs text-slate-400">
          Cargando consola Pago Móvil BDV...
        </div>
      }
    >
      <AdminPagoMovilContent />
    </Suspense>
  );
}
