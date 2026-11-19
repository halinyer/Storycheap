import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  isLoginModeTarget,
  normalizeTargetSchema,
  validateTargetPayloadAgainstSchema,
} from "@/lib/topup-targets";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { getVariantsLookupByIds } from "@/lib/server/repository";
import { validateCentralOnePlayer } from "@/lib/server/suppliers/centralone";

const validatePlayerSchema = z.object({
  variantId: z.string().uuid("Variante inválida"),
  targetPayload: z.record(z.string().min(1).max(64), z.string().max(64)),
});

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  // Protect Central One's global 30 req / 60s validation quota per IP
  const rl = checkRateLimit({
    key: `validate_player:${ip}`,
    limit: 12,
    windowMs: 60_000,
  });

  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          "Demasiadas consultas de verificación. Espera unos segundos e intenta de nuevo.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Payload JSON inválido." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parsed = validatePlayerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos de jugador inválidos." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const lookup = await getVariantsLookupByIds([parsed.data.variantId]);
  const found = lookup.get(parsed.data.variantId);
  if (!found || !found.product.active || !found.variant.active) {
    return NextResponse.json(
      { error: "Producto no disponible." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { variant, product } = found;
  if (!variant.requiresTarget || !variant.centraloneProductId) {
    return NextResponse.json(
      { error: "Este producto entrega un código PIN y no requiere ID de jugador." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const schema = normalizeTargetSchema(variant.targetFields, variant.targetSchema);
  if (isLoginModeTarget(variant.targetFields, schema, product.name)) {
    return NextResponse.json(
      { error: "Este producto no está habilitado para recarga directa por ID." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const fieldCheck = validateTargetPayloadAgainstSchema(
    parsed.data.targetPayload,
    schema
  );
  if (!fieldCheck.ok) {
    return NextResponse.json(
      { error: fieldCheck.error },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const result = await validateCentralOnePlayer({
    productId: variant.centraloneProductId,
    targetPayload: fieldCheck.cleanPayload,
  });

  return NextResponse.json(
    {
      ok: true,
      status: result.status,
      playerName: result.playerName,
      reason: result.reason ?? null,
      cleanPayload: fieldCheck.cleanPayload,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
