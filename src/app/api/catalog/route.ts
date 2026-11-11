import { NextResponse } from "next/server";
import { connection } from "next/server";
import { listCatalog } from "@/lib/server/repository";

export async function GET() {
  await connection();
  const products = await listCatalog(false);
  return NextResponse.json(
    { products },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
