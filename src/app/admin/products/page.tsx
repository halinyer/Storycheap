import React, { Suspense } from "react";
import { connection } from "next/server";
import { ProductsConsole } from "@/components/admin/products-console";
import {
  getBsRateCents,
  getVariantPricingMetaMap,
  listCatalog,
  listProviderConfigs,
} from "@/lib/server/repository";
import { getCachedCentralOneBalanceCents } from "@/lib/server/suppliers/centralone";
import { getCachedFazerCardsBalanceCents } from "@/lib/server/suppliers/fazercards";

async function AdminProductsContent({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  await connection();
  const [
    sp,
    catalog,
    providers,
    pricingMetaMap,
    centralOneBalanceCents,
    fazerCardsBalanceCents,
    bsRateCents,
  ] = await Promise.all([
    searchParams,
    listCatalog(true),
    listProviderConfigs(),
    getVariantPricingMetaMap(),
    getCachedCentralOneBalanceCents(),
    getCachedFazerCardsBalanceCents(),
    getBsRateCents(),
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
    <ProductsConsole
      catalog={catalog}
      pricingMetaMap={pricingMetaMap}
      reloadlyEnabled={reloadlyEnabled}
      centralOneEnabled={centralOneEnabled}
      centralOneBalanceCents={centralOneBalanceCents}
      fazerCardsEnabled={fazerCardsEnabled}
      fazerCardsBalanceCents={fazerCardsBalanceCents}
      bsRateCents={bsRateCents}
      initialProductId={sp.product ?? null}
    />
  );
}

export default function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="text-xs text-slate-400 py-8">Cargando estudio de Gift Cards...</div>
      }
    >
      <AdminProductsContent searchParams={searchParams} />
    </Suspense>
  );
}
