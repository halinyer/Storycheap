import { NextResponse } from "next/server";
import {
  ingestBotNotification,
  PagoMovilAuthError,
  parseBotPayloadRaw,
} from "@/lib/server/payments/pagomovil-bot";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    if (!rawBody.trim()) {
      return NextResponse.json(
        { error: "El cuerpo de la notificación está vacío." },
        { status: 400 }
      );
    }

    const contentType = request.headers.get("content-type");
    try {
      parseBotPayloadRaw(rawBody, contentType);
    } catch {
      return NextResponse.json(
        { error: "Formato JSON o formulario inválido." },
        { status: 400 }
      );
    }

    const headers = Object.fromEntries(request.headers.entries());
    const result = await ingestBotNotification({ rawBody, headers, contentType });

    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      notificationId: result.notification.id,
      status: result.notification.status,
      amountBsCents: result.notification.amountBsCents,
      referenceFull: result.notification.referenceFull,
      autoMatchedOrderId: result.autoMatchedOrderId,
      ...(result.warning ? { warning: result.warning } : {}),
      ...(result.ignoredPackage ? { ignoredPackage: result.ignoredPackage } : {}),
    });
  } catch (err) {
    if (err instanceof PagoMovilAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/bot/ingest] Error:", err);
    return NextResponse.json(
      { error: "Error interno procesando notificación bancaria." },
      { status: 500 }
    );
  }
}
