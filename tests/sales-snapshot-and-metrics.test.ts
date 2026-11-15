import { describe, expect, it } from "vitest";
import {
  extractZenoStoreIdFromPayload,
  extractZenoTransactionsFromPayload,
} from "@/lib/server/payments/zenobank";
import {
  getOrderSnapshot,
  resolveFulfillmentProvider,
} from "@/lib/server/sales-metrics";
import type { OrderDTO } from "@/types";

function makeOrder(overrides: Partial<OrderDTO> = {}): OrderDTO {
  return {
    id: "ord-1",
    orderNumber: "SC-202611-TEST01",
    userId: "usr-1",
    email: "buyer@example.com",
    status: "DELIVERED",
    subtotalCents: 1545,
    creditAppliedCents: 0,
    amountDueCents: 1545,
    paidCents: 1545,
    paymentGateway: "zenobank",
    gatewayCheckoutId: "chk_123",
    gatewayCheckoutUrl: "https://pay.zenobank.io/chk_123",
    totalBsCents: 1648778,
    bsRateCents: 106717,
    needsAttention: false,
    attentionReason: null,
    createdAt: "2026-11-14T12:00:00.000Z",
    updatedAt: "2026-11-14T12:01:00.000Z",
    expiresAt: "2026-11-14T13:00:00.000Z",
    items: [
      {
        id: "item-netflix",
        orderId: "ord-1",
        variantId: "var-netflix-15",
        productName: "Netflix Gift Card",
        productSlug: "netflix-gift-card",
        denominationLabel: "$15 USD",
        region: "US",
        quantity: 1,
        unitPriceCents: 1545,
        unitCostCents: 1500, // Stale catalog snapshot cost before FazerCards execution
        deliveredCount: 1,
        status: "FULFILLED",
      },
    ],
    fulfillments: [
      {
        id: "ful-1",
        orderItemId: "item-netflix",
        orderId: "ord-1",
        source: "centralone", // Legacy DB constraint value
        codeLast4: "ABCD",
        supplierTxId: "fazer:ord-3231260",
        revealedAt: null,
        createdAt: "2026-11-14T12:00:30.000Z",
        productName: "Netflix Gift Card",
        denominationLabel: "$15 USD",
        region: "US",
      },
    ],
    ...overrides,
  };
}

describe("resolveFulfillmentProvider", () => {
  it("classifies fazer:* supplier transactions as fazercards even when source column is centralone", () => {
    expect(
      resolveFulfillmentProvider({
        source: "centralone",
        supplierTxId: "fazer:ord-3231260",
      })
    ).toBe("fazercards");

    expect(
      resolveFulfillmentProvider({
        source: "centralone",
        supplierTxId: "6b7df63b-d9ba-473f-9d9d-4d6f8b814fb9",
      })
    ).toBe("centralone");

    expect(
      resolveFulfillmentProvider({
        source: "manual",
        supplierTxId: null,
      })
    ).toBe("manual");
  });
});

describe("getOrderSnapshot", () => {
  it("applies actual supplier item cost overrides and excludes ZenoBank from Bs cash totals", () => {
    const zenoOrder = makeOrder();
    const snap = getOrderSnapshot(zenoOrder, { "item-netflix": 1460 });

    expect(snap.isSettledSale).toBe(true);
    expect(snap.revenueCents).toBe(1545);
    expect(snap.costCents).toBe(1460);
    expect(snap.profitCents).toBe(85);
    expect(snap.totalBsCents).toBe(1648778);
    expect(snap.actualBsCents).toBeNull();
  });

  it("retains actualBsCents on Pago Movil and Pabilo orders", () => {
    const pmOrder = makeOrder({
      id: "ord-pm",
      paymentGateway: "pagomovil",
      subtotalCents: 72,
      amountDueCents: 72,
      paidCents: 72,
      totalBsCents: 76836,
      items: [
        {
          id: "item-ff",
          orderId: "ord-pm",
          variantId: "var-ff",
          productName: "Free Fire",
          productSlug: "free-fire",
          denominationLabel: "100 + 10",
          region: "Global",
          quantity: 1,
          unitPriceCents: 72,
          unitCostCents: 69,
          deliveredCount: 1,
          status: "FULFILLED",
        },
      ],
    });
    const snap = getOrderSnapshot(pmOrder, { "item-ff": 69 });
    expect(snap.actualBsCents).toBe(76836);
    expect(snap.profitCents).toBe(3);
  });
});

