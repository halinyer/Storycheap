import React, { Suspense } from "react";
import { connection } from "next/server";
import { ProvidersConsole } from "@/components/admin/providers-console";
import {
  listProviderConfigs,
  listWebhookEventsAdmin,
} from "@/lib/server/repository";
import { getReloadlyBalance } from "@/lib/server/suppliers/reloadly";

async function AdminProvidersContent() {
  await connection();
  const [providers, reloadlyStatus, webhooks] = await Promise.all([
    listProviderConfigs(),
    getReloadlyBalance(),
    listWebhookEventsAdmin(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">
          Pasarelas, Kill Switches y Webhooks
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Detén el checkout o una pasarela al instante ante cualquier anomalía, e inspecciona las firmas Svix recibidas de ZenoBank.
        </p>
      </div>
      <ProvidersConsole
        providers={providers}
        reloadlyStatus={reloadlyStatus}
        webhooks={webhooks}
      />
    </div>
  );
}

export default function AdminProvidersPage() {
  return (
    <Suspense fallback={<div className="text-xs text-slate-400">Cargando pasarelas...</div>}>
      <AdminProvidersContent />
    </Suspense>
  );
}
