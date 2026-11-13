import { beforeEach, describe, expect, it } from "vitest";
import { initiateCheckout } from "@/lib/server/checkout-service";
import {
  getOrderById,
  listCatalog,
  setBsRateCents,
  updateVariantAdmin,
} from "@/lib/server/repository";
import {
  computePeriodSales,
  getOrderSnapshot,
} from "@/lib/server/sales-metrics";
import { getSandboxState } from "@/lib/server/sandbox-db";

describe("Sales snapshot (Bs rate + code cost) and period metrics", () => {
  beforeEach(() => {
    delete globalThis.__storycheapSandboxState;
    process.env.ENABLE_DEMO_SANDBOX = "true";
    delete process.env.ZENOBANK_API_KEY;
  });

  it("freezes the current Bs rate and unit cost on each order and keeps history immutable", async () => {
    const catalog = await listCatalog(false);
    const variant = catalog[0].variants[0];

    await setBsRateCents(5435); // Bs 54.35 / $1
    await updateVariantAdmin(variant.id, { unitCostCents: 920 }); // $9.20 cost

    const { order } = await initiateCheckout({
      email: "buyer.snapshot@storycheap.com",
      items: [{ variantId: variant.id, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: null,
      ipAddress: "127.0.0.1",
    });

    const expectedBs = Math.round((variant.salePriceCents * 5435) / 100);
    expect(order.bsRateCents).toBe(5435);
    expect(order.totalBsCents).toBe(expectedBs);
    expect(order.items[0].unitCostCents).toBe(920);

    // Mutate rate and cost later; historical order snapshot must stay frozen
    await setBsRateCents(6200);
    await updateVariantAdmin(variant.id, { unitCostCents: 990 });

    const reloaded = await getOrderById(order.id);
    expect(reloaded?.bsRateCents).toBe(5435);
    expect(reloaded?.totalBsCents).toBe(expectedBs);
    expect(reloaded?.items[0].unitCostCents).toBe(920);

    const snap = getOrderSnapshot(reloaded!);
    expect(snap.profitCents).toBe(variant.salePriceCents - 920);
  });

  it("computes Hoy / 7 días / Este mes only from settled sales", async () => {
    const state = getSandboxState();
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

    state.orders.push(
      {
        id: "00000000-0000-4000-8000-000000000011",
        orderNumber: "SC-TEST-01",
        userId: null,
        email: "a@test.com",
        status: "DELIVERED",
        subtotalCents: 1050,
        creditAppliedCents: 0,
        amountDueCents: 1050,
        paidCents: 1050,
        bsRateCents: 5400,
        totalBsCents: 56700,
        paymentGateway: "zenobank",
        gatewayCheckoutId: null,
        gatewayCheckoutUrl: null,
        expiresAt: null,
        needsAttention: false,
        attentionReason: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        items: [
          {
            id: "i1",
            orderId: "00000000-0000-4000-8000-000000000011",
            variantId: "v1",
            productName: "PSN",
            productSlug: "psn",
            denominationLabel: "$10",
            region: "USA",
            unitPriceCents: 1050,
            unitCostCents: 920,
            quantity: 1,
            deliveredCount: 1,
            status: "FULFILLED",
          },
        ],
        fulfillments: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        orderNumber: "SC-TEST-02",
        userId: null,
        email: "b@test.com",
        status: "PENDING_PAYMENT",
        subtotalCents: 5000,
        creditAppliedCents: 0,
        amountDueCents: 5000,
        paidCents: 0,
        bsRateCents: 5400,
        totalBsCents: 270000,
        paymentGateway: "zenobank",
        gatewayCheckoutId: null,
        gatewayCheckoutUrl: null,
        expiresAt: null,
        needsAttention: false,
        attentionReason: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        items: [],
        fulfillments: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000013",
        orderNumber: "SC-TEST-03",
        userId: null,
        email: "c@test.com",
        status: "DELIVERED",
        subtotalCents: 2620,
        creditAppliedCents: 0,
        amountDueCents: 2620,
        paidCents: 2620,
        bsRateCents: 5000,
        totalBsCents: 131000,
        paymentGateway: "zenobank",
        gatewayCheckoutId: null,
        gatewayCheckoutUrl: null,
        expiresAt: null,
        needsAttention: false,
        attentionReason: null,
        createdAt: tenDaysAgo,
        updatedAt: tenDaysAgo,
        items: [
          {
            id: "i3",
            orderId: "00000000-0000-4000-8000-000000000013",
            variantId: "v3",
            productName: "PSN",
            productSlug: "psn",
            denominationLabel: "$25",
            region: "USA",
            unitPriceCents: 2620,
            unitCostCents: 2300,
            quantity: 1,
            deliveredCount: 1,
            status: "FULFILLED",
          },
        ],
        fulfillments: [],
      }
    );

    const [today, week] = computePeriodSales(state.orders, now);
    expect(today.ordersCount).toBe(1);
    expect(today.revenueCents).toBe(1050);
    expect(today.costCents).toBe(920);
    expect(today.profitCents).toBe(130);
    expect(today.totalBsCents).toBe(56700);
    expect(week.ordersCount).toBe(1);
  });
});
