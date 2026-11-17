import { beforeEach, describe, expect, it, vi } from "vitest";

const TEN_NETFLIX_CARDS = Array.from({ length: 10 }, (_, idx) => `NAA3NTXTEST000${idx}`);

const { mockCreateFazerOrder, mockGetFazerOrder, mockGetFazerBalance, mockSendOrderReadyEmail } = vi.hoisted(() => ({
  mockCreateFazerOrder: vi.fn(),
  mockGetFazerOrder: vi.fn(),
  mockGetFazerBalance: vi.fn(),
  mockSendOrderReadyEmail: vi.fn(),
}));

vi.mock("@/lib/server/suppliers/fazercards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/suppliers/fazercards")>();
  return {
    ...actual,
    createFazerCardsGiftCardOrder: mockCreateFazerOrder,
    getFazerCardsOrder: mockGetFazerOrder,
    getFazerCardsBalance: mockGetFazerBalance,
  };
});

vi.mock("@/lib/server/supplier-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/supplier-sync")>();
  return {
    ...actual,
    fetchLiveQuoteForSku: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@/lib/server/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/email")>();
  return {
    ...actual,
    sendOrderReadyEmail: mockSendOrderReadyEmail.mockResolvedValue({ sent: true }),
    sendCreditAdjustmentEmail: vi.fn().mockResolvedValue({ sent: true }),
  };
});

import * as repository from "@/lib/server/repository";
import { initiateCheckout } from "@/lib/server/checkout-service";
import {
  fulfillOrder,
  processVerifiedWebhookEvent,
  syncCentralOneOrderProgress,
} from "@/lib/server/fulfillment";
import { setSandboxZenoCheckout } from "@/lib/server/payments/zenobank";
import { getSandboxState, resetSandboxStateForTests } from "@/lib/server/sandbox-db";
import type { SessionUser } from "@/types";

const NINTENDO_10_VARIANT_ID = "20000000-0000-4000-8000-000000000201";

const CUSTOMER_SESSION: SessionUser = {
  id: "00000000-0000-4000-8000-00000000c001",
  email: "carlos@storycheap.com",
  role: "customer",
  aal: "aal1",
  isSandbox: true,
};

describe("FazerCards Concurrent Webhook & Fulfillment Idempotency", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetSandboxStateForTests();
    getSandboxState().inventory = [];

    mockGetFazerBalance.mockResolvedValue({
      configured: true,
      sandbox: false,
      balanceCents: 100000,
      currency: "USD",
      healthy: true,
    });
    mockSendOrderReadyEmail.mockResolvedValue({ sent: true });

    await repository.saveVariantPricingMeta(NINTENDO_10_VARIANT_ID, {
      exactCostUsd: "7.0000",
    });
    await repository.updateProviderConfig("fazercards", { enabled: true }, null);

    mockCreateFazerOrder.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return {
        externalOrderId: "fazer:ord-concurrent-10",
        rawOrderId: "ord-concurrent-10",
        status: "COMPLETED" as const,
        quantity: 10,
        codes: TEN_NETFLIX_CARDS,
        unitCostCents: 700,
        failReason: null,
        rawResponse: { ok: true },
      };
    });

    mockGetFazerOrder.mockResolvedValue({
      externalOrderId: "fazer:ord-concurrent-10",
      rawOrderId: "ord-concurrent-10",
      status: "COMPLETED",
      quantity: 10,
      codes: TEN_NETFLIX_CARDS,
      unitCostCents: 700,
      failReason: null,
      rawResponse: { ok: true },
    });
  });

  it("never duplicates fulfillment rows when FazerCards webhooks race against fulfillOrder on a 10-card order", async () => {
    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: NINTENDO_10_VARIANT_ID, quantity: 10 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    const orderId = checkout.order.id;
    const itemId = checkout.order.items[0]!.id;

    // Make supplier lookup return the live FazerCards record even under sandbox mode
    const supplierSpy = vi
      .spyOn(repository, "getSupplierOrderByExternalId")
      .mockResolvedValue({
        id: "so-concurrent-10",
        orderId,
        orderItemId: itemId,
        provider: "fazercards",
        idempotencyKey: `sc-item-${itemId}`,
        externalOrderId: "fazer:ord-concurrent-10",
        referenceCode: "ord-concurrent-10",
        status: "processing",
        expectedQty: 10,
        deliveredCount: 0,
        supplierUnitCostCents: 700,
        lastSequence: 0,
        errorMessage: null,
        rawPayload: {},
        createdAt: checkout.order.createdAt,
        updatedAt: checkout.order.createdAt,
      });
    const updateStateSpy = vi
      .spyOn(repository, "updateSupplierOrderState")
      .mockResolvedValue(undefined);

    const checkoutId = checkout.order.gatewayCheckoutId!;
    setSandboxZenoCheckout({
      id: checkoutId,
      orderId,
      priceCurrency: "USD",
      priceAmount: (checkout.order.amountDueCents / 100).toFixed(2),
      paidAmount: (checkout.order.amountDueCents / 100).toFixed(2),
      status: "COMPLETED",
      expiresAt: checkout.order.expiresAt,
      checkoutUrl: checkout.checkoutUrl,
      createdAt: checkout.order.createdAt,
      successRedirectUrl: null,
    });

    // Race ZenoBank checkout webhook + two parallel FazerCards webhooks at once
    const [whRes] = await Promise.all([
      processVerifiedWebhookEvent({
        gateway: "zenobank",
        eventId: `checkout.completed:${checkoutId}`,
        eventType: "checkout.completed",
        orderId,
        checkoutId,
        priceCents: checkout.order.amountDueCents,
        paidCents: checkout.order.amountDueCents,
        status: "COMPLETED",
        expiresAt: checkout.order.expiresAt,
        rawPayload: {},
      }),
      syncCentralOneOrderProgress("fazer:ord-concurrent-10"),
      syncCentralOneOrderProgress("fazer:ord-concurrent-10"),
    ]);
    expect(whRes.outcome).toBe("delivered_or_fulfilling");

    // Re-running fulfillOrder is also strictly idempotent
    await fulfillOrder(orderId);

    const finalOrder = await repository.getOrderById(orderId);
    expect(finalOrder?.status).toBe("DELIVERED");
    expect(finalOrder?.fulfillments).toHaveLength(10);

    const distinctLast4 = new Set(finalOrder?.fulfillments.map((f) => f.codeLast4));
    expect(distinctLast4.size).toBe(10);

    expect(mockSendOrderReadyEmail).toHaveBeenCalledTimes(1);
    supplierSpy.mockRestore();
    updateStateSpy.mockRestore();
  });
});
