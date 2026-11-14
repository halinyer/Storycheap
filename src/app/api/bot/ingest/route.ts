import { NextResponse } from "next/server";
import {
  ingestBotNotification,
  PagoMovilAuthError,
} from "@/lib/server/payments/pagomovil-bot";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    if (!rawBody.trim()) {
      return NextResponse.json(
        { error: "El cuerpo JSON de la notificación está vacío." },
        { status: 400 }
      );
    }

    // Validate JSON syntax before HMAC processing
    try {
      JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Formato JSON inválido." },
        { status: 400 }
      );
    }

    const headers = Object.fromEntries(request.headers.entries());
    const result = await ingestBotNotification({ rawBody, headers });

    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      notificationId: result.notification.id,
      status: result.notification.status,
      amountBsCents: result.notification.amountBsCents,
      referenceFull: result.notification.referenceFull,
      autoMatchedOrderId: result.autoMatchedOrderId,
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
