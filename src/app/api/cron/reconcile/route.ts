import { connection, NextResponse, type NextRequest } from "next/server";
import { getCronSecret, isStorePreviewMode } from "@/lib/server/env";
import {
  reconcileGatewaySession,
  syncCentralOneOrderProgress,
} from "@/lib/server/fulfillment";
import { getPaymentGateway } from "@/lib/server/payments";
import {
  listOrdersAdmin,
  listPendingSupplierOrders,
  releaseExpiredReservations,
} from "@/lib/server/repository";
import { syncBsExchangeRateIfNeeded } from "@/lib/server/exchange-rates";
import { syncSupplierCatalogCosts } from "@/lib/server/supplier-sync";

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
      const rec = await reconcileGatewaySession({
        order,
        session,
        source: "cron_reconcile",
      });
      if (rec.reconciled) {
        reconciledCount += 1;
      }
    } catch {
      // Skip individual gateway query failure; next cron run will retry
    }
  }

  // 2) Release any remaining expired reservations after reconciliation
  const { releasedCodes, expiredOrders } = await releaseExpiredReservations();

  // Reconcile pending asynchronous supplier orders (Central One + FazerCards)
  let centralOneSyncedCount = 0;
  const pendingCentralOne = await listPendingSupplierOrders(["centralone", "fazercards"]);
  for (const so of pendingCentralOne) {
    if (!so.externalOrderId) continue;
    try {
      const res = await syncCentralOneOrderProgress(so.externalOrderId);
      if (res.ok) centralOneSyncedCount += 1;
    } catch {
      // Skip individual supplier query failure; next cron run will retry
    }
  }

  // 3) Sync live distributor wholesale prices and enforce anti-loss floor protection
  let priceSync: {
    checkedCount: number;
    updatedCostCount: number;
    adjustedSaleCount: number;
    atRiskCount: number;
    lastError: string | null;
  } | null = null;
  try {
    const syncRes = await syncSupplierCatalogCosts({
      force: true,
      updatedBy: "cron:reconcile",
    });
    priceSync = {
      checkedCount: syncRes.checkedCount,
      updatedCostCount: syncRes.updatedCostCount,
      adjustedSaleCount: syncRes.adjustedSaleCount,
      atRiskCount: syncRes.atRiskCount,
      lastError: syncRes.lastError,
    };
  } catch (err) {
    priceSync = {
      checkedCount: 0,
      updatedCostCount: 0,
      adjustedSaleCount: 0,
      atRiskCount: 0,
      lastError: err instanceof Error ? err.message : "price_sync_failed",
    };
  }

  // 4) Auto-sync Bs/USD exchange rate when auto-sync policy is enabled
  let bsRateSync: {
    synced: boolean;
    bsRateCents: number | null;
  } | null = null;
  try {
    const rateRes = await syncBsExchangeRateIfNeeded({
      updatedBy: "cron:reconcile",
    });
    bsRateSync = {
      synced: rateRes.synced,
      bsRateCents: rateRes.bsRateCents,
    };
  } catch {
    bsRateSync = null;
  }

  return NextResponse.json({
    ok: true,
    releasedCodes,
    expiredOrders,
    reconciledCount,
    centralOneSyncedCount,
    priceSync,
    bsRateSync,
  });
}
