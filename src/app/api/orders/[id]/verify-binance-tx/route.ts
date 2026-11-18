import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSessionUser } from "@/lib/server/auth";
import {
  applyVerifiedBinancePayTxToOrder,
  autoReconcileBinancePayForOrder,
  BinancePayVerifyError,
} from "@/lib/server/fulfillment";
import { hasOrderAccessCookie } from "@/lib/server/order-access";
import {
  BinancePayApiError,
  BinancePayConfigError,
  BinancePayRegionBlockedError,
} from "@/lib/server/payments/binance-pay";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { getOrderById } from "@/lib/server/repository";
import { ORDER_STATUS_META } from "@/lib/server/state-machine";

const bodySchema = z.object({
  transactionId: z.string().trim().max(80).optional(),
  autoDetect: z.boolean().optional(),
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
    key: `verify-binance-tx:${id}:${ip}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera un momento e intenta de nuevo." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const order = await getOrderById(id);
  if (!order) {
    return NextResponse.json({ error: "Orden no encontrada." }, { status: 404 });
  }

  const sessionUser = await getServerSessionUser();
  const isOwner = Boolean(sessionUser && order.userId === sessionUser.id);
  const isAdmin = Boolean(sessionUser?.role === "admin");
  const hasCookieCap = await hasOrderAccessCookie(order.id);
  if (!isOwner && !isAdmin && !hasCookieCap) {
    return NextResponse.json(
      { error: "No autorizado para verificar pagos de esta orden." },
      { status: 403 }
    );
  }

  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Ingresa un ID de transacción Binance Pay válido (por ejemplo P_A25QH5...).",
      },
      { status: 400 }
    );
  }

  const txIdInput = parsed.data.transactionId?.trim() ?? "";
  const isAutoDetect = Boolean(parsed.data.autoDetect) || txIdInput.length === 0;

  if (!isAutoDetect && txIdInput.length < 6) {
    return NextResponse.json(
      {
        error:
          "Ingresa un ID de transacción Binance Pay válido (por ejemplo P_A25QH5...).",
      },
      { status: 400 }
    );
  }

  try {
    if (isAutoDetect) {
      const autoRes = await autoReconcileBinancePayForOrder({
        orderId: order.id,
        actorUser: sessionUser,
        source: "customer_auto_verify",
        minAgeMs: 0,
      });

      if (!autoRes.matched) {
        return NextResponse.json(
          {
            error:
              "Aún no detectamos un depósito nuevo en Binance Pay para esta orden. Si ya enviaste los USDT, espera unos segundos o pega tu ID de transacción (P_...) abajo.",
          },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          ok: true,
          outcome: autoRes.mode,
          receivedCents: autoRes.receivedCents,
          missingCents: autoRes.missingCents,
          surplusCents: autoRes.surplusCents,
          tx: {
            transactionId: autoRes.tx.transactionId,
            amount: autoRes.tx.amount,
            currency: autoRes.tx.currency,
            usdCents: autoRes.tx.usdCents,
          },
          order: autoRes.order,
          statusMeta: ORDER_STATUS_META[autoRes.order.status],
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    const res = await applyVerifiedBinancePayTxToOrder({
      orderId: order.id,
      transactionId: txIdInput,
      actorUser: sessionUser,
      source: "customer_tx_verify",
    });

    return NextResponse.json(
      {
        ok: true,
        outcome: res.mode,
        receivedCents: res.receivedCents,
        missingCents: res.missingCents,
        surplusCents: res.surplusCents,
        tx: {
          transactionId: res.tx.transactionId,
          amount: res.tx.amount,
          currency: res.tx.currency,
          usdCents: res.tx.usdCents,
        },
        order: res.order,
        statusMeta: ORDER_STATUS_META[res.order.status],
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof BinancePayVerifyError || err instanceof BinancePayApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof BinancePayRegionBlockedError) {
      return NextResponse.json(
        {
          error:
            "Binance Pay bloqueó la consulta directa desde esta región del servidor (HTTP 451). Contáctanos por soporte/WhatsApp con tu ID de transacción para liberarla al instante.",
        },
        { status: 503 }
      );
    }
    if (err instanceof BinancePayConfigError) {
      return NextResponse.json(
        {
          error:
            "La verificación directa por API de Binance Pay no está configurada. Contáctanos por soporte con tu ID de transacción.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "No se pudo verificar la transacción en Binance Pay.",
      },
      { status: 500 }
    );
  }
}
