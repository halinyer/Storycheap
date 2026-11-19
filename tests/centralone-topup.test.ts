import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRepo = vi.hoisted(() => ({
  recordWebhookEventOnce: vi.fn(),
  updateWebhookEventStatus: vi.fn(),
  getOrderById: vi.fn(),
  getOrderItemTargets: vi.fn(),
  updateOrderItemTargetStatus: vi.fn(),
  getSupplierOrderByExternalId: vi.fn(),
  getSupplierOrderByIdentifier: vi.fn(),
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
  getSupplierPricingPolicy: vi.fn(),
  getVariantPricingMetaMap: vi.fn(),
  setVariantPricingMeta: vi.fn(),
  updateVariantUnitCostCents: vi.fn(),
  updateVariantSalePriceCents: vi.fn(),
  reserveManualCodes: vi.fn(),
  commitReservedCodesForOrder: vi.fn(),
  releaseReservedCodesForOrder: vi.fn(),
  ensureCustomerProfile: vi.fn(),
  getUserCreditBalanceCents: vi.fn(),
  appendCreditLedgerEntry: vi.fn(),
  applyAdditionalCreditToOrder: vi.fn(),
  getOrderByGatewayCheckoutId: vi.fn(),
  updateOrderPartialPaymentCents: vi.fn(),
  listCatalog: vi.fn(),
  getStoreSetting: vi.fn(),
  setStoreSetting: vi.fn(),
}));

