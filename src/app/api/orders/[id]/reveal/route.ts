import { NextResponse, type NextRequest } from "next/server";
import { getServerSessionUser } from "@/lib/server/auth";
import { hasOrderAccessCookie } from "@/lib/server/order-access";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { getOrderById, revealOrderCodes } from "@/lib/server/repository";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const rl = checkRateLimit({
    key: `reveal:${id}:${ip}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiados intentos de revelación. Espera un minuto." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const order = await getOrderById(id);
  if (!order) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  const sessionUser = await getServerSessionUser();
  const isOwner = Boolean(sessionUser && order.userId === sessionUser.id);
  const hasCookieCap = await hasOrderAccessCookie(order.id);

  // Admins are explicitly prohibited from reading plaintext customer PINs
  if (!isOwner && !hasCookieCap) {
    return NextResponse.json(
      { error: "Solo el dueño de la orden puede revelar los códigos." },
      { status: 403 }
    );
  }

  if (order.status !== "DELIVERED" && order.status !== "PARTIAL") {
    return NextResponse.json(
      { error: "Esta orden aún no tiene códigos listos para revelar." },
      { status: 409 }
    );
  }

  const actorUserId = sessionUser?.id ?? order.userId;
  if (!actorUserId) {
    return NextResponse.json(
      { error: "Sesión inválida para revelar códigos." },
      { status: 401 }
    );
  }

  const codes = await revealOrderCodes({
    orderId: order.id,
    actorUserId,
  });

  return NextResponse.json(
    { orderId: order.id, codes },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
      },
    }
  );
}
