import React, { Suspense } from "react";
import { connection } from "next/server";
import { PagoMovilBotConsole } from "@/components/admin/pagomovil-bot-console";
import { getSiteUrl } from "@/lib/server/env";
import {
  getPagoMovilBotSettings,
  isBotWatchdogHealthy,
  listBankNotifications,
  listBotDevices,
  listReceiverBankAccounts,
} from "@/lib/server/pagomovil-store";
import {
  getBsRateCents,
  getProviderConfig,
  listOrdersAdmin,
} from "@/lib/server/repository";

async function AdminPagoMovilContent() {
  await connection();
  const [
    providerCfg,
    bsRateCents,
    settings,
    receiverAccounts,
    devices,
    notifications,
    allOrders,
  ] = await Promise.all([
    getProviderConfig("pagomovil"),
    getBsRateCents(),
    getPagoMovilBotSettings(),
    listReceiverBankAccounts(),
    listBotDevices(),
    listBankNotifications(100),
    listOrdersAdmin(),
  ]);

  const watchdog = await isBotWatchdogHealthy(settings);
  const pendingOrders = allOrders.filter(
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
          Pasarela Pago Móvil Venezuela
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Conciliación automática de transferencias y Pago Móvil vía notificaciones bancarias o correo cifrado con HMAC-SHA256.
        </p>
      </div>

      <PagoMovilBotConsole
        siteUrl={getSiteUrl()}
        providerEnabled={Boolean(providerCfg?.enabled)}
        bsRateCents={bsRateCents}
        watchdog={watchdog}
        settings={settings}
        receiverAccounts={receiverAccounts}
        devices={devices}
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
          Cargando consola Pago Móvil...
        </div>
      }
    >
      <AdminPagoMovilContent />
    </Suspense>
  );
}
