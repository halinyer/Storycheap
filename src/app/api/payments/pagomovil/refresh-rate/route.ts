import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSessionUser } from "@/lib/server/auth";
import { hasOrderAccessCookie } from "@/lib/server/order-access";
import {
  PagoMovilAuthError,
  refreshPagoMovilOrderRate,
} from "@/lib/server/payments/pagomovil-bot";

const refreshSchema = z.object({
  orderId: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Falta orderId válido." }, { status: 400 });
  }

  try {
    const [actorUser, hasOrderCookie] = await Promise.all([
      getServerSessionUser(),
      hasOrderAccessCookie(parsed.data.orderId),
    ]);

    const updated = await refreshPagoMovilOrderRate({
      orderId: parsed.data.orderId,
      actorUser,
      hasOrderCookie,
    });

    return NextResponse.json({ ok: true, ...updated });
  } catch (err) {
    if (err instanceof PagoMovilAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "No se pudo actualizar la tasa de la orden.",
      },
      { status: 400 }
    );
  }
}
