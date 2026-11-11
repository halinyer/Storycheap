import { connection, NextResponse } from "next/server";
import { AuthError, requireAdminUser } from "@/lib/server/auth";
import { getReloadlyBalance } from "@/lib/server/suppliers/reloadly";

export async function GET() {
  await connection();
  try {
    await requireAdminUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const status = await getReloadlyBalance();
  return NextResponse.json(status, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
