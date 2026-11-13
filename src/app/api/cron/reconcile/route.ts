import { connection, NextResponse, type NextRequest } from "next/server";
import { getCronSecret, isStorePreviewMode } from "@/lib/server/env";
import {
  processVerifiedWebhookEvent,
  syncCentralOneOrderProgress,
} from "@/lib/server/fulfillment";
import { getPaymentGateway } from "@/lib/server/payments";
import {
  listOrdersAdmin,
  listPendingSupplierOrders,
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

  // 1) Reconcile pending orders (and recent expired unpaid orders) BEFORE expiring DB reservations
  const [pendingOrders, expiredRecent] = await Promise.all([
    listOrdersAdmin({ status: "PENDING_PAYMENT" }),
    listOrdersAdmin({ status: "EXPIRED" }),
  ]);
  const twoMinAgo = Date.now() - 2 * 60_000;
  const dayAgo = Date.now() - 24 * 60 * 60_000;
  const ordersToReconcile = [
    ...pendingOrders.filter((o) => Date.parse(o.createdAt) <= twoMinAgo),
    ...expiredRecent.filter(
      (o) => o.paidCents === 0 && Date.parse(o.createdAt) >= dayAgo
    ),
  ];
  let reconciledCount = 0;

  for (const order of ordersToReconcile) {
    if (!order.gatewayCheckoutId) continue;

    try {
      const gw = getPaymentGateway(order.paymentGateway);
      const session = await gw.getCheckout(order.gatewayCheckoutId);
      if (
        session.status === "COMPLETED" ||
        session.status === "PARTIALLY_PAID" ||
        session.status === "EXPIRED" ||
        session.status === "CANCELLED"
      ) {
        const eventType =
          session.status === "COMPLETED"
            ? "checkout.completed"
            : session.status === "PARTIALLY_PAID"
              ? "checkout.partially_paid"
              : "checkout.expired";
        const expiredTag =
          session.expiresAt && Date.now() >= Date.parse(session.expiresAt)
            ? "exp"
            : "open";
        await processVerifiedWebhookEvent(
          {
            gateway: order.paymentGateway,
            eventId: `reconcile:${order.gatewayCheckoutId}:${session.status}:${session.paidCents}:${expiredTag}`,
            eventType,
            orderId: order.id,
            checkoutId: order.gatewayCheckoutId,
            priceCents: session.priceCents,
            paidCents: session.paidCents,
            status: session.status,
            expiresAt: session.expiresAt,
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

  // 2) Release any remaining expired reservations after reconciliation
  const { releasedCodes, expiredOrders } = await releaseExpiredReservations();

  // Reconcile pending asynchronous Central One supplier orders
  let centralOneSyncedCount = 0;
  const pendingCentralOne = await listPendingSupplierOrders("centralone");
  for (const so of pendingCentralOne) {
    if (!so.externalOrderId) continue;
    try {
      const res = await syncCentralOneOrderProgress(so.externalOrderId);
      if (res.ok) centralOneSyncedCount += 1;
    } catch {
      // Skip individual supplier query failure; next cron run will retry
    }
  }

  return NextResponse.json({
    ok: true,
    releasedCodes,
    expiredOrders,
    reconciledCount,
    centralOneSyncedCount,
  });
}
