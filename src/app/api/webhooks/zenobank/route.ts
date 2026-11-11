import { after, NextResponse, type NextRequest } from "next/server";
import { processVerifiedWebhookEvent } from "@/lib/server/fulfillment";
import {
  MissingWebhookHeadersError,
  WebhookVerificationError,
  ZenoBankAdapter,
} from "@/lib/server/payments/zenobank";

const zenoBank = new ZenoBankAdapter();

function runAsyncFulfillment(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    // Fallback outside Next.js request scope (e.g. direct Vitest handler invocation)
    void task();
  }
}

export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let event;
  try {
    event = await zenoBank.verifyWebhook({ rawBody, headers });
  } catch (err) {
    if (
      err instanceof MissingWebhookHeadersError ||
      err instanceof WebhookVerificationError
    ) {
      return NextResponse.json(
        { error: "Invalid webhook signature or headers" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: "Webhook verification failed" },
      { status: 401 }
    );
  }

  // Acknowledge fast and execute idempotent fulfillment in Next.js `after()`
  runAsyncFulfillment(async () => {
    await processVerifiedWebhookEvent(event);
  });

  return NextResponse.json(
    { received: true, eventId: event.eventId, type: event.eventType },
    { status: 200 }
  );
}
