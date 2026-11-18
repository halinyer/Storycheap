import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getBsRateCents, listCatalog } from "@/lib/server/repository";
import { ensureFreshSupplierCatalogPrices } from "@/lib/server/supplier-sync";

export async function GET() {
  await connection();
  await ensureFreshSupplierCatalogPrices();
  const [rawProducts, bsRateCents] = await Promise.all([
    listCatalog(false),
    getBsRateCents(),
  ]);
  const products = rawProducts.map((p) => ({
    ...p,
    variants: p.variants.map(({ unitCostCents: _omit, ...v }) => {
      void _omit;
      return v;
    }),
  }));
  return NextResponse.json(
    { products, bsRateCents },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
