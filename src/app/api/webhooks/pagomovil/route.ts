import { after, NextResponse } from "next/server";
import { processVerifiedWebhookEvent } from "@/lib/server/fulfillment";
import {
  PagoMovilAuthError,
  PagoMovilBdvAdapter,
} from "@/lib/server/payments/pagomovil-bdv";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  try {
    const adapter = new PagoMovilBdvAdapter();
    const event = await adapter.verifyWebhook({ rawBody, headers });

    after(async () => {
      try {
        await processVerifiedWebhookEvent(event, {
          skipRemoteDoubleCheck: false,
        });
      } catch (err) {
        console.error("[webhook/pagomovil] async processing error:", err);
      }
    });

    return NextResponse.json({
      received: true,
      eventId: event.eventId,
      status: event.status,
    });
  } catch (err) {
    const status = err instanceof PagoMovilAuthError ? err.status : 401;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid webhook signature" },
      { status }
    );
  }
}
