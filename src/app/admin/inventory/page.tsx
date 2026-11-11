import React, { Suspense } from "react";
import { connection } from "next/server";
import { InventoryConsole } from "@/components/admin/inventory-console";
import { listCatalog, listInventoryAdmin } from "@/lib/server/repository";

async function AdminInventoryContent() {
  await connection();
  const [catalog, inventory] = await Promise.all([
    listCatalog(true),
    listInventoryAdmin(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">
          Inventario Propio (Códigos CSV)
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Sube códigos digitales cifrados en bóveda. El sistema reserva automáticamente en el checkout y libera tras 20 min si el pago expira.
        </p>
      </div>
      <InventoryConsole catalog={catalog} inventory={inventory} />
    </div>
  );
}

export default function AdminInventoryPage() {
  return (
    <Suspense fallback={<div className="text-xs text-slate-400">Cargando inventario...</div>}>
      <AdminInventoryContent />
    </Suspense>
  );
}