vi.mock("@/lib/server/env", () => ({
  getCentralOneApiKey: () => "co_live_test_key",
  getCentralOneBaseUrl: () => "https://portal.centraloneglobal.com/api/v1",
  getCentralOneProxyUrl: () => null,
  getCentralOneProxyMode: () => "fallback",
  getCentralOneWebhookSecret: () => "whsec_centralone_topup",
  isCentralOneConfigured: () => true,
  isSandboxMode: () => false,
  isFazerCardsConfigured: () => false,
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
  buildCartLineKey,
  formatTargetSummary,
  isLoginModeTarget,
  normalizeTargetSchema,
  validateTargetPayloadAgainstSchema,
} from "@/lib/topup-targets";
import {
  clearCentralOneValidationCachesForTests,
  createCentralOneOrder,
  validateCentralOnePlayer,
} from "@/lib/server/suppliers/centralone";
import {
  CheckoutValidationError,
  validateAndPriceCart,
} from "@/lib/server/pricing";
import {
  fulfillOrder,
  processVerifiedWebhookEvent,
} from "@/lib/server/fulfillment";
import { POST as centralOneWebhookPost } from "@/app/api/webhooks/centralone/route";
import { sendOrderReadyEmail } from "@/lib/server/email";

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

describe("Central One Direct ID/UID Top-Ups", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    clearCentralOneValidationCachesForTests();
    mockRepo.countFulfillmentsForOrderItem.mockResolvedValue(0);
    mockRepo.getOrderItemTargets.mockResolvedValue({});
    mockRepo.updateOrderItemTargetStatus.mockResolvedValue(undefined);
    mockRepo.listPendingSupplierOrdersForOrder.mockResolvedValue([]);
    mockRepo.commitReservedCodesForOrder.mockResolvedValue([]);
    mockRepo.getStoreSetting.mockResolvedValue(null);
    mockRepo.getSupplierPricingPolicy.mockResolvedValue({
      mode: "markup",
      markupPercent: 10,
      minProfitCents: 10,
      autoSyncEnabled: false,
      blockNegativeMargin: false,
    });
    mockRepo.getVariantPricingMetaMap.mockResolvedValue({});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("Target schema validation & Login Mode blocking", () => {
    it("blocks Login Mode products (email/password) and allows clean ID/UID + Server top-ups", () => {
      expect(
        isLoginModeTarget(
          ["email", "password"],
          null,
          "Genshin Impact 980 Genesis Crystals (Login Mode)"
        )
      ).toBe(true);

      expect(
        isLoginModeTarget(
          ["user_id", "zone_id"],
          [
            { key: "user_id", label: "User ID", type: "text", options: null },
            { key: "zone_id", label: "Zone ID", type: "text", options: null },
          ],
          "Mobile Legends 86 Diamonds"
        )
      ).toBe(false);
    });

    it("enforces exact select options[].value and synthesizes schema from target_fields", () => {
      const schema = normalizeTargetSchema(
        ["user_id", "server"],
        [
          { key: "user_id", label: "Player ID", type: "text", options: null },
          {
            key: "server",
            label: "Server",
            type: "select",
            options: [
              { value: "os_usa", label: "America" },
              { value: "os_euro", label: "Europe" },
            ],
          },
        ]
      );

      // Sending display label ("America") instead of option value ("os_usa") MUST fail
      const badSelect = validateTargetPayloadAgainstSchema(
        { user_id: "123456789", server: "America" },
        schema
      );
      expect(badSelect.ok).toBe(false);

      const goodSelect = validateTargetPayloadAgainstSchema(
        { user_id: " 123456789 ", server: "os_usa" },
        schema
      );
      expect(goodSelect.ok).toBe(true);
      if (!goodSelect.ok) throw new Error("Expected valid payload");

      expect(goodSelect.cleanPayload).toEqual({
        user_id: "123456789",
        server: "os_usa",
      });

      const summary = formatTargetSummary(
        goodSelect.cleanPayload,
        schema,
        "ProGamerVE"
      );
      expect(summary).toContain("123456789");
      expect(summary).toContain("America");
      expect(summary).toContain("ProGamerVE");

      // Different player IDs on the same variant stay distinct cart lines
      const k1 = buildCartLineKey("var-ff-100", { player_id: " 111222 " });
      const k2 = buildCartLineKey("var-ff-100", { player_id: "111222" });
      const k3 = buildCartLineKey("var-ff-100", { player_id: "999888" });
      expect(k1).toBe(k2);
      expect(k1).not.toBe(k3);
    });
  });

  describe("Central One API v1 player validation & order shape", () => {
    it("calls POST /player/validate, caches valid player nickname, and handles invalid players", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            status: "valid",
            provider: "garena",
            player: { name: "Kratos_LATAM" },
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            status: "invalid",
            provider: "garena",
            message: "Player ID not found",
          })
        );
      globalThis.fetch = fetchMock as typeof fetch;

      const first = await validateCentralOnePlayer({
        productId: "prod-ff-latam",
        targetPayload: { player_id: "2345678901" },
      });
      expect(first.status).toBe("valid");
      expect(first.playerName).toBe("Kratos_LATAM");

      // Second identical call hits 5-min in-memory cache (protects 30 req/60s account limit)
      const cached = await validateCentralOnePlayer({
        productId: "prod-ff-latam",
        targetPayload: { player_id: "2345678901" },
      });
      expect(cached.status).toBe("valid");
      expect(cached.playerName).toBe("Kratos_LATAM");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const invalid = await validateCentralOnePlayer({
        productId: "prod-ff-latam",
        targetPayload: { player_id: "000000000" },
      });
      expect(invalid.status).toBe("invalid");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("splits quantity > 1 into separate quantity: 1 lines with target_payload and expected_unit_price", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            order: {
              id: "c1-topup-uuid-1",
              reference_code: "CO-TOPUP-001",
              status: "completed",
              total_sale_amount: "1.9000",
              currency: "USD",
              items: [
                {
                  id: "l1",
                  quantity: 1,
                  delivered_count: 0,
                  status: "completed",
                  unit_sale_price: "0.9500",
                },
                {
                  id: "l2",
                  quantity: 1,
                  delivered_count: 0,
                  status: "completed",
                  unit_sale_price: "0.9500",
                },
              ],
            },
          },
          201
        )
      );
      globalThis.fetch = fetchMock as typeof fetch;

      const result = await createCentralOneOrder({
        idempotencyKey: "sc-item-topup-2x",
        catalogItemId: "cat-ff-100-id",
        quantity: 2,
        externalReference: "SC-202611-TOPUP:item-1",
        targetPayload: { player_id: "2345678901" },
        expectedUnitPrice: 1.19,
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({
        items: [
          {
            catalog_item_id: "cat-ff-100-id",
            quantity: 1,
            target_payload: { player_id: "2345678901" },
            expected_unit_price: 1.19,
          },
          {
            catalog_item_id: "cat-ff-100-id",
            quantity: 1,
            target_payload: { player_id: "2345678901" },
            expected_unit_price: 1.19,
          },
        ],
        note: "SC-202611-TOPUP:item-1",
      });
      expect(result.status).toBe("completed");
      expect(result.completedLineCount).toBe(2);
      expect(result.unitCostCents).toBe(95);
    });
  });

  describe("Checkout validation & payment protection", () => {
    it("blocks checkout with INVALID_PLAYER when Central One player validator reports invalid", async () => {
      mockRepo.getProviderConfig.mockImplementation(async (provider: string) => {
        if (provider === "centralone" || provider === "global_checkout") {
          return { provider, enabled: true, sandbox: false, config: {} };
        }
        return { provider, enabled: false, sandbox: false, config: {} };
      });
      mockRepo.getVariantsLookupByIds.mockResolvedValue(
        new Map([
          [
            "var-ff-topup",
            {
              product: {
                id: "p1",
                slug: "free-fire",
                name: "Free Fire Recarga ID",
                active: true,
              },
              variant: {
                id: "var-ff-topup",
                productId: "p1",
                region: "Latam",
                denominationLabel: "100 Diamantes",
                faceValueCents: 100,
                salePriceCents: 120,
                unitCostCents: 90,
                currency: "USD",
                active: true,
                sourcePriority: "centralone_only",
                reloadlyProductId: null,
                centraloneProductId: "cat-ff-100-id",
                lowStockThreshold: 1,
                availableStock: 0,
                supplierStock: 99,
                deliverableStock: 99,
                inStock: true,
                requiresTarget: true,
                targetFields: ["player_id"],
                targetSchema: [
                  { key: "player_id", label: "ID de jugador", type: "text", options: null },
                ],
                supportsPlayerValidate: true,
              },
            },
          ],
        ])
      );

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("/balance")) {
          return jsonResponse({ balance: "50.00", currency: "USD" });
        }
        if (String(url).includes("/player/validate")) {
          return jsonResponse({
            status: "invalid",
            message: "Player ID does not exist",
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as typeof fetch;

      await expect(
        validateAndPriceCart([
          {
            variantId: "var-ff-topup",
            quantity: 1,
            targetPayload: { player_id: "999999999" },
          },
        ])
      ).rejects.toMatchObject({
        code: "INVALID_PLAYER",
        statusCode: 400,
      } satisfies Partial<CheckoutValidationError>);
    });

    it("underpayment NEVER calls Central One; overpayment credits excess AND executes direct top-up without calling /codes", async () => {
      const orderId = "ord-topup-pay-1";
      const orderItemId = "item-topup-1";
      let currentStatus = "PENDING_PAYMENT";
      let currentPaidCents = 0;
      let itemDeliveredCount = 0;

      const makeOrder = () => ({
        id: orderId,
        orderNumber: "SC-202611-TOPUP1",
        userId: "user-1",
        email: "gamer@example.com",
        status: currentStatus,
        subtotalCents: 200,
        creditAppliedCents: 0,
        amountDueCents: 200,
        paidCents: currentPaidCents,
        currency: "USD",
        paymentGateway: "zenobank",
        gatewayCheckoutId: "zbk_topup_1",
        gatewayCheckoutUrl: "https://pay.zenobank.io/checkout/zbk_topup_1",
        needsAttention: false,
        attentionReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: orderItemId,
            variantId: "var-ff-topup",
            productName: "Free Fire Recarga ID",
            productSlug: "free-fire",
            denominationLabel: "100 Diamantes",
            region: "Latam",
            quantity: 1,
            unitPriceCents: 200,
            unitCostCents: 95,
            deliveredCount: itemDeliveredCount,
            status: itemDeliveredCount >= 1 ? "FULFILLED" : "PENDING",
            targetInfo: {
              payload: { player_id: "2345678901" },
              displaySummary: "ID de jugador: 2345678901 · Jugador: Kratos_LATAM",
              playerName: "Kratos_LATAM",
              validationStatus: "valid" as const,
              supplierReferenceCode: null,
              topupStatus: "pending" as const,
              topupFailureReason: null,
            },
          },
        ],
        fulfillments: [],
      });

      mockRepo.getOrderByGatewayCheckoutId.mockImplementation(async () => makeOrder());
      mockRepo.getOrderById.mockImplementation(async () => makeOrder());
      mockRepo.recordWebhookEventOnce.mockResolvedValue({
        isDuplicate: false,
        recordId: "evt-1",
      });
      mockRepo.updateWebhookEventStatus.mockResolvedValue(undefined);
      mockRepo.updateOrderPartialPaymentCents.mockImplementation(
        async (_id: string, cents: number) => {
          currentPaidCents = cents;
        }
      );
      mockRepo.transitionOrderStatus.mockImplementation(
        async (params: { nextStatus: string; paidCents?: number }) => {
          currentStatus = params.nextStatus;
          if (typeof params.paidCents === "number") {
            currentPaidCents = params.paidCents;
          }
          return true;
        }
      );
      mockRepo.markOrderItemProgress.mockImplementation(
        async (_id: string, patch: { deliveredCount: number }) => {
          itemDeliveredCount = patch.deliveredCount;
        }
      );
      mockRepo.ensureCustomerProfile.mockResolvedValue("user-1");
      mockRepo.appendCreditLedgerEntry.mockResolvedValue(undefined);
      mockRepo.getProviderConfig.mockImplementation(async (provider: string) => ({
        provider,
        enabled: provider === "centralone",
        sandbox: false,
        config: {},
      }));
      mockRepo.getVariantsLookupByIds.mockResolvedValue(
        new Map([
          [
            "var-ff-topup",
            {
              product: {
                id: "p1",
                slug: "free-fire",
                name: "Free Fire Recarga ID",
                active: true,
              },
              variant: {
                id: "var-ff-topup",
                productId: "p1",
                region: "Latam",
                denominationLabel: "100 Diamantes",
                faceValueCents: 100,
                salePriceCents: 200,
                unitCostCents: 95,
                currency: "USD",
                active: true,
                sourcePriority: "centralone_only",
                reloadlyProductId: null,
                centraloneProductId: "cat-ff-100-id",
                lowStockThreshold: 1,
                availableStock: 0,
                supplierStock: 99,
                deliverableStock: 99,
                inStock: true,
                requiresTarget: true,
                targetFields: ["player_id"],
                targetSchema: [],
                supportsPlayerValidate: true,
              },
            },
          ],
        ])
      );

      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("/codes")) {
          throw new Error("MUST NOT call /codes for direct ID top-ups!");
        }
        if (String(url).includes("/catalog")) {
          return jsonResponse({ items: [] });
        }
        if (String(url).includes("/orders")) {
          return jsonResponse(
            {
              order: {
                id: "c1-topup-overpay-1",
                reference_code: "CO-TOPUP-OVERPAY-1",
                status: "completed",
                total_sale_amount: "0.9500",
                currency: "USD",
                items: [
                  {
                    id: "l1",
                    quantity: 1,
                    delivered_count: 0,
                    status: "completed",
                    unit_sale_price: "0.9500",
                  },
                ],
              },
            },
            201
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
      globalThis.fetch = fetchMock as typeof fetch;

      // 1) Underpayment ($1.00 of $2.00) -> MUST NOT call Central One!
      await processVerifiedWebhookEvent(
        {
          gateway: "zenobank",
          eventId: "zbk-evt-underpay",
          eventType: "checkout.partially_paid",
          checkoutId: "zbk_topup_1",
          orderId,
          status: "PARTIALLY_PAID",
          priceCents: 200,
          paidCents: 100,
          rawPayload: {},
        },
        { skipRemoteDoubleCheck: true }
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(currentStatus).toBe("PENDING_PAYMENT");
      expect(currentPaidCents).toBe(100);

      // 2) Overpayment ($3.50 for $2.00 order) -> credits $1.50 excess AND delivers direct top-up!
      await processVerifiedWebhookEvent(
        {
          gateway: "zenobank",
          eventId: "zbk-evt-overpay",
          eventType: "checkout.completed",
          checkoutId: "zbk_topup_1",
          orderId,
          status: "COMPLETED",
          priceCents: 200,
          paidCents: 350,
          rawPayload: {},
        },
        { skipRemoteDoubleCheck: true }
      );

      expect(mockRepo.appendCreditLedgerEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          orderId,
          deltaCents: 150,
          reason: "overpayment",
        })
      );
      const orderCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/orders")
      );
      expect(orderCalls).toHaveLength(1);
      const [, c1Init] = orderCalls[0] as [string, RequestInit];
      expect(JSON.parse(String(c1Init.body)).items[0].target_payload).toEqual({
        player_id: "2345678901",
      });
      expect(currentStatus).toBe("DELIVERED");
      expect(mockRepo.updateOrderItemTargetStatus).toHaveBeenCalledWith(
        orderId,
        orderItemId,
        expect.objectContaining({
          supplierReferenceCode: "CO-TOPUP-OVERPAY-1",
          topupStatus: "completed",
        })
      );
      expect(sendOrderReadyEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId,
          directTopupSummaries: expect.arrayContaining([
            expect.objectContaining({
              productName: "Free Fire Recarga ID",
            }),
          ]),
        })
      );
    });

    it("resolves async direct top-up webhook using ONLY reference_code/idempotency_key (no order.id UUID)", async () => {
      const orderId = "ord-async-topup-1";
      const orderItemId = "item-async-topup-1";
      let deliveredCount = 0;
      let asyncOrderStatus = "FULFILLING";

      mockRepo.recordWebhookEventOnce.mockResolvedValue({
        isDuplicate: false,
        recordId: "wh-1",
      });
      mockRepo.getSupplierOrderByExternalId.mockResolvedValue(null);
      mockRepo.getSupplierOrderByIdentifier.mockResolvedValue({
        id: "so-1",
        orderId,
        orderItemId,
        provider: "centralone",
        idempotencyKey: "sc-item-async-1",
        externalOrderId: "c1-uuid-async-1",
        referenceCode: "CO-ORD-20261119-ASYNC1",
        status: "processing",
        expectedQty: 1,
        deliveredCount: 0,
        lastSequence: 0,
        supplierUnitCostCents: 95,
      });
      mockRepo.getOrderById.mockImplementation(async () => ({
        id: orderId,
        orderNumber: "SC-202611-ASYNC1",
        userId: "user-1",
        email: "gamer@example.com",
        status: asyncOrderStatus,
        subtotalCents: 200,
        creditAppliedCents: 0,
        amountDueCents: 200,
        paidCents: 200,
        currency: "USD",
        paymentGateway: "zenobank",
        gatewayCheckoutId: "zbk_async_1",
        gatewayCheckoutUrl: null,
        needsAttention: false,
        attentionReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: orderItemId,
            variantId: "var-mlbb-topup",
            productName: "Mobile Legends",
            productSlug: "mobile-legends",
            denominationLabel: "86 Diamonds",
            region: "Global",
            quantity: 1,
            unitPriceCents: 200,
            unitCostCents: 95,
            deliveredCount,
            status: deliveredCount >= 1 ? "FULFILLED" : "RESERVED",
            targetInfo: {
              payload: { user_id: "12345678", zone_id: "1234" },
              displaySummary: "User ID: 12345678 · Zone ID: 1234",
              playerName: "MLBB_Hero",
              validationStatus: "valid" as const,
              supplierReferenceCode: "CO-ORD-20261119-ASYNC1",
              topupStatus: "processing" as const,
              topupFailureReason: null,
            },
          },
        ],
        fulfillments: [],
      }));
      mockRepo.markOrderItemProgress.mockImplementation(
        async (_id: string, patch: { deliveredCount: number }) => {
          deliveredCount = patch.deliveredCount;
        }
      );
      mockRepo.transitionOrderStatus.mockImplementation(
        async (params: { nextStatus: string }) => {
          asyncOrderStatus = params.nextStatus;
          return true;
        }
      );

      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("/codes")) {
          throw new Error("MUST NOT fetch /codes for direct top-up!");
        }
        return jsonResponse({
          order: {
            id: "c1-uuid-async-1",
            reference_code: "CO-ORD-20261119-ASYNC1",
            status: "completed",
            total_sale_amount: "0.9500",
            currency: "USD",
            items: [
              {
                id: "l1",
                quantity: 1,
                delivered_count: 0,
                status: "completed",
                unit_sale_price: "0.9500",
              },
            ],
          },
        });
      });
      globalThis.fetch = fetchMock as typeof fetch;

      // Official Central One v1 webhook omits order.id UUID and only sends reference_code + idempotency_key
      const ts = Math.floor(Date.now() / 1000);
      const rawBody = JSON.stringify({
        event: "order.completed",
        order: {
          reference_code: "CO-ORD-20261119-ASYNC1",
          idempotency_key: "sc-item-async-1",
          status: "completed",
        },
      });
      const sig = signWebhookPayload("whsec_centralone_topup", ts, rawBody);
      const req = new NextRequest(
        "https://storycheap.com/api/webhooks/centralone",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CentralOne-Event": "order.completed",
            "X-CentralOne-Event-Id": "evt-topup-async-1",
            "X-CentralOne-Timestamp": String(ts),
            "X-CentralOne-Signature": sig,
          },
          body: rawBody,
        }
      );

      const res = await centralOneWebhookPost(req);
      expect(res.status).toBe(200);

      await vi.waitFor(() => {
        expect(mockRepo.getSupplierOrderByIdentifier).toHaveBeenCalledWith(
          ["centralone", "fazercards"],
          expect.objectContaining({
            referenceCode: "CO-ORD-20261119-ASYNC1",
            idempotencyKey: "sc-item-async-1",
          })
        );
        expect(mockRepo.transitionOrderStatus).toHaveBeenCalledWith(
          expect.objectContaining({
            orderId,
            nextStatus: "DELIVERED",
          })
        );
        expect(mockRepo.updateOrderItemTargetStatus).toHaveBeenCalledWith(
          orderId,
          orderItemId,
          expect.objectContaining({ topupStatus: "completed" })
        );
      });
    });

    it("moves failed direct top-up (with auto-refund) to MANUAL_REVIEW instead of DELIVERED", async () => {
      const orderId = "ord-fail-topup-1";
      const orderItemId = "item-fail-topup-1";

      mockRepo.getOrderById.mockResolvedValue({
        id: orderId,
        orderNumber: "SC-202611-FAIL1",
        userId: "user-1",
        email: "gamer@example.com",
        status: "PAID",
        subtotalCents: 200,
        creditAppliedCents: 0,
        amountDueCents: 200,
        paidCents: 200,
        currency: "USD",
        paymentGateway: "zenobank",
        gatewayCheckoutId: "zbk_fail_1",
        gatewayCheckoutUrl: null,
        needsAttention: false,
        attentionReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: orderItemId,
            variantId: "var-ff-topup",
            productName: "Free Fire Recarga ID",
            productSlug: "free-fire",
            denominationLabel: "100 Diamantes",
            region: "Latam",
            quantity: 1,
            unitPriceCents: 200,
            unitCostCents: 95,
            deliveredCount: 0,
            status: "PENDING",
            targetInfo: {
              payload: { player_id: "0000000" },
              displaySummary: "ID de jugador: 0000000",
              playerName: null,
              validationStatus: "unverified" as const,
              supplierReferenceCode: null,
              topupStatus: "pending" as const,
              topupFailureReason: null,
            },
          },
        ],
        fulfillments: [],
      });
      mockRepo.transitionOrderStatus.mockResolvedValue(true);
      mockRepo.getProviderConfig.mockImplementation(async (provider: string) => ({
        provider,
        enabled: provider === "centralone",
        sandbox: false,
        config: {},
      }));
      mockRepo.getVariantsLookupByIds.mockResolvedValue(
        new Map([
          [
            "var-ff-topup",
            {
              product: {
                id: "p1",
                slug: "free-fire",
                name: "Free Fire Recarga ID",
                active: true,
              },
              variant: {
                id: "var-ff-topup",
                productId: "p1",
                region: "Latam",
                denominationLabel: "100 Diamantes",
                faceValueCents: 100,
                salePriceCents: 200,
                unitCostCents: 95,
                currency: "USD",
                active: true,
                sourcePriority: "centralone_only",
                reloadlyProductId: null,
                centraloneProductId: "cat-ff-100-id",
                lowStockThreshold: 1,
                availableStock: 0,
                supplierStock: 99,
                deliverableStock: 99,
                inStock: true,
                requiresTarget: true,
                targetFields: ["player_id"],
                targetSchema: [],
                supportsPlayerValidate: false,
              },
            },
          ],
        ])
      );

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("/catalog")) {
          return jsonResponse({ items: [] });
        }
        if (String(url).includes("/orders")) {
          return jsonResponse(
            {
              order: {
                id: "c1-fail-uuid-1",
                reference_code: "CO-TOPUP-FAIL-1",
                status: "failed",
                total_sale_amount: "0.9500",
                currency: "USD",
                refund: { refunded: true, scope: "full", amount: "0.9500" },
                failure: {
                  code: "invalid_player",
                  message: "Account not found on target game server",
                  action: "check_target_payload",
                },
              },
            },
            201
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as typeof fetch;

      await fulfillOrder(orderId);

      expect(mockRepo.transitionOrderStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId,
          nextStatus: "MANUAL_REVIEW",
          needsAttention: true,
          attentionReason: expect.stringContaining(
            "Saldo liberado automáticamente en Central One"
          ),
        })
      );
      expect(mockRepo.updateOrderItemTargetStatus).toHaveBeenCalledWith(
        orderId,
        orderItemId,
        expect.objectContaining({
          topupStatus: "failed",
          topupFailureReason: "Account not found on target game server",
        })
      );
    });
  });
});
