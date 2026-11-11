import React, { Suspense } from "react";
import { connection } from "next/server";
import { CustomersConsole } from "@/components/admin/customers-console";
import { listCustomersAdmin } from "@/lib/server/repository";

async function AdminCustomersContent() {
  await connection();
  const customers = await listCustomersAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">
          Clientes y Libro Mayor (Saldo a favor)
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Todos los cambios de saldo son asientos inmutables (append-only) vinculados a tu cuenta de operador.
        </p>
      </div>
      <CustomersConsole customers={customers} />
    </div>
  );
}

export default function AdminCustomersPage() {
  return (
    <Suspense fallback={<div className="text-xs text-slate-400">Cargando clientes...</div>}>
      <AdminCustomersContent />
    </Suspense>
  );
}
