import { beforeEach, describe, expect, it } from "vitest";
import { SANDBOX_DEFAULT_ADMIN_ID } from "@/lib/server/auth";
import { initiateCheckout } from "@/lib/server/checkout-service";
import {
  cancelOrderByCustomer,
  CancelOrderError,
  processVerifiedWebhookEvent,
} from "@/lib/server/fulfillment";
import {
  saveOrderPagoMovilReport,
  saveReceiverBankAccount,
} from "@/lib/server/pagomovil-store";
import { setSandboxZenoCheckout } from "@/lib/server/payments/zenobank";
import {
  getOrderById,
  getUserCreditBalanceCents,
  listCatalog,
  setBsRateCents,
  updateOrderPartialPaymentCents,
  updateProviderConfig,
} from "@/lib/server/repository";
import {
  getSandboxState,
  resetSandboxStateForTests,
} from "@/lib/server/sandbox-db";
import type { SessionUser } from "@/types";

const PSN_10_VARIANT_ID = "20000000-0000-4000-8000-000000000101";

const CUSTOMER_SESSION: SessionUser = {
  id: "00000000-0000-4000-8000-00000000c001",
  email: "carlos@storycheap.com",
  role: "customer",
  aal: "aal1",
  isSandbox: true,
};

const OTHER_USER_SESSION: SessionUser = {
  id: "00000000-0000-4000-8000-00000000c999",
  email: "otro@storycheap.com",
  role: "customer",
  aal: "aal1",
  isSandbox: true,
};

const ADMIN_SESSION: SessionUser = {
  id: SANDBOX_DEFAULT_ADMIN_ID,
  email: "admin@storycheap.com",
  role: "admin",
  aal: "aal2",
  isSandbox: true,
};

async function setupPagoMovil() {
  await updateProviderConfig("pagomovil", { enabled: true }, ADMIN_SESSION.id);
  await setBsRateCents(5000, ADMIN_SESSION.id);
  await saveReceiverBankAccount(
    {
      bankCode: "0102",
      bankName: "Banco de Venezuela",
      accountType: "juridical",
      phone: "04121234567",
      dni: "J-500123456",
      holderName: "StoryCheap C.A.",
      active: true,
    },
    ADMIN_SESSION.id
  );
}

