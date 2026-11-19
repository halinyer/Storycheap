import React, { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getBsRateCents, getProductBySlug } from "@/lib/server/repository";
import { getEffectiveCustomerBsRateCents } from "@/lib/server/pagomovil-store";
import { ensureFreshSupplierCatalogPrices } from "@/lib/server/supplier-sync";
import { ProductDetailClient } from "./product-detail-client";

async function ProductDetailLoader({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection();
  await ensureFreshSupplierCatalogPrices();
  const { slug } = await params;
  const [product, rawBsRateCents] = await Promise.all([
    getProductBySlug(slug),
    getBsRateCents(),
  ]);
  const bsRateCents = await getEffectiveCustomerBsRateCents(rawBsRateCents);
  if (!product) {
    notFound();
  }
  return (
    <ProductDetailClient
      product={product}
      initialBsRateCents={bsRateCents}
    />
  );
}

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 text-center text-xs text-slate-400">
          Cargando producto...
        </div>
      }
    >
      <ProductDetailLoader params={params} />
    </Suspense>
  );
}
