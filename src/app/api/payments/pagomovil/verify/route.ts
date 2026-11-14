import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSessionUser } from "@/lib/server/auth";
import { hasOrderAccessCookie } from "@/lib/server/order-access";
import {
  PagoMovilAuthError,
  verifyOrderPagoMovilClaim,
} from "@/lib/server/payments/pagomovil-bot";

const verifySchema = z.object({
  orderId: z.string().min(1),
  referenceDigits: z.string().trim().min(4).max(32),
  senderBankCode: z.string().trim().max(12).optional().nullable(),
  senderPhone: z.string().trim().max(25).optional().nullable(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "JSON inválido en solicitud de verificación." },
      { status: 400 }
    );
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Datos inválidos. Verifica la referencia bancaria ingresada.",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  try {
    const [actorUser, hasOrderCookie] = await Promise.all([
      getServerSessionUser(),
      hasOrderAccessCookie(parsed.data.orderId),
    ]);

    const result = await verifyOrderPagoMovilClaim({
      orderId: parsed.data.orderId,
      actorUser,
      hasOrderCookie,
      referenceDigits: parsed.data.referenceDigits,
      senderBankCode: parsed.data.senderBankCode ?? null,
      senderPhone: parsed.data.senderPhone ?? null,
    });

    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
    });
  } catch (err) {
    if (err instanceof PagoMovilAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/payments/pagomovil/verify] Error:", err);
    return NextResponse.json(
      { error: "No se pudo verificar el Pago Móvil." },
      { status: 500 }
    );
  }
}