describe("Customer Order Cancellation (Atomic Release + Credit Refund)", () => {
  beforeEach(() => {
    resetSandboxStateForTests();
  });

  it("cancels PENDING_PAYMENT order, releases reserved PINs, refunds credit, and is idempotent", async () => {
    const startBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
    expect(startBalance).toBe(350);

    const beforeCatalog = await listCatalog(true);
    const psn10Before = beforeCatalog
      .flatMap((p) => p.variants)
      .find((v) => v.id === PSN_10_VARIANT_ID)!;
    const stockBefore = psn10Before.availableStock;

    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: true,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    expect(checkout.order.status).toBe("PENDING_PAYMENT");
    expect(checkout.order.creditAppliedCents).toBe(350);
    expect(await getUserCreditBalanceCents(CUSTOMER_SESSION.id)).toBe(0);

    const midCatalog = await listCatalog(true);
    const stockMid = midCatalog
      .flatMap((p) => p.variants)
      .find((v) => v.id === PSN_10_VARIANT_ID)!.availableStock;
    expect(stockMid).toBe(stockBefore - 1);

    const cancel1 = await cancelOrderByCustomer({
      orderId: checkout.order.id,
      actorUser: CUSTOMER_SESSION,
    });

    expect(cancel1.outcome).toBe("cancelled");
    expect(cancel1.order.status).toBe("CANCELLED");
    expect(cancel1.refundedCreditCents).toBe(350);
    expect(cancel1.releasedCodesCount).toBe(1);
    expect(await getUserCreditBalanceCents(CUSTOMER_SESSION.id)).toBe(350);

    const afterCatalog = await listCatalog(true);
    const stockAfter = afterCatalog
      .flatMap((p) => p.variants)
      .find((v) => v.id === PSN_10_VARIANT_ID)!.availableStock;
    expect(stockAfter).toBe(stockBefore);

    // Repeating cancel must be idempotent without double-refunding credit
    const cancel2 = await cancelOrderByCustomer({
      orderId: checkout.order.id,
      actorUser: CUSTOMER_SESSION,
    });
    expect(cancel2.outcome).toBe("already_cancelled");
    expect(cancel2.refundedCreditCents).toBe(0);
    expect(await getUserCreditBalanceCents(CUSTOMER_SESSION.id)).toBe(350);
  });

  it("enforces auth ownership and blocks cancellation on partial payments or delivered orders", async () => {
    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    await expect(
      cancelOrderByCustomer({
        orderId: checkout.order.id,
        actorUser: null,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    await expect(
      cancelOrderByCustomer({
        orderId: checkout.order.id,
        actorUser: OTHER_USER_SESSION,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    // Simulate underpayment partial state
    await updateOrderPartialPaymentCents(checkout.order.id, 300);
    await expect(
      cancelOrderByCustomer({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
      })
    ).rejects.toMatchObject({ code: "PARTIAL_PAYMENT_ACTIVE", status: 409 });

    // Reset paidCents, complete full payment webhook -> DELIVERED cannot be cancelled
    await updateOrderPartialPaymentCents(checkout.order.id, 0);
    const checkoutId = checkout.order.gatewayCheckoutId!;
    setSandboxZenoCheckout({
      id: checkoutId,
      orderId: checkout.order.id,
      priceCurrency: "USD",
      priceAmount: "10.50",
      paidAmount: "10.50",
      status: "COMPLETED",
      expiresAt: checkout.order.expiresAt,
      checkoutUrl: checkout.checkoutUrl,
      createdAt: checkout.order.createdAt,
      successRedirectUrl: null,
    });
    await processVerifiedWebhookEvent({
      gateway: "zenobank",
      eventId: "evt_delivered_cant_cancel",
      eventType: "checkout.completed",
      orderId: checkout.order.id,
      checkoutId,
      priceCents: 1050,
      paidCents: 1050,
      status: "COMPLETED",
      rawPayload: {},
    });

    const delivered = await getOrderById(checkout.order.id);
    expect(delivered?.status).toBe("DELIVERED");

    await expect(
      cancelOrderByCustomer({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
      })
    ).rejects.toBeInstanceOf(CancelOrderError);
  });

  it("guards Pago Movil orders with reported reference unless forceAfterReport=true, and blocks if matched", async () => {
    await setupPagoMovil();
    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: true,
      paymentGateway: "pagomovil",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    await saveOrderPagoMovilReport(checkout.order.id, {
      reportedReference: "123456",
      reportedSenderBank: "0102",
      reportedAt: new Date().toISOString(),
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    await expect(
      cancelOrderByCustomer({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        forceAfterReport: false,
      })
    ).rejects.toMatchObject({ code: "REPORTED_REFERENCE_PENDING", status: 409 });

    // Confirming with forceAfterReport succeeds and refunds credit
    const cancelled = await cancelOrderByCustomer({
      orderId: checkout.order.id,
      actorUser: CUSTOMER_SESSION,
      forceAfterReport: true,
    });
    expect(cancelled.order.status).toBe("CANCELLED");
    expect(cancelled.refundedCreditCents).toBe(350);
    expect(await getUserCreditBalanceCents(CUSTOMER_SESSION.id)).toBe(350);

    // Another order that already matched a bank notification cannot be cancelled
    const checkout2 = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "pagomovil",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });
    getSandboxState().pagoMovil.notifications.push({
      id: "notif-matched-1",
      deviceId: null,
      receiverAccountId: null,
      sourceType: "APP_PUSH",
      appPackage: "com.bancamiga.suite",
      rawContentHash: "hash-matched-888999",
      rawContentPreview: "PagoMovil recibido Ref 888999",
      amountBsCents: 52500,
      currency: "VES",
      referenceFull: "888999",
      referenceLast6: "888999",
      referenceLast4: "8999",
      senderPhone: "04120000000",
      senderDni: null,
      senderBankCode: "0102",
      parserUsed: "bancamiga",
      postedAt: new Date().toISOString(),
      status: "MATCHED",
      matchedOrderId: checkout2.order.id,
      matchedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    await expect(
      cancelOrderByCustomer({
        orderId: checkout2.order.id,
        actorUser: CUSTOMER_SESSION,
        forceAfterReport: true,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_ALREADY_MATCHED", status: 409 });
  });
});
