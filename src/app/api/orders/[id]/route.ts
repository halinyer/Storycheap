import { NextResponse, type NextRequest } from "next/server";
import { getServerSessionUser } from "@/lib/server/auth";
import {
  isBinancePayConfigured,
  isZenoBankConfigured,
} from "@/lib/server/env";
import {
  autoReconcileBinancePayForOrder,
  reconcileGatewaySession,
  syncCentralOneOrderProgress,
} from "@/lib/server/fulfillment";
import { hasOrderAccessCookie } from "@/lib/server/order-access";
import { getPaymentGateway } from "@/lib/server/payments";
import {
  getOrderById,
  getUserCreditBalanceCents,
  getZenoPaymentProofForOrder,
  listPendingSupplierOrdersForOrder,
} from "@/lib/server/repository";
import { ORDER_STATUS_META } from "@/lib/server/state-machine";

const lastPollReconcileAt = new Map<string, number>();
const lastSupplierPollAt = new Map<string, number>();

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
  const isEligibleZenoState =
    order.paymentGateway === "zenobank" &&
    (order.status === "PENDING_PAYMENT" ||
      order.status === "CREATED" ||
      (order.status === "EXPIRED" &&
        order.paidCents < order.amountDueCents &&
        Date.now() - Date.parse(order.createdAt) < 24 * 60 * 60_000));

  if (isEligibleZenoState) {
    const now = Date.now();
    const prev = lastPollReconcileAt.get(order.id) ?? 0;
    if (now - prev >= 4_000) {
      lastPollReconcileAt.set(order.id, now);
      let reconciled = false;

      if (order.gatewayCheckoutId && isZenoBankConfigured()) {
        try {
          const gw = getPaymentGateway("zenobank");
          const liveSession = await gw.getCheckout(order.gatewayCheckoutId);
          const rec = await reconcileGatewaySession({
            order,
            session: liveSession,
            source: "order_poll_reconcile",
          });
          if (rec.reconciled) {
            reconciled = true;
            order = (await getOrderById(id)) ?? order;
          }
        } catch {
          // Non-blocking: fall through to direct Binance Pay check if ZenoBank polling temporarily fails
        }
      }

      if (!reconciled && isBinancePayConfigured()) {
        try {
          const autoRes = await autoReconcileBinancePayForOrder({
            orderId: order.id,
            actorUser: sessionUser,
            source: "auto_poll_reconcile",
            minAgeMs: order.status === "EXPIRED" ? 0 : 8_000,
          });
          if (autoRes.matched) {
            order = autoRes.order;
          }
        } catch {
          // Non-blocking
        }
      }
    }
  }

  // Opportunistic live reconciliation for async Central One orders so codes are never left "al aire"
  if (order.status === "FULFILLING" || order.status === "PARTIAL") {
    const now = Date.now();
    const prev = lastSupplierPollAt.get(order.id) ?? 0;
    if (now - prev >= 1_500) {
      lastSupplierPollAt.set(order.id, now);
      try {
        const pendingSuppliers = await listPendingSupplierOrdersForOrder(
          order.id,
          ["centralone", "fazercards"]
        );
        let syncedAny = false;
        for (const so of pendingSuppliers) {
          if (!so.externalOrderId) continue;
          const res = await syncCentralOneOrderProgress(so.externalOrderId);
          if (res.ok) syncedAny = true;
        }
        if (syncedAny) {
          order = (await getOrderById(id)) ?? order;
        }
      } catch {
        // Non-blocking if supplier API is temporarily unreachable
      }
    }
  }

  const [userCreditBalanceCents, zenoProof] = await Promise.all([
    sessionUser
      ? getUserCreditBalanceCents(sessionUser.id).catch(() => 0)
      : Promise.resolve(0),
    order.paymentGateway === "zenobank"
      ? getZenoPaymentProofForOrder(order.id).catch(() => null)
      : Promise.resolve(null),
  ]);

  const zenoTransactions = (zenoProof?.transactions ?? []).map((tx) => ({
    uid: tx.uid,
    transactionId: tx.transactionId,
    networkId: tx.networkId,
    tokenId: tx.tokenId,
    tokenAmount: tx.tokenAmount,
    from: tx.from,
    fromLabel: tx.fromLabel,
    createdAt: tx.createdAt,
  }));

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
      userCreditBalanceCents,
      zenoTransactions,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
