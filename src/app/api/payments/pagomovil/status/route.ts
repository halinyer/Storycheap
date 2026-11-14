import { connection, NextResponse } from "next/server";
import { getServerSessionUser } from "@/lib/server/auth";
import { hasOrderAccessCookie } from "@/lib/server/order-access";
import {
  getPagoMovilOrderPublicStatus,
  PagoMovilAuthError,
} from "@/lib/server/payments/pagomovil-bot";

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId")?.trim();
  if (!orderId) {
    return NextResponse.json(
      { error: "Falta el parámetro orderId." },
      { status: 400 }
    );
  }

  try {
    const [actorUser, hasOrderCookie] = await Promise.all([
      getServerSessionUser(),
      hasOrderAccessCookie(orderId),
    ]);

    const status = await getPagoMovilOrderPublicStatus({
      orderId,
      actorUser,
      hasOrderCookie,
    });

    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof PagoMovilAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/payments/pagomovil/status] Error:", err);
    return NextResponse.json(
      { error: "No se pudo consultar el estado del Pago Móvil." },
      { status: 500 }
    );
  }
}
