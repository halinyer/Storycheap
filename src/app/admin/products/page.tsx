import React, { Suspense } from "react";
import { connection } from "next/server";
import { ProductsConsole } from "@/components/admin/products-console";
import {
  getVariantPricingMetaMap,
  listCatalog,
  listProviderConfigs,
} from "@/lib/server/repository";
import { getCachedCentralOneBalanceCents } from "@/lib/server/suppliers/centralone";
import { getCachedFazerCardsBalanceCents } from "@/lib/server/suppliers/fazercards";

async function AdminProductsContent() {
  await connection();
  const [
    catalog,
    providers,
    pricingMetaMap,
    centralOneBalanceCents,
    fazerCardsBalanceCents,
  ] = await Promise.all([
    listCatalog(true),
    listProviderConfigs(),
    getVariantPricingMetaMap(),
    getCachedCentralOneBalanceCents(),
    getCachedFazerCardsBalanceCents(),
  ]);
  const reloadlyEnabled = Boolean(
    providers.find((p) => p.id === "reloadly")?.enabled
  );
  const centralOneEnabled = Boolean(
    providers.find((p) => p.id === "centralone")?.enabled
  );
  const fazerCardsEnabled = Boolean(
    providers.find((p) => p.id === "fazercards")?.enabled ?? true
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Gift Cards y Distribuidores
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Controla qué tarjetas se venden en la tienda, su precio y qué proveedor las entrega (Stock CSV, Central One o FazerCards API v2).
        </p>
      </div>
      <ProductsConsole
        catalog={catalog}
        pricingMetaMap={pricingMetaMap}
        reloadlyEnabled={reloadlyEnabled}
        centralOneEnabled={centralOneEnabled}
        centralOneBalanceCents={centralOneBalanceCents}
        fazerCardsEnabled={fazerCardsEnabled}
        fazerCardsBalanceCents={fazerCardsBalanceCents}
      />
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
