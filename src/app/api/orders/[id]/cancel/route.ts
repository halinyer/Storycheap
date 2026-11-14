import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSessionUser } from "@/lib/server/auth";
import {
  cancelOrderByCustomer,
  CancelOrderError,
} from "@/lib/server/fulfillment";
import { checkRateLimit } from "@/lib/server/rate-limit";

const cancelBodySchema = z.object({
  forceAfterReport: z.boolean().optional().default(false),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const rl = checkRateLimit({
    key: `cancel-order:${id}:${ip}`,
    limit: 20,
    windowMs: 60_000,
  });

  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera un momento." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  let rawBody: unknown = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) {
      rawBody = JSON.parse(text);
    }
  } catch {
    return NextResponse.json(
      { error: "Payload JSON inválido." },
      { status: 400 }
    );
  }

  const parsed = cancelBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parámetros de cancelación inválidos." },
      { status: 400 }
    );
  }

  const sessionUser = await getServerSessionUser();

  try {
    const result = await cancelOrderByCustomer({
      orderId: id,
      actorUser: sessionUser,
      forceAfterReport: parsed.data.forceAfterReport,
    });

    return NextResponse.json(
      {
        ok: true,
        outcome: result.outcome,
        order: result.order,
        releasedCodesCount: result.releasedCodesCount,
        refundedCreditCents: result.refundedCreditCents,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof CancelOrderError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      );
    }

    console.error("[api/orders/[id]/cancel] Error:", err);
    return NextResponse.json(
      { error: "No se pudo cancelar la orden en este momento." },
      { status: 500 }
    );
  }
}