describe("ZenoBank webhook payload extraction", () => {
  it("extracts destination Binance Pay ID and storeId from webhook payload", () => {
    const samplePayload = {
      type: "checkout.completed",
      data: {
        id: "chk_123",
        storeId: "store_u8JsmTbXRxP9TtWPBxeJHxxo",
        transactions: [
          {
            uid: "tx_1",
            transactionId: "P_A25N12345",
            networkId: "BINANCE_PAY",
            tokenId: "USDT_BINANCE_PAY",
            tokenAmount: "15.45",
            to: "167545790",
            from: "buyer_uid",
            fromLabel: "Buyer",
            createdAt: "2026-11-14T12:00:00.000Z",
          },
        ],
      },
    };

    expect(extractZenoStoreIdFromPayload(samplePayload)).toBe(
      "store_u8JsmTbXRxP9TtWPBxeJHxxo"
    );
    const txs = extractZenoTransactionsFromPayload(samplePayload);
    expect(txs).toHaveLength(1);
    expect(txs[0].to).toBe("167545790");
    expect(txs[0].transactionId).toBe("P_A25N12345");
  });
});

describe("FazerCards vs Central One provider separation", () => {
  it("keeps FazerCards and Central One costs, revenues, and counts strictly separated even with legacy centralone source rows", () => {
    const orders: OrderDTO[] = [
      makeOrder({
        id: "ord-fazer-netflix",
        orderNumber: "SC-202611-DA8B60",
        subtotalCents: 1545,
        amountDueCents: 1545,
        paidCents: 1545,
        paymentGateway: "zenobank",
        items: [
          {
            id: "item-fazer-netflix",
            orderId: "ord-fazer-netflix",
            variantId: "var-netflix-15",
            productName: "Netflix Gift Card",
            productSlug: "netflix-gift-card",
            denominationLabel: "$15 USD",
            region: "US",
            quantity: 1,
            unitPriceCents: 1545,
            unitCostCents: 1500,
            deliveredCount: 1,
            status: "FULFILLED",
          },
        ],
        fulfillments: [
          {
            id: "ful-fazer-netflix",
            orderItemId: "item-fazer-netflix",
            orderId: "ord-fazer-netflix",
            source: "centralone",
            codeLast4: "NET1",
            supplierTxId: "fazer:ord-3231260",
            revealedAt: null,
            createdAt: "2026-11-14T15:31:00.000Z",
            productName: "Netflix Gift Card",
            denominationLabel: "$15 USD",
            region: "US",
          },
        ],
      }),
      makeOrder({
        id: "ord-fazer-nintendo",
        orderNumber: "SC-202611-7C42BA",
        subtotalCents: 865,
        amountDueCents: 865,
        paidCents: 865,
        paymentGateway: "zenobank",
        items: [
          {
            id: "item-fazer-nintendo",
            orderId: "ord-fazer-nintendo",
            variantId: "var-nintendo-10",
            productName: "Nintendo eShop Gift Card",
            productSlug: "nintendo-eshop",
            denominationLabel: "$10 USD",
            region: "US",
            quantity: 1,
            unitPriceCents: 865,
            unitCostCents: 900,
            deliveredCount: 1,
            status: "FULFILLED",
          },
        ],
        fulfillments: [
          {
            id: "ful-fazer-nintendo",
            orderItemId: "item-fazer-nintendo",
            orderId: "ord-fazer-nintendo",
            source: "centralone",
            codeLast4: "NIN1",
            supplierTxId: "fazer:ord-3201061",
            revealedAt: null,
            createdAt: "2026-11-14T04:34:00.000Z",
            productName: "Nintendo eShop Gift Card",
            denominationLabel: "$10 USD",
            region: "US",
          },
        ],
      }),
      ...([
        {
          id: "ord-c1-1",
          orderNumber: "SC-202611-CBF9DA",
          gateway: "pagomovil" as const,
          tx: "6b7df63b-1ca8-4e57-ace7-c46d8865ea09",
        },
        {
          id: "ord-c1-2",
          orderNumber: "SC-202611-4BB891",
          gateway: "zenobank" as const,
          tx: "a450ef1f-928d-45f1-ae79-c82a336573ad",
        },
        {
          id: "ord-c1-3",
          orderNumber: "SC-202611-9B1E57",
          gateway: "zenobank" as const,
          tx: "971c2c4b-2d40-4e56-9964-b0fe2042a31b",
        },
      ] as const).map((row, idx) =>
        makeOrder({
          id: row.id,
          orderNumber: row.orderNumber,
          subtotalCents: 72,
          amountDueCents: 72,
          paidCents: 72,
          paymentGateway: row.gateway,
          items: [
            {
              id: `item-c1-${idx + 1}`,
              orderId: row.id,
              variantId: "var-ff-110",
              productName: "Free Fire 110 Diamantes",
              productSlug: "free-fire",
              denominationLabel: "110 Diamantes",
              region: "LATAM",
              quantity: 1,
              unitPriceCents: 72,
              unitCostCents: 69,
              deliveredCount: 1,
              status: "FULFILLED",
            },
          ],
          fulfillments: [
            {
              id: `ful-c1-${idx + 1}`,
              orderItemId: `item-c1-${idx + 1}`,
              orderId: row.id,
              source: "centralone",
              codeLast4: `FF0${idx + 1}`,
              supplierTxId: row.tx,
              revealedAt: null,
              createdAt: "2026-11-14T14:45:00.000Z",
              productName: "Free Fire 110 Diamantes",
              denominationLabel: "110 Diamantes",
              region: "LATAM",
            },
          ],
        })
      ),
    ];

    const actualItemCostCents: Record<string, number> = {
      "item-fazer-netflix": 1460,
      "item-fazer-nintendo": 864,
      "item-c1-1": 69,
      "item-c1-2": 69,
      "item-c1-3": 69,
    };

    const byProvider: Record<
      string,
      { orders: number; revenueCents: number; costCents: number; profitCents: number }
    > = {
      fazercards: { orders: 0, revenueCents: 0, costCents: 0, profitCents: 0 },
      centralone: { orders: 0, revenueCents: 0, costCents: 0, profitCents: 0 },
    };

    for (const order of orders) {
      const providers = new Set(order.fulfillments.map((f) => resolveFulfillmentProvider(f)));
      expect(providers.size).toBe(1);
      const provider = [...providers][0];
      const snap = getOrderSnapshot(order, actualItemCostCents);
      expect(snap.isSettledSale).toBe(true);
      expect(snap.costCents).not.toBeNull();
      expect(snap.profitCents).not.toBeNull();
      if (provider === "fazercards" || provider === "centralone") {
        byProvider[provider].orders += 1;
        byProvider[provider].revenueCents += snap.revenueCents;
        byProvider[provider].costCents += snap.costCents ?? 0;
        byProvider[provider].profitCents += snap.profitCents ?? 0;
      }
    }

    expect(byProvider.fazercards).toEqual({
      orders: 2,
      revenueCents: 2410,
      costCents: 2324,
      profitCents: 86,
    });
    expect(byProvider.centralone).toEqual({
      orders: 3,
      revenueCents: 216,
      costCents: 207,
      profitCents: 9,
    });
  });
});
