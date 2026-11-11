import React, { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getProductBySlug } from "@/lib/server/repository";
import { ProductDetailClient } from "./product-detail-client";

async function ProductDetailLoader({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection();
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) {
    notFound();
  }
  return <ProductDetailClient product={product} />;
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
