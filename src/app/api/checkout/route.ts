import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSessionUser } from "@/lib/server/auth";
import { initiateCheckout } from "@/lib/server/checkout-service";
import {
  appendOrderAccessCookieValue,
  ORDER_ACCESS_COOKIE,
} from "@/lib/server/order-access";
import { CheckoutValidationError } from "@/lib/server/pricing";
import { checkRateLimit } from "@/lib/server/rate-limit";

const checkoutSchema = z.object({
  email: z.string().trim().email("Correo electrónico inválido"),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid("Variante de producto inválida"),
        quantity: z.number().int().min(1).max(10),
      })
    )
    .min(1, "Agrega al menos un producto al carrito")
    .max(20),
  applyStoreCredit: z.boolean().optional().default(true),
  paymentGateway: z.enum(["zenobank", "pablito"]).optional().default("zenobank"),
});

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const rl = checkRateLimit({
    key: `checkout:${ip}`,
    limit: 12,
    windowMs: 60_000,
  });

  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "Demasiados intentos de compra. Espera un momento antes de reintentar.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload JSON inválido." }, { status: 400 });
  }

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Datos de checkout inválidos.",
      },
      { status: 400 }
    );
  }

  try {
    const sessionUser = await getServerSessionUser();
    const result = await initiateCheckout({
      email: parsed.data.email,
      items: parsed.data.items,
      applyStoreCredit: parsed.data.applyStoreCredit,
      paymentGateway: parsed.data.paymentGateway,
      sessionUser,
      ipAddress: ip === "unknown" ? null : ip,
    });

    const response = NextResponse.json(
      {
        orderId: result.order.id,
        orderNumber: result.order.orderNumber,
        status: result.order.status,
        checkoutUrl: result.checkoutUrl,
        paidInFullByCredit: result.paidInFullByCredit,
      },
      { status: 201 }
    );

    const cookieVal = await appendOrderAccessCookieValue(result.order.id);
    response.cookies.set(ORDER_ACCESS_COOKIE, cookieVal, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    if (err instanceof CheckoutValidationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
    }
    const msg =
      err instanceof Error ? err.message : "Error inesperado al crear la orden.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
