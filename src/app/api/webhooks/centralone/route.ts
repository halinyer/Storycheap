import { after, NextResponse, type NextRequest } from "next/server";
import { syncCentralOneOrderProgress } from "@/lib/server/fulfillment";
import {
  recordWebhookEventOnce,
  updateWebhookEventStatus,
} from "@/lib/server/repository";
import { verifyCentralOneWebhookSignature } from "@/lib/server/suppliers/centralone";

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

  const timestampHeader = request.headers.get("x-centralone-timestamp");
  const signatureHeader = request.headers.get("x-centralone-signature");

  const verification = verifyCentralOneWebhookSignature({
    rawBody,
    timestampHeader,
    signatureHeader,
  });

  if (!verification.valid) {
    return NextResponse.json(
      { error: verification.reason ?? "Invalid webhook signature" },
      { status: 401 }
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventId = String(payload.event_id ?? payload.id ?? "").trim();
  const eventType = String(payload.event ?? payload.type ?? "unknown").trim();
  const dataObj =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;
  const externalOrderId = String(
    dataObj.order_id ?? dataObj.id ?? payload.order_id ?? ""
  ).trim();
  const sequence =
    typeof payload.sequence === "number"
      ? payload.sequence
      : typeof dataObj.sequence === "number"
        ? dataObj.sequence
        : undefined;

  if (!eventId || !externalOrderId) {
    return NextResponse.json(
      { error: "Missing event_id or order_id in Central One webhook" },
      { status: 400 }
    );
  }

  const { isDuplicate, recordId } = await recordWebhookEventOnce({
    gateway: "centralone",
    eventId,
    eventType,
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
      await syncCentralOneOrderProgress(externalOrderId, sequence);
      await updateWebhookEventStatus(recordId, "processed");
    } catch (err) {
      await updateWebhookEventStatus(
        recordId,
        "failed",
        err instanceof Error ? err.message : "Central One sync error"
      );
    }
  });

  return NextResponse.json(
    { received: true, eventId, eventType, externalOrderId },
    { status: 200 }
  );
}
