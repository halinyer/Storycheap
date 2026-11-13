import { connection, NextResponse, type NextRequest } from "next/server";
import { getCronSecret, isStorePreviewMode } from "@/lib/server/env";
import { processVerifiedWebhookEvent } from "@/lib/server/fulfillment";
import { getPaymentGateway } from "@/lib/server/payments";
import {
  listOrdersAdmin,
  releaseExpiredReservations,
} from "@/lib/server/repository";

export async function GET(request: NextRequest) {
  await connection();
  const secret = getCronSecret();
  if (secret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "CRON_SECRET is required in production." },
      { status: 500 }
    );
  }

  if (isStorePreviewMode()) {
    return NextResponse.json({ ok: true, skipped: "store_preview_mode" });
  }

  const { releasedCodes, expiredOrders } = await releaseExpiredReservations();

  // Reconcile pending orders older than 2 minutes against authoritative gateway API
  const pendingOrders = await listOrdersAdmin({ status: "PENDING_PAYMENT" });
  const twoMinAgo = Date.now() - 2 * 60_000;
  let reconciledCount = 0;

  for (const order of pendingOrders) {
    if (!order.gatewayCheckoutId) continue;
    if (Date.parse(order.createdAt) > twoMinAgo) continue;

    try {
      const gw = getPaymentGateway(order.paymentGateway);
      const session = await gw.getCheckout(order.gatewayCheckoutId);
      if (
        session.status === "COMPLETED" ||
        session.status === "EXPIRED" ||
        session.status === "CANCELLED"
      ) {
        const eventType =
          session.status === "COMPLETED"
            ? "checkout.completed"
            : "checkout.expired";
        await processVerifiedWebhookEvent(
          {
            gateway: order.paymentGateway,
            eventId: `reconcile:${order.gatewayCheckoutId}:${session.status}`,
            eventType,
            orderId: order.id,
            checkoutId: order.gatewayCheckoutId,
            priceCents: session.priceCents,
            paidCents: session.paidCents,
            status: session.status,
            rawPayload: { source: "cron_reconcile", session },
          },
          { skipRemoteDoubleCheck: true }
        );
        reconciledCount += 1;
      }
    } catch {
      // Skip individual gateway query failure; next cron run will retry
    }
  }

  return NextResponse.json({
    ok: true,
    releasedCodes,
    expiredOrders,
    reconciledCount,
  });
}
