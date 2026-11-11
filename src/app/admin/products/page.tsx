import React, { Suspense } from "react";
import { connection } from "next/server";
import { ProductsConsole } from "@/components/admin/products-console";
import { listCatalog } from "@/lib/server/repository";

async function AdminProductsContent() {
  await connection();
  const catalog = await listCatalog(true);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">
          Productos, Precios y Fuente de Entrega
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Configura precios autoritativos de servidor, umbrales de stock bajo y qué variantes pueden usar Reloadly solo cuando la cuenta tenga KYC verificado.
        </p>
      </div>
      <ProductsConsole catalog={catalog} />
    </div>
  );
}

export default function AdminProductsPage() {
  return (
    <Suspense fallback={<div className="text-xs text-slate-400">Cargando catálogo...</div>}>
      <AdminProductsContent />
    </Suspense>
  );
}
