import { NextResponse, type NextRequest } from "next/server";
import { getServerSessionUser } from "@/lib/server/auth";
import { isZenoBankConfigured } from "@/lib/server/env";
import { processVerifiedWebhookEvent } from "@/lib/server/fulfillment";
import { hasOrderAccessCookie } from "@/lib/server/order-access";
import { getPaymentGateway } from "@/lib/server/payments";
import { getOrderById } from "@/lib/server/repository";
import { ORDER_STATUS_META } from "@/lib/server/state-machine";

const lastPollReconcileAt = new Map<string, number>();

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  let order = await getOrderById(id);
  if (!order) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  const sessionUser = await getServerSessionUser();
  const isOwner = Boolean(sessionUser && order.userId === sessionUser.id);
  const isAdmin = Boolean(sessionUser?.role === "admin");
  const hasCookieCap = await hasOrderAccessCookie(order.id);

  if (!isOwner && !isAdmin && !hasCookieCap) {
    return NextResponse.json(
      { error: "No autorizado para consultar esta orden." },
      { status: 403 }
    );
  }

  // Opportunistic live reconciliation when returning from ZenoBank (works locally & as webhook fallback)
  const shouldPollZeno =
    order.paymentGateway === "zenobank" &&
    Boolean(order.gatewayCheckoutId) &&
    isZenoBankConfigured() &&
    (order.status === "PENDING_PAYMENT" ||
      (order.status === "EXPIRED" &&
        order.paidCents === 0 &&
        Date.now() - Date.parse(order.createdAt) < 24 * 60 * 60_000));

  if (shouldPollZeno && order.gatewayCheckoutId) {
    const now = Date.now();
    const prev = lastPollReconcileAt.get(order.id) ?? 0;
    if (now - prev >= 4_000) {
      lastPollReconcileAt.set(order.id, now);
      try {
        const gw = getPaymentGateway("zenobank");
        const liveSession = await gw.getCheckout(order.gatewayCheckoutId);
        if (
          liveSession.status === "COMPLETED" ||
          liveSession.status === "PARTIALLY_PAID" ||
          liveSession.status === "EXPIRED" ||
          liveSession.status === "CANCELLED"
        ) {
          const eventType =
            liveSession.status === "COMPLETED"
              ? "checkout.completed"
              : liveSession.status === "PARTIALLY_PAID"
                ? "checkout.partially_paid"
                : "checkout.expired";
          const expiredTag =
            liveSession.expiresAt && Date.now() >= Date.parse(liveSession.expiresAt)
              ? "exp"
              : "open";
          await processVerifiedWebhookEvent(
            {
              gateway: "zenobank",
              eventId: `poll_reconcile:${order.gatewayCheckoutId}:${liveSession.status}:${liveSession.paidCents}:${expiredTag}`,
              eventType,
              orderId: order.id,
              checkoutId: order.gatewayCheckoutId,
              priceCents: liveSession.priceCents,
              paidCents: liveSession.paidCents,
              status: liveSession.status,
              expiresAt: liveSession.expiresAt,
              rawPayload: { source: "order_poll_reconcile", liveSession },
            },
            { skipRemoteDoubleCheck: true }
          );
          order = (await getOrderById(id)) ?? order;
        }
      } catch {
        // Non-blocking: return latest known order state if ZenoBank polling temporarily fails
      }
    }
  }

  const sanitizedOrder = isAdmin
    ? order
    : {
        ...order,
        items: order.items.map(({ unitCostCents: _omit, ...rest }) => {
          void _omit;
          return rest;
        }),
      };

  return NextResponse.json(
    {
      order: sanitizedOrder,
      statusMeta: ORDER_STATUS_META[order.status],
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
