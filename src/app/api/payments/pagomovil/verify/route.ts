import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSessionUser } from "@/lib/server/auth";
import { hasOrderAccessCookie } from "@/lib/server/order-access";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { parseUserBsInputToCents } from "@/lib/server/payments/bdv-api";
import {
  PagoMovilAuthError,
  verifyOrderPagoMovilClaim,
} from "@/lib/server/payments/pagomovil-bdv";

const verifySchema = z.object({
  orderId: z.string().min(1),
  referenceDigits: z.string().trim().min(4).max(32),
  senderBankCode: z.string().trim().min(4).max(12),
  senderPhone: z.string().trim().min(10).max(25),
  senderDni: z.string().trim().min(5).max(20),
  amountBs: z.union([z.string(), z.number()]).optional().nullable(),
  amountBsCents: z.number().int().positive().optional().nullable(),
  paymentDate: z.string().trim().max(16).optional().nullable(),
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
        error:
          "Completa todos los campos requeridos por Banco de Venezuela (Referencia, Banco, Teléfono y Cédula).",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const rl = checkRateLimit({
    key: `pm_bdv_verify:${parsed.data.orderId}:${ip}`,
    limit: 12,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        ok: false,
        code: "BDV_API_ERROR",
        error:
          "Demasiados intentos de verificación. Espera unos segundos antes de volver a consultar con Banco de Venezuela.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      }
    );
  }

  const resolvedAmountBsCents =
    typeof parsed.data.amountBsCents === "number" &&
    parsed.data.amountBsCents > 0
      ? parsed.data.amountBsCents
      : parsed.data.amountBs !== undefined && parsed.data.amountBs !== null
        ? parseUserBsInputToCents(parsed.data.amountBs)
        : null;

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
      senderBankCode: parsed.data.senderBankCode,
      senderPhone: parsed.data.senderPhone,
      senderDni: parsed.data.senderDni,
      amountBsCents: resolvedAmountBsCents,
      paymentDate: parsed.data.paymentDate ?? null,
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
      { error: "No se pudo verificar el Pago Móvil con Banco de Venezuela." },
      { status: 500 }
    );
  }
}
