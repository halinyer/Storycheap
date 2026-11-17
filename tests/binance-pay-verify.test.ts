import crypto from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { initiateCheckout } from "@/lib/server/checkout-service";
import {
  applyVerifiedBinancePayTxToOrder,
  BinancePayVerifyError,
  listRecentBinancePayCandidatesForOrder,
} from "@/lib/server/fulfillment";
import {
  buildBinanceSignedQuery,
  parseUsdStablecoinCents,
  setSandboxBinancePayTransactionsForTests,
} from "@/lib/server/payments/binance-pay";
import {
  getOrderById,
  getUserCreditBalanceCents,
  getZenoPaymentProofForOrder,
} from "@/lib/server/repository";
import { resetSandboxStateForTests } from "@/lib/server/sandbox-db";
import type { SessionUser } from "@/types";

const PSN_10_VARIANT_ID = "20000000-0000-4000-8000-000000000101";

const CUSTOMER_SESSION: SessionUser = {
  id: "00000000-0000-4000-8000-00000000c001",
  email: "carlos@storycheap.com",
  role: "customer",
  aal: "aal1",
  isSandbox: true,
};

const ADMIN_SESSION: SessionUser = {
  id: "00000000-0000-4000-8000-00000000a001",
  email: "admin@storycheap.com",
  role: "admin",
  aal: "aal2",
  isSandbox: true,
};

describe("Binance Pay Direct Verification & Anti-Replay Protection", () => {
  beforeEach(() => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;
    resetSandboxStateForTests();
    setSandboxBinancePayTransactionsForTests([]);
  });

  it("signs Binance queries with HMAC-SHA256 and parses only positive USD stablecoins", () => {
    const secret = "test_secret_123";
    const qs = buildBinanceSignedQuery({ timestamp: 1700000000000, limit: 10 }, secret);
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update("timestamp=1700000000000&limit=10")
      .digest("hex");
    expect(qs).toBe(`timestamp=1700000000000&limit=10&signature=${expectedSig}`);

    expect(parseUsdStablecoinCents("0.8", "USDT")).toBe(80);
    expect(parseUsdStablecoinCents("12.34", "USDC")).toBe(1234);
    expect(parseUsdStablecoinCents("-0.3", "USDT")).toBeNull();
    expect(parseUsdStablecoinCents("0.01", "BTC")).toBeNull();
  });

  it("verifies an overpaid Binance Pay TX, fulfills order, credits surplus, and prevents TX replay", async () => {
    const startBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    const nowMs = Date.now();
    setSandboxBinancePayTransactionsForTests([
      {
        uid: 167545790,
        counterpartyId: 222086583,
        orderId: "466225237208195072",
        orderType: "C2C",
        transactionId: "P_A25QH5J5SGD71114",
        transactionTime: nowMs,
        amount: "12.00",
        currency: "USDT",
        payerInfo: { name: "Tonydeluxe" },
        receiverInfo: { binanceId: 167545790 },
      },
    ]);

    const res = await applyVerifiedBinancePayTxToOrder({
      orderId: checkout.order.id,
      transactionId: "p_a25qh5j5sgd71114",
      actorUser: CUSTOMER_SESSION,
      source: "customer_tx_verify",
    });

    expect(res.mode).toBe("fulfilled");
    expect(res.surplusCents).toBe(150); // $12.00 - $10.50 = $1.50
    expect(res.order.status).toBe("DELIVERED");

    const endBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
    expect(endBalance - startBalance).toBe(150);

    const proof = await getZenoPaymentProofForOrder(checkout.order.id);
    expect(proof?.transactions[0]?.transactionId).toBe("P_A25QH5J5SGD71114");

    // Replaying the same Binance TX on a second order must fail!
    const checkout2 = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    await expect(
      applyVerifiedBinancePayTxToOrder({
        orderId: checkout2.order.id,
        transactionId: "P_A25QH5J5SGD71114",
        actorUser: CUSTOMER_SESSION,
        source: "customer_tx_verify",
      })
    ).rejects.toThrow(BinancePayVerifyError);

    const adminList = await listRecentBinancePayCandidatesForOrder(checkout2.order.id);
    expect(adminList.deposits[0]?.alreadyUsed).toBe(true);
  });

  it("accumulates partial Binance Pay transfers and unlocks on completion while rejecting stale TXs", async () => {
    const startBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    const nowMs = Date.now();
    setSandboxBinancePayTransactionsForTests([
      {
        transactionId: "P_OLD_STALE_TX",
        transactionTime: nowMs - 60 * 60_000, // 1 hour BEFORE order creation
        amount: "20.00",
        currency: "USDT",
      },
      {
        transactionId: "P_PARTIAL_01",
        transactionTime: nowMs + 1000,
        amount: "6.00",
        currency: "USDT",
      },
      {
        transactionId: "P_PARTIAL_02",
        transactionTime: nowMs + 2000,
        amount: "5.00",
        currency: "USDC",
      },
    ]);

    // Stale TX before order creation must be rejected
    await expect(
      applyVerifiedBinancePayTxToOrder({
        orderId: checkout.order.id,
        transactionId: "P_OLD_STALE_TX",
        actorUser: CUSTOMER_SESSION,
        source: "customer_tx_verify",
      })
    ).rejects.toThrow(BinancePayVerifyError);

    // First partial payment ($6.00 of $10.50 -> $4.50 missing)
    const p1 = await applyVerifiedBinancePayTxToOrder({
      orderId: checkout.order.id,
      transactionId: "P_PARTIAL_01",
      actorUser: ADMIN_SESSION,
      source: "admin_tx_verify",
    });
    expect(p1.mode).toBe("partial_pending");
    expect(p1.missingCents).toBe(450);

    const midOrder = await getOrderById(checkout.order.id);
    expect(midOrder?.status).toBe("PENDING_PAYMENT");
    expect(midOrder?.paidCents).toBe(600);

    // Second transfer ($5.00 USDC) brings total to $11.00 (>= $10.50) -> fulfills + credits $0.50
    const p2 = await applyVerifiedBinancePayTxToOrder({
      orderId: checkout.order.id,
      transactionId: "P_PARTIAL_02",
      actorUser: CUSTOMER_SESSION,
      source: "customer_tx_verify",
    });
    expect(p2.mode).toBe("fulfilled");
    expect(p2.surplusCents).toBe(50);
    expect(p2.order.status).toBe("DELIVERED");

    const endBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
    expect(endBalance - startBalance).toBe(50);
  });
});
