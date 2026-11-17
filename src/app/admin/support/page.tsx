import React, { Suspense } from "react";
import { connection } from "next/server";
import { SupportConsole } from "@/components/admin/support-console";
import {
  getSupportSettings,
  listSupportTicketsAdmin,
} from "@/lib/server/repository";

async function AdminSupportContent() {
  await connection();
  const [settings, tickets] = await Promise.all([
    getSupportSettings(),
    listSupportTicketsAdmin(),
  ]);

  return (
    <SupportConsole initialSettings={settings} initialTickets={tickets} />
  );
}

export default function AdminSupportPage() {
  return (
    <Suspense
      fallback={
        <div className="text-xs text-slate-400 py-8">
          Cargando bandeja y canales de soporte...
        </div>
      }
    >
      <AdminSupportContent />
    </Suspense>
  );
}
