import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRepo = vi.hoisted(() => ({
  recordWebhookEventOnce: vi.fn(),
  updateWebhookEventStatus: vi.fn(),
  getOrderById: vi.fn(),
  getOrderItemTargets: vi.fn().mockResolvedValue({}),
  updateOrderItemTargetStatus: vi.fn().mockResolvedValue(undefined),
  getSupplierOrderByExternalId: vi.fn(),
  getSupplierOrderByIdentifier: vi.fn().mockResolvedValue(null),
  listPendingSupplierOrdersForOrder: vi.fn(),
  listPendingSupplierOrders: vi.fn(),
  upsertSupplierOrder: vi.fn(),
  updateSupplierOrderState: vi.fn(),
  updateOrderItemUnitCostCents: vi.fn(),
  insertFulfillmentRecord: vi.fn(),
  countFulfillmentsForOrderItem: vi.fn().mockResolvedValue(0),
  markOrderItemProgress: vi.fn(),
  transitionOrderStatus: vi.fn(),
  markOrderAttentionFlag: vi.fn(),
  appendAuditLog: vi.fn(),
  getProviderConfig: vi.fn(),
  getVariantsLookupByIds: vi.fn(),
  reserveManualCodes: vi.fn(),
  commitReservedCodesForOrder: vi.fn(),
  releaseReservedCodesForOrder: vi.fn(),
  ensureCustomerProfile: vi.fn(),
  getUserCreditBalanceCents: vi.fn(),
  appendCreditLedgerEntry: vi.fn(),
  applyAdditionalCreditToOrder: vi.fn(),
  getOrderByGatewayCheckoutId: vi.fn(),
  updateOrderPartialPaymentCents: vi.fn(),
}));

vi.mock("@/lib/server/env", () => ({
  getCentralOneApiKey: () => "co_live_test_key",
  getCentralOneBaseUrl: () => "https://portal.centraloneglobal.com/api/v1",
  getCentralOneProxyUrl: () => null,
  getCentralOneProxyMode: () => "fallback",
  getCentralOneWebhookSecret: () => "whsec_centralone_current",
  isCentralOneConfigured: () => true,
  isSandboxMode: () => false,
}));

vi.mock("@/lib/server/repository", () => mockRepo);
vi.mock("@/lib/server/email", () => ({
  sendOrderReadyEmail: vi.fn().mockResolvedValue(undefined),
  sendCreditAdjustmentEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/server/crypto", () => ({
  encryptCode: (val: string) => `enc:${val}`,
  extractLast4: (val: string) => val.slice(-4),
}));

import {
  createCentralOneOrder,
  getCentralOneOrder,
  getCentralOneOrderCodes,
  listCentralOneOrders,
  verifyCentralOneWebhookSignature,
} from "@/lib/server/suppliers/centralone";
import { POST as centralOneWebhookPost } from "@/app/api/webhooks/centralone/route";
import * as fulfillment from "@/lib/server/fulfillment";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function signWebhookPayload(secret: string, timestamp: number, rawBody: string) {
  const hex = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `sha256=${hex}`;
}

