import { beforeEach, describe, expect, it } from "vitest";
import { initiateCheckout } from "@/lib/server/checkout-service";
import {
  adminRecordManualZenoPayment,
  adminRefundOrderToCredit,
  reconcileGatewaySession,
} from "@/lib/server/fulfillment";
import { getOrderById, getUserCreditBalanceCents } from "@/lib/server/repository";
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

describe("ZenoBank Partial Payments, Underpayment Refund Cap & Manual Overpay Reconciliation", () => {
  beforeEach(() => {
    resetSandboxStateForTests();
  });

  it("reconciles OPEN ZenoBank session when paidCents increases while keeping code locked", async () => {
    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    expect(checkout.order.amountDueCents).toBe(1050);
    expect(checkout.order.paidCents).toBe(0);

    const res = await reconcileGatewaySession({
      order: checkout.order,
      session: {
        gateway: "zenobank",
        checkoutId: checkout.order.gatewayCheckoutId!,
        checkoutUrl: checkout.checkoutUrl,
        expiresAt: checkout.order.expiresAt,
        status: "OPEN",
        priceCents: 1050,
        paidCents: 500,
        isSandbox: true,
      },
      source: "test_poll_reconcile",
    });

    expect(res.reconciled).toBe(true);
    expect(res.outcome).toBe("partial_pending");

    const updated = await getOrderById(checkout.order.id);
    expect(updated?.status).toBe("PENDING_PAYMENT");
    expect(updated?.paidCents).toBe(500);
    expect(updated!.amountDueCents - updated!.paidCents).toBe(550);
  });

  it("caps adminRefundOrderToCredit strictly at actually funded cents on partially paid PENDING_PAYMENT orders", async () => {
    const startBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);

    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    await reconcileGatewaySession({
      order: checkout.order,
      session: {
        gateway: "zenobank",
        checkoutId: checkout.order.gatewayCheckoutId!,
        checkoutUrl: checkout.checkoutUrl,
        expiresAt: checkout.order.expiresAt,
        status: "OPEN",
        priceCents: 1050,
        paidCents: 500,
        isSandbox: true,
      },
      source: "test_partial_deposit",
    });

    await adminRefundOrderToCredit({
      orderId: checkout.order.id,
      adminUser: ADMIN_SESSION,
      reasonNote: "Cliente envió menos en Binance Pay y solicitó acreditación",
    });

    const refundedOrder = await getOrderById(checkout.order.id);
    expect(refundedOrder?.status).toBe("REFUNDED_CREDIT");

    // Must credit ONLY the 500 cents paid, NEVER the full 1050 subtotal!
    const endBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
    expect(endBalance - startBalance).toBe(500);
  });

  it("handles admin manual ZenoBank recording for partial payments and overpayments", async () => {
    const startBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);

    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    // Step 1: operator logs an underpayment manually -> stays PENDING_PAYMENT with exact shortfall
    const partialRes = await adminRecordManualZenoPayment({
      orderId: checkout.order.id,
      receivedCents: 600,
      txReference: "P_PARTIAL_001",
      adminUser: ADMIN_SESSION,
    });

    expect(partialRes.mode).toBe("partial_pending");
    expect(partialRes.missingCents).toBe(450);
    expect(partialRes.nextStatus).toBe("PENDING_PAYMENT");

    // Step 2: customer completes remaining + sends extra total ($12.50 = 1250 cents vs 1050 expected)
    const fulfillRes = await adminRecordManualZenoPayment({
      orderId: checkout.order.id,
      receivedCents: 1250,
      txReference: "P_OVERPAY_002",
      adminUser: ADMIN_SESSION,
    });

    expect(fulfillRes.mode).toBe("fulfilled");
    expect(fulfillRes.surplusCents).toBe(200);
    expect(fulfillRes.nextStatus).toBe("DELIVERED");

    const endBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
    expect(endBalance - startBalance).toBe(200);
  });

  it("recovers an already-EXPIRED ZenoBank order when operator confirms manual overpay", async () => {
    const startBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);

    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    await reconcileGatewaySession({
      order: checkout.order,
      session: {
        gateway: "zenobank",
        checkoutId: checkout.order.gatewayCheckoutId!,
        checkoutUrl: checkout.checkoutUrl,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        status: "EXPIRED",
        priceCents: 1050,
        paidCents: 0,
        isSandbox: true,
      },
      source: "test_expire",
    });

    const expiredOrder = await getOrderById(checkout.order.id);
    expect(expiredOrder?.status).toBe("EXPIRED");

    const manualRes = await adminRecordManualZenoPayment({
      orderId: checkout.order.id,
      receivedCents: 1150,
      txReference: "P_LATE_OVERPAY_003",
      adminUser: ADMIN_SESSION,
    });

    expect(manualRes.mode).toBe("fulfilled");
    expect(manualRes.surplusCents).toBe(100);
    expect(manualRes.nextStatus).toBe("DELIVERED");

    const endBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
    expect(endBalance - startBalance).toBe(100);
  });
});
