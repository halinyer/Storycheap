import { NextResponse, type NextRequest } from "next/server";
import { getServerSessionUser } from "@/lib/server/auth";
import { resolveOrderUnderpayment } from "@/lib/server/fulfillment";
import { ORDER_STATUS_META } from "@/lib/server/state-machine";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getServerSessionUser();
  if (!sessionUser) {
    return NextResponse.json(
      { error: "Debes iniciar sesión en tu cuenta para gestionar este pago." },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  let body: { mode?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const mode = body.mode;
  if (mode !== "complete_with_credit" && mode !== "convert_to_credit_now") {
    return NextResponse.json(
      { error: "Modo de resolución no válido." },
      { status: 400 }
    );
  }

  try {
    const result = await resolveOrderUnderpayment({
      orderId: id,
      actorUser: sessionUser,
      mode,
    });

    return NextResponse.json({
      ok: true,
      outcome: result.outcome,
      creditDeltaCents: result.creditDeltaCents,
      order: result.order,
      statusMeta: ORDER_STATUS_META[result.order.status],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    if (msg === "ORDER_NOT_FOUND") {
      return NextResponse.json({ error: "Orden no encontrada." }, { status: 404 });
    }
    if (msg === "FORBIDDEN_ORDER_OWNER") {
      return NextResponse.json(
        { error: "Esta orden pertenece a otra cuenta." },
        { status: 403 }
      );
    }
    if (msg.startsWith("INSUFFICIENT_CREDIT_FOR_DIFFERENCE")) {
      return NextResponse.json(
        {
          error:
            "Tu saldo a favor disponible no alcanza para cubrir la diferencia faltante.",
        },
        { status: 400 }
      );
    }
    if (msg === "NO_PARTIAL_PAYMENT_DETECTED") {
      return NextResponse.json(
        { error: "Aún no se ha detectado ningún pago parcial en esta orden." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error:
          "No se pudo procesar el ajuste en este momento. Intenta de nuevo en unos segundos.",
      },
      { status: 409 }
    );
  }
}
