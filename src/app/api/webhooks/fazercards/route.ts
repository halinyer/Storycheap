import { after, NextResponse, type NextRequest } from "next/server";
import { syncCentralOneOrderProgress } from "@/lib/server/fulfillment";
import {
  recordWebhookEventOnce,
  updateWebhookEventStatus,
} from "@/lib/server/repository";
import {
  FAZERCARDS_PRODUCT_PREFIX,
  verifyFazerCardsWebhookSignature,
} from "@/lib/server/suppliers/fazercards";

function runAsyncTask(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
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

  const signatureHeader = request.headers.get("x-webhook-signature");
  const isValid = verifyFazerCardsWebhookSignature(rawBody, signatureHeader);

  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid FazerCards webhook signature" },
      { status: 401 }
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const headerEventId = request.headers.get("x-webhook-event-id") ?? "";
  const headerEventType = request.headers.get("x-webhook-event") ?? "";

  const eventId = String(payload.event_id ?? headerEventId ?? payload.id ?? "").trim();
  const eventType = String(payload.event ?? headerEventType ?? "unknown").trim();

  const dataObj =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;

  const rawOrderId = String(
    dataObj.order_id ?? dataObj.id ?? payload.order_id ?? ""
  ).trim();

  if (!eventId || !rawOrderId) {
    return NextResponse.json(
      { error: "Missing event_id or order_id in FazerCards webhook" },
      { status: 400 }
    );
  }

  const externalOrderId = rawOrderId.startsWith(FAZERCARDS_PRODUCT_PREFIX)
    ? rawOrderId
    : `${FAZERCARDS_PRODUCT_PREFIX}${rawOrderId}`;

  const { isDuplicate, recordId } = await recordWebhookEventOnce({
    gateway: "centralone",
    eventId: `fazer:${eventId}`,
    eventType: `fazercards.${eventType}`,
    orderId: null,
    gatewayCheckoutId: externalOrderId,
    signatureValid: true,
    payload,
  });

  if (isDuplicate) {
    return NextResponse.json(
      { received: true, duplicate: true, eventId },
      { status: 200 }
    );
  }

  runAsyncTask(async () => {
    try {
      await syncCentralOneOrderProgress(externalOrderId);
      await updateWebhookEventStatus(recordId, "processed");
    } catch (err) {
      await updateWebhookEventStatus(
        recordId,
        "failed",
        err instanceof Error ? err.message : "FazerCards sync error"
      );
    }
  });

  return NextResponse.json(
    { received: true, eventId, eventType, externalOrderId },
    { status: 200 }
  );
}