describe("Central One API v1 compliance", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.countFulfillmentsForOrderItem.mockResolvedValue(0);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends official POST /orders shape with note and parses initial confirmed response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          order: {
            id: "ord-uuid-1",
            reference_code: "CO-ORD-20261114-D08176",
            status: "confirmed",
            total_sale_amount: "1.3802",
            currency: "USD",
            created_at: "2026-11-14T18:46:00Z",
          },
        },
        201
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await createCentralOneOrder({
      idempotencyKey: "sc-item-123",
      catalogItemId: "cat-ff-110",
      quantity: 2,
      externalReference: "SC-202611-TEST:item-123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://portal.centraloneglobal.com/api/v1/orders");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(
      "sc-item-123"
    );
    expect(JSON.parse(String(init.body))).toEqual({
      items: [{ catalog_item_id: "cat-ff-110", quantity: 2 }],
      note: "SC-202611-TEST:item-123",
    });

    expect(result.externalOrderId).toBe("ord-uuid-1");
    expect(result.referenceCode).toBe("CO-ORD-20261114-D08176");
    expect(result.status).toBe("confirmed");
    expect(result.deliveredCount).toBe(0);
    // 1.3802 / 2 = 0.6901 -> 69 cents unit cost
    expect(result.unitCostCents).toBe(69);
  });

  it("parses GET /orders/{id} using official order.lines[] array and failure reason", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        order: {
          id: "ord-uuid-2",
          reference_code: "CO-ORD-20261114-5395CD",
          status: "delivered",
          total_sale_amount: "0.6901",
          currency: "USD",
          lines: [
            {
              id: "line-1",
              product_id: "prod-ff",
              product_sku: "FF-110",
              quantity: 1,
              delivered_count: 1,
              unit_price: "0.6901",
              subtotal: "0.6901",
              status: "completed",
              refund: null,
              failure: null,
            },
          ],
          failure: null,
        },
      })
    ) as typeof fetch;

    const order = await getCentralOneOrder("ord-uuid-2");
    expect(order.status).toBe("delivered");
    expect(order.deliveredCount).toBe(1);
    expect(order.unitCostCents).toBe(69);
    expect(order.failureReason).toBeNull();
  });

  it("flattens nested GET /orders/{id}/codes response and preserves 409 codes_not_ready error details", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        order_id: "ord-uuid-2",
        reference_code: "CO-ORD-20261114-5395CD",
        codes: [
          {
            order_line_id: "line-1",
            product_sku: "FF-110",
            product_name: "Free Fire 110 Diamantes",
            quantity: 2,
            codes: ["ABCD-EFGH-1111", "IJKL-MNOP-2222 - PIN99"],
          },
        ],
      })
    ) as typeof fetch;

    const codes = await getCentralOneOrderCodes("ord-uuid-2");
    expect(codes).toEqual([
      { codePlaintext: "ABCD-EFGH-1111", pinPlaintext: null },
      { codePlaintext: "IJKL-MNOP-2222", pinPlaintext: "PIN99" },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "codes_not_ready",
            message: "Order codes are still being generated",
          },
        },
        409
      )
    ) as typeof fetch;

    await expect(getCentralOneOrderCodes("ord-uuid-pending")).rejects.toMatchObject({
      code: "codes_not_ready",
      httpStatus: 409,
    });
  });

  it("clamps GET /orders limit to 1..50, includes delivered orders, and subtracts refunds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        orders: [
          {
            id: "o1",
            reference_code: "CO-ORD-1",
            status: "delivered",
            total_sale_amount: "0.6901",
            currency: "USD",
            line_count: 1,
            refund: { refunded: false, amount: "0.0000" },
            created_at: "2026-11-14T18:46:00Z",
          },
          {
            id: "o2",
            reference_code: "CO-ORD-2",
            status: "partially_delivered",
            total_sale_amount: "2.0000",
            currency: "USD",
            line_count: 2,
            refund: { refunded: true, scope: "partial", amount: "1.0000" },
            created_at: "2026-11-14T19:00:00Z",
          },
          {
            id: "o3",
            reference_code: "CO-ORD-3",
            status: "failed",
            total_sale_amount: "1.0000",
            currency: "USD",
            line_count: 1,
            created_at: "2026-11-14T19:05:00Z",
          },
        ],
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const report = await listCentralOneOrders(100);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://portal.centraloneglobal.com/api/v1/orders?limit=50"
    );
    expect(report.healthy).toBe(true);
    expect(report.completedCount).toBe(2);
    // 69 cents + (200 - 100) cents = 169 cents
    expect(report.totalSpentCents).toBe(169);
  });

  it("verifies HMAC webhook signature with X-CentralOne-Signature and X-CentralOne-Signature-Previous", () => {
    const rawBody = JSON.stringify({ data: { order_id: "ord-123" } });
    const ts = 1_794_732_000;
    const nowMs = ts * 1000 + 5_000;
    const sig = signWebhookPayload("whsec_centralone_current", ts, rawBody);

    expect(
      verifyCentralOneWebhookSignature({
        rawBody,
        timestampHeader: String(ts),
        signatureHeader: sig,
        nowMs,
      })
    ).toEqual({ valid: true });

    expect(
      verifyCentralOneWebhookSignature({
        rawBody,
        timestampHeader: String(ts),
        signatureHeader: "sha256=deadbeefdeadbeef",
        previousSignatureHeader: sig,
        nowMs,
      })
    ).toEqual({ valid: true });

    expect(
      verifyCentralOneWebhookSignature({
        rawBody,
        timestampHeader: String(ts),
        signatureHeader: "sha256=deadbeef",
        nowMs,
      }).valid
    ).toBe(false);
  });

  it("handles official Central One webhook headers, webhook.test ACK, and order.delivered sync", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const testBody = JSON.stringify({
      message: "Test ping from Central One",
      sent_at: "2026-11-15T05:00:00Z",
    });
    const testSig = signWebhookPayload("whsec_centralone_current", ts, testBody);

    const testReq = new NextRequest("https://storycheap.com/api/webhooks/centralone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CentralOne-Event-Id": "evt-test-1",
        "X-CentralOne-Event": "webhook.test",
        "X-CentralOne-Timestamp": String(ts),
        "X-CentralOne-Signature": testSig,
      },
      body: testBody,
    });

    const testRes = await centralOneWebhookPost(testReq);
    expect(testRes.status).toBe(200);
    const testJson = (await testRes.json()) as Record<string, unknown>;
    expect(testJson).toMatchObject({
      received: true,
      eventId: "evt-test-1",
      eventType: "webhook.test",
      acknowledged: true,
    });

    const syncSpy = vi
      .spyOn(fulfillment, "syncCentralOneOrderProgress")
      .mockResolvedValueOnce({ ok: true, status: "delivered", addedCodes: 1 });
    mockRepo.recordWebhookEventOnce.mockResolvedValueOnce({
      isDuplicate: false,
      recordId: "wh-rec-1",
    });
    mockRepo.updateWebhookEventStatus.mockResolvedValueOnce(undefined);

    const orderBody = JSON.stringify({
      sequence: 3,
      data: {
        order: { id: "ord-live-99", reference_code: "CO-ORD-99" },
      },
    });
    const orderSig = signWebhookPayload("whsec_centralone_current", ts, orderBody);
    const orderReq = new NextRequest("https://storycheap.com/api/webhooks/centralone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CentralOne-Event-Id": "evt-ord-99",
        "X-CentralOne-Event": "order.delivered",
        "X-CentralOne-Timestamp": String(ts),
        "X-CentralOne-Signature-Previous": orderSig,
      },
      body: orderBody,
    });

    const orderRes = await centralOneWebhookPost(orderReq);
    expect(orderRes.status).toBe(200);
    expect(mockRepo.recordWebhookEventOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: "centralone",
        eventId: "evt-ord-99",
        eventType: "order.delivered",
        gatewayCheckoutId: "ord-live-99",
      })
    );
    await vi.waitFor(() => {
      expect(syncSpy).toHaveBeenCalledWith(
        {
          externalOrderId: "ord-live-99",
          referenceCode: "CO-ORD-99",
          idempotencyKey: null,
        },
        3
      );
    });
  });

  it("reuses existing supplier_orders on fulfillOrder instead of double-purchasing on Central One", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/orders/ord-existing-77")) {
        return jsonResponse({
          order: {
            id: "ord-existing-77",
            reference_code: "CO-ORD-77",
            status: "delivered",
            total_sale_amount: "0.6901",
            lines: [
              {
                id: "l1",
                quantity: 1,
                delivered_count: 1,
                unit_price: "0.6901",
                status: "completed",
              },
            ],
          },
        });
      }
      if (url.endsWith("/orders/ord-existing-77/codes")) {
        return jsonResponse({
          order_id: "ord-existing-77",
          codes: [{ order_line_id: "l1", codes: ["FF-PIN-7777"] }],
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const baseOrder = {
      id: "order-sc-77",
      orderNumber: "SC-202611-0077",
      userId: "user-1",
      email: "cliente@example.com",
      status: "MANUAL_REVIEW",
      paymentGateway: "zenobank",
      subtotalCents: 72,
      discountCents: 0,
      creditAppliedCents: 0,
      amountDueCents: 72,
      paidCents: 72,
      needsAttention: true,
      attentionReason: null,
      createdAt: "2026-11-14T20:00:00Z",
      updatedAt: "2026-11-14T20:00:00Z",
      items: [
        {
          id: "item-sc-77",
          orderId: "order-sc-77",
          variantId: "var-ff-110",
          productName: "Free Fire",
          denominationLabel: "110 Diamantes",
          quantity: 1,
          unitPriceCents: 72,
          unitCostCents: null,
          deliveredCount: 0,
          status: "PENDING",
        },
      ],
      fulfillments: [],
    };

    mockRepo.getOrderById
      .mockResolvedValueOnce(baseOrder)
      .mockResolvedValueOnce({ ...baseOrder, status: "DELIVERED" });
    mockRepo.commitReservedCodesForOrder.mockResolvedValue([]);
    mockRepo.reserveManualCodes.mockResolvedValue([]);
    mockRepo.upsertSupplierOrder.mockResolvedValue({});
    mockRepo.updateOrderItemUnitCostCents.mockResolvedValue(undefined);
    mockRepo.insertFulfillmentRecord.mockResolvedValue({});
    mockRepo.markOrderItemProgress.mockResolvedValue(undefined);
    mockRepo.appendAuditLog.mockResolvedValue(undefined);
    mockRepo.transitionOrderStatus.mockResolvedValue(true);
    mockRepo.getProviderConfig.mockResolvedValue({
      provider: "centralone",
      enabled: true,
      priority: 1,
      settings: {},
    });
    mockRepo.getVariantsLookupByIds.mockResolvedValueOnce(
      new Map([
        [
          "var-ff-110",
          {
            product: { id: "prod-ff", name: "Free Fire" },
            variant: {
              id: "var-ff-110",
              sourcePriority: "centralone_only",
              centraloneProductId: "cat-ff-110",
              unitCostCents: 69,
            },
          },
        ],
      ])
    );
    mockRepo.listPendingSupplierOrdersForOrder.mockResolvedValueOnce([
      {
        id: "so-77",
        orderId: "order-sc-77",
        orderItemId: "item-sc-77",
        provider: "centralone",
        idempotencyKey: "sc-item-item-sc-77",
        externalOrderId: "ord-existing-77",
        referenceCode: "CO-ORD-77",
        status: "confirmed",
        expectedQty: 1,
        deliveredCount: 0,
        supplierUnitCostCents: 69,
        lastSequence: 0,
        errorMessage: null,
        rawPayload: {},
        createdAt: "2026-11-14T20:00:00Z",
        updatedAt: "2026-11-14T20:00:00Z",
      },
    ]);

    const res = await fulfillment.fulfillOrder("order-sc-77");
    expect(res.status).toBe("DELIVERED");
    expect(mockRepo.transitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-sc-77",
        nextStatus: "DELIVERED",
      })
    );
    // Ensure GET /orders/{id} + GET /orders/{id}/codes were called, NOT POST /orders
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(
      true
    );
    expect(mockRepo.insertFulfillmentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-sc-77",
        orderItemId: "item-sc-77",
        source: "centralone",
        codeCiphertext: "enc:FF-PIN-7777",
        supplierTxId: "ord-existing-77",
      })
    );
  });

  it("handles 409 codes_not_ready gracefully and delivers once codes become available in syncCentralOneOrderProgress", async () => {
    const fulfillingOrder = {
      id: "order-sc-88",
      orderNumber: "SC-202611-0088",
      userId: "user-1",
      email: "cliente@example.com",
      status: "FULFILLING",
      paymentGateway: "zenobank",
      subtotalCents: 72,
      discountCents: 0,
      creditAppliedCents: 0,
      amountDueCents: 72,
      paidCents: 72,
      needsAttention: false,
      attentionReason: null,
      createdAt: "2026-11-14T20:00:00Z",
      updatedAt: "2026-11-14T20:00:00Z",
      items: [
        {
          id: "item-sc-88",
          orderId: "order-sc-88",
          variantId: "var-ff-110",
          productName: "Free Fire",
          denominationLabel: "110 Diamantes",
          quantity: 1,
          unitPriceCents: 72,
          unitCostCents: 69,
          deliveredCount: 0,
          status: "RESERVED",
        },
      ],
      fulfillments: [],
    };

    const supplierOrder = {
      id: "so-88",
      orderId: "order-sc-88",
      orderItemId: "item-sc-88",
      provider: "centralone",
      idempotencyKey: "sc-item-item-sc-88",
      externalOrderId: "ord-ext-88",
      referenceCode: "CO-ORD-88",
      status: "confirmed",
      expectedQty: 1,
      deliveredCount: 0,
      supplierUnitCostCents: 69,
      lastSequence: 0,
      errorMessage: null,
      rawPayload: {},
      createdAt: "2026-11-14T20:00:00Z",
      updatedAt: "2026-11-14T20:00:00Z",
    };

    mockRepo.getSupplierOrderByExternalId.mockResolvedValue(supplierOrder);
    mockRepo.updateSupplierOrderState.mockResolvedValue(undefined);
    mockRepo.updateOrderItemUnitCostCents.mockResolvedValue(undefined);
    mockRepo.insertFulfillmentRecord.mockResolvedValue({});
    mockRepo.markOrderItemProgress.mockResolvedValue(undefined);
    mockRepo.transitionOrderStatus.mockResolvedValue(true);

    // 1st poll: status delivered in header or processing, but /codes returns 409 codes_not_ready
    mockRepo.getOrderById.mockResolvedValueOnce(fulfillingOrder).mockResolvedValueOnce(fulfillingOrder);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          order: {
            id: "ord-ext-88",
            status: "delivered",
            total_sale_amount: "0.6901",
            lines: [{ id: "l1", quantity: 1, delivered_count: 1, unit_price: "0.6901" }],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "codes_not_ready", message: "Codes not ready yet" } },
          409
        )
      ) as typeof fetch;

    const firstSync = await fulfillment.syncCentralOneOrderProgress("ord-ext-88", 1);
    expect(firstSync).toEqual({ ok: true, status: "delivered", addedCodes: 0 });
    expect(mockRepo.insertFulfillmentRecord).not.toHaveBeenCalled();
    expect(mockRepo.transitionOrderStatus).not.toHaveBeenCalled();

    // 2nd poll: codes ready -> delivers and transitions FULFILLING -> DELIVERED
    mockRepo.getOrderById
      .mockResolvedValueOnce(fulfillingOrder)
      .mockResolvedValueOnce({
        ...fulfillingOrder,
        items: [{ ...fulfillingOrder.items[0], deliveredCount: 1, status: "FULFILLED" }],
      });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          order: {
            id: "ord-ext-88",
            status: "delivered",
            total_sale_amount: "0.6901",
            lines: [{ id: "l1", quantity: 1, delivered_count: 1, unit_price: "0.6901" }],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          order_id: "ord-ext-88",
          codes: [{ order_line_id: "l1", codes: ["FF-LIVE-8888"] }],
        })
      ) as typeof fetch;

    const secondSync = await fulfillment.syncCentralOneOrderProgress("ord-ext-88", 2);
    expect(secondSync).toEqual({ ok: true, status: "delivered", addedCodes: 1 });
    expect(mockRepo.insertFulfillmentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-sc-88",
        codeCiphertext: "enc:FF-LIVE-8888",
      })
    );
    expect(mockRepo.transitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-sc-88",
        nextStatus: "DELIVERED",
      })
    );
  });
});
