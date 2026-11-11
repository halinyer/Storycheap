import { beforeEach, describe, expect, it } from "vitest";
import { initiateCheckout } from "@/lib/server/checkout-service";
import { encryptCode, extractLast4, sha256CodeHash } from "@/lib/server/crypto";
import { processVerifiedWebhookEvent } from "@/lib/server/fulfillment";
import { setSandboxZenoCheckout } from "@/lib/server/payments/zenobank";
import {
  getOrderById,
  getUserCreditBalanceCents,
  listCatalog,
  revealOrderCodes,
} from "@/lib/server/repository";
import {
  resetSandboxStateForTests,
  type SandboxInventoryRow,
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

function makeSingleInventoryRow(codePlaintext: string): SandboxInventoryRow {
  return {
    id: "30000000-0000-4000-8000-000000009999",
    variantId: PSN_10_VARIANT_ID,
    codeCiphertext: encryptCode(codePlaintext),
    pinCiphertext: null,
    codeHash: sha256CodeHash(codePlaintext),
    codeLast4: extractLast4(codePlaintext),
    batchId: "SINGLE-CONCURRENCY-TEST",
    expiresAt: null,
    status: "AVAILABLE",
    reservedOrderId: null,
    reservedUntil: null,
    deliveredOrderId: null,
    createdAt: new Date().toISOString(),
    deliveredAt: null,
  };
}

describe("Checkout -> Webhook -> Fulfillment -> Vault Integration & Concurrency", () => {
  beforeEach(() => {
    resetSandboxStateForTests();
  });

  it("fulfills order end-to-end, rejects duplicate webhooks, and blocks IDOR reveal", async () => {
    const startBalance = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
    expect(startBalance).toBe(350);

    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: true,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    // $10.50 (1050 cents) - $3.50 credit (350 cents) = $7.00 (700 cents) due
    expect(checkout.order.subtotalCents).toBe(1050);
    expect(checkout.order.creditAppliedCents).toBe(350);
    expect(checkout.order.amountDueCents).toBe(700);
    expect(checkout.order.status).toBe("PENDING_PAYMENT");
    expect(await getUserCreditBalanceCents(CUSTOMER_SESSION.id)).toBe(0);

    const checkoutId = checkout.order.gatewayCheckoutId!;
    setSandboxZenoCheckout({
      id: checkoutId,
      orderId: checkout.order.id,
      priceCurrency: "USD",
      priceAmount: "7.00",
      paidAmount: "7.00",
      status: "COMPLETED",
      expiresAt: checkout.order.expiresAt,
      checkoutUrl: checkout.checkoutUrl,
      createdAt: checkout.order.createdAt,
      successRedirectUrl: null,
    });

    const res1 = await processVerifiedWebhookEvent({
      gateway: "zenobank",
      eventId: "evt_unique_1",
      eventType: "checkout.completed",
      orderId: checkout.order.id,
      checkoutId,
      priceCents: 700,
      paidCents: 700,
      status: "COMPLETED",
      rawPayload: {},
    });
    expect(res1.outcome).toBe("delivered_or_fulfilling");

    // Duplicate replay must be idempotent no-op
    const resDup = await processVerifiedWebhookEvent({
      gateway: "zenobank",
      eventId: "evt_unique_1",
      eventType: "checkout.completed",
      orderId: checkout.order.id,
      checkoutId,
      priceCents: 700,
      paidCents: 700,
      status: "COMPLETED",
      rawPayload: {},
    });
    expect(resDup.outcome).toBe("duplicate");

    const deliveredOrder = await getOrderById(checkout.order.id);
    expect(deliveredOrder?.status).toBe("DELIVERED");
    expect(deliveredOrder?.fulfillments.length).toBe(1);

    // Owner reveals decrypted code cleanly
    const revealed = await revealOrderCodes({
      orderId: checkout.order.id,
      actorUserId: CUSTOMER_SESSION.id,
    });
    expect(revealed).toHaveLength(1);
    expect(revealed[0].code).toContain("PSN-DEMO-1000-");

    // Another user (even admin) cannot call revealOrderCodes on customer's order
    await expect(
      revealOrderCodes({
        orderId: checkout.order.id,
        actorUserId: "00000000-0000-4000-8000-00000000a001",
      })
    ).rejects.toThrow(/FORBIDDEN_ORDER_OWNER/);
  });

  it("protects against underpayment spoofing (never delivers codes, credits paid amount)", async () => {
    const checkout = await initiateCheckout({
      email: "buyer@example.com",
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: null,
      ipAddress: null,
    });

    const checkoutId = checkout.order.gatewayCheckoutId!;
    // Simulate gateway reporting only $5.00 paid for a $10.50 item
    setSandboxZenoCheckout({
      id: checkoutId,
      orderId: checkout.order.id,
      priceCurrency: "USD",
      priceAmount: "10.50",
      paidAmount: "5.00",
      status: "COMPLETED",
      expiresAt: checkout.order.expiresAt,
      checkoutUrl: checkout.checkoutUrl,
      createdAt: checkout.order.createdAt,
      successRedirectUrl: null,
    });

    const outcome = await processVerifiedWebhookEvent({
      gateway: "zenobank",
      eventId: "evt_underpay_1",
      eventType: "checkout.completed",
      orderId: checkout.order.id,
      checkoutId,
      priceCents: 1050,
      paidCents: 500,
      status: "COMPLETED",
      rawPayload: {},
    });

    expect(outcome.outcome).toBe("partial_underpaid_credited");
    const order = await getOrderById(checkout.order.id);
    expect(order?.status).toBe("REFUNDED_CREDIT");
    expect(order?.fulfillments.length).toBe(0);
    expect(await getUserCreditBalanceCents(order!.userId!)).toBe(500);
  });

  it("credits overpayment surplus cleanly and releases stock on expiration", async () => {
    const cOver = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: null,
    });

    setSandboxZenoCheckout({
      id: cOver.order.gatewayCheckoutId!,
      orderId: cOver.order.id,
      priceCurrency: "USD",
      priceAmount: "10.50",
      paidAmount: "13.00",
      status: "COMPLETED",
      expiresAt: cOver.order.expiresAt,
      checkoutUrl: cOver.checkoutUrl,
      createdAt: cOver.order.createdAt,
      successRedirectUrl: null,
    });

    await processVerifiedWebhookEvent({
      gateway: "zenobank",
      eventId: "evt_overpay_1",
      eventType: "checkout.completed",
      orderId: cOver.order.id,
      checkoutId: cOver.order.gatewayCheckoutId!,
      priceCents: 1050,
      paidCents: 1300,
      status: "COMPLETED",
      rawPayload: {},
    });

    // Initial 350 + 250 surplus = 600 cents
    expect(await getUserCreditBalanceCents(CUSTOMER_SESSION.id)).toBe(600);

    // Now test expiration releases reserved stock back to AVAILABLE
    const beforeCatalog = await listCatalog();
    const stockBefore =
      beforeCatalog
        .flatMap((p) => p.variants)
        .find((v) => v.id === PSN_10_VARIANT_ID)?.availableStock ?? 0;

    const cExp = await initiateCheckout({
      email: "expire@example.com",
      items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: null,
      ipAddress: null,
    });

    const duringCatalog = await listCatalog();
    const stockDuring =
      duringCatalog
        .flatMap((p) => p.variants)
        .find((v) => v.id === PSN_10_VARIANT_ID)?.availableStock ?? 0;
    expect(stockDuring).toBe(stockBefore - 1);

    setSandboxZenoCheckout({
      id: cExp.order.gatewayCheckoutId!,
      orderId: cExp.order.id,
      priceCurrency: "USD",
      priceAmount: "10.50",
      paidAmount: "0.00",
      status: "EXPIRED",
      expiresAt: cExp.order.expiresAt,
      checkoutUrl: cExp.checkoutUrl,
      createdAt: cExp.order.createdAt,
      successRedirectUrl: null,
    });

    await processVerifiedWebhookEvent({
      gateway: "zenobank",
      eventId: "evt_exp_1",
      eventType: "checkout.expired",
      orderId: cExp.order.id,
      checkoutId: cExp.order.gatewayCheckoutId!,
      priceCents: 1050,
      paidCents: 0,
      status: "EXPIRED",
      rawPayload: {},
    });

    const afterCatalog = await listCatalog();
    const stockAfter =
      afterCatalog
        .flatMap((p) => p.variants)
        .find((v) => v.id === PSN_10_VARIANT_ID)?.availableStock ?? 0;
    expect(stockAfter).toBe(stockBefore);
  });

  it("prevents overselling when 20 concurrent checkouts race for 1 last code", async () => {
    resetSandboxStateForTests([
      makeSingleInventoryRow("PSN-ONLY-ONE-CODE-0001"),
    ]);

    const attempts = Array.from({ length: 20 }, (_, idx) =>
      initiateCheckout({
        email: `racer${idx}@example.com`,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "zenobank",
        sessionUser: null,
        ipAddress: "127.0.0.1",
      })
    );

    const results = await Promise.allSettled(attempts);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(19);
  });
});
