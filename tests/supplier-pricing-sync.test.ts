import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateSupplierPriceChange,
  parseUsdToTenthsOfCent,
} from "@/lib/supplier-pricing-policy";
import type { SupplierPricingPolicy } from "@/types";

const fazerOffersMock = vi.fn();
const createFazerOrderMock = vi.fn();
const fazerBalanceMock = vi.fn();

vi.mock("@/lib/server/env", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/env")>(
    "@/lib/server/env"
  );
  return {
    ...actual,
    isFazerCardsConfigured: () => true,
  };
});

vi.mock("@/lib/server/suppliers/fazercards", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/server/suppliers/fazercards")>(
      "@/lib/server/suppliers/fazercards"
    );
  return {
    ...actual,
    getFazerCardsCategoryOffers: (...args: Parameters<typeof actual.getFazerCardsCategoryOffers>) =>
      fazerOffersMock(...args),
    createFazerCardsGiftCardOrder: (
      ...args: Parameters<typeof actual.createFazerCardsGiftCardOrder>
    ) => createFazerOrderMock(...args),
    getFazerCardsBalance: () => fazerBalanceMock(),
  };
});

import { initiateCheckout } from "@/lib/server/checkout-service";
import { processVerifiedWebhookEvent } from "@/lib/server/fulfillment";
import { setSandboxZenoCheckout } from "@/lib/server/payments/zenobank";
import { CheckoutValidationError, validateAndPriceCart } from "@/lib/server/pricing";
import {
  getOrderById,
  getVariantPricingMetaMap,
  getVariantsLookupByIds,
  saveSupplierPricingPolicy,
  updateProviderConfig,
  updateVariantAdmin,
} from "@/lib/server/repository";
import { resetSandboxStateForTests } from "@/lib/server/sandbox-db";
import { invalidateSupplierQuoteCache } from "@/lib/server/supplier-sync";

const PSN_10_VARIANT_ID = "20000000-0000-4000-8000-000000000101";

const DEFAULT_POLICY: SupplierPricingPolicy = {
  mode: "protect_floor",
  minMarginPct: 1,
  minMarginUsdCents: 1,
  autoSyncIntervalMinutes: 5,
};

describe("evaluateSupplierPriceChange (4-decimal precision & policies)", () => {
  it("keeps positive razor-thin 4-decimal margins untouched under protect_floor", () => {
    expect(parseUsdToTenthsOfCent("17.2860")).toBe(172860);
    const evalRes = evaluateSupplierPriceChange({
      currentSaleCents: 1729,
      oldExactCostUsd: "17.2500",
      oldUnitCostCents: 1725,
      liveCostRaw: "17.2860",
      policy: DEFAULT_POLICY,
    });

    expect(evalRes.valid).toBe(true);
    expect(evalRes.costChanged).toBe(true);
    expect(evalRes.nextExactCostUsd).toBe("17.2860");
    expect(evalRes.nextUnitCostCents).toBe(1729);
    expect(evalRes.breachedOldSalePrice).toBe(false);
    expect(evalRes.salePriceChanged).toBe(false);
    expect(evalRes.nextSalePriceCents).toBe(1729);
    expect(evalRes.belowCostFloor).toBe(false);
  });

  it("auto-bumps sale price safely when live wholesale cost reaches or exceeds current PVP", () => {
    const evalRes = evaluateSupplierPriceChange({
      currentSaleCents: 1729,
      oldExactCostUsd: "17.2860",
      oldUnitCostCents: 1729,
      liveCostRaw: "17.3000",
      policy: DEFAULT_POLICY,
    });

    expect(evalRes.breachedOldSalePrice).toBe(true);
    expect(evalRes.salePriceChanged).toBe(true);
    expect(evalRes.nextSalePriceCents).toBeGreaterThanOrEqual(1748);
    expect(evalRes.belowCostFloor).toBe(false);
  });

  it("keeps markup percentage on cost increase and never lowers sale price when wholesale drops", () => {
    const keepMarginPolicy: SupplierPricingPolicy = {
      ...DEFAULT_POLICY,
      mode: "keep_margin_on_increase",
    };

    const up = evaluateSupplierPriceChange({
      currentSaleCents: 1200,
      oldExactCostUsd: "10.0000",
      oldUnitCostCents: 1000,
      liveCostRaw: "11.0000",
      policy: keepMarginPolicy,
    });
    expect(up.salePriceChanged).toBe(true);
    expect(up.nextSalePriceCents).toBe(1320);

    const down = evaluateSupplierPriceChange({
      currentSaleCents: 1200,
      oldExactCostUsd: "10.0000",
      oldUnitCostCents: 1000,
      liveCostRaw: "9.2000",
      policy: keepMarginPolicy,
    });
    expect(down.costChanged).toBe(true);
    expect(down.nextUnitCostCents).toBe(920);
    expect(down.salePriceChanged).toBe(false);
    expect(down.nextSalePriceCents).toBe(1200);
  });

  it("flags belowCostFloor without auto-editing PVP in cost_only_block mode", () => {
    const res = evaluateSupplierPriceChange({
      currentSaleCents: 914,
      oldExactCostUsd: "9.1000",
      oldUnitCostCents: 910,
      liveCostRaw: "9.5000",
      policy: { ...DEFAULT_POLICY, mode: "cost_only_block" },
    });

    expect(res.costChanged).toBe(true);
    expect(res.nextUnitCostCents).toBe(950);
    expect(res.salePriceChanged).toBe(false);
    expect(res.nextSalePriceCents).toBe(914);
    expect(res.belowCostFloor).toBe(true);
  });
});

describe("Live supplier quote protection in checkout & fulfillment", () => {
  beforeEach(async () => {
    resetSandboxStateForTests();
    invalidateSupplierQuoteCache();
    fazerOffersMock.mockReset();
    createFazerOrderMock.mockReset();
    fazerBalanceMock.mockReset();

    await updateProviderConfig("fazercards", { enabled: true }, null);
    await saveSupplierPricingPolicy(DEFAULT_POLICY);
    await updateVariantAdmin(PSN_10_VARIANT_ID, {
      sourcePriority: "centralone_only",
      centraloneProductId: "fazer:12:99",
      unitCostCents: 910,
      salePriceCents: 914,
    });

    fazerBalanceMock.mockResolvedValue({
      healthy: true,
      balanceCents: 50000,
      raw: {},
      errorMessage: null,
    });
  });

  it("syncs wholesale price hike at checkout, rejects stale cart with PRICE_UPDATED, and accepts refreshed price", async () => {
    fazerOffersMock.mockResolvedValue({
      categoryId: "12",
      name: "PlayStation US",
      offers: [
        {
          card_id: "99",
          name: "10 USD",
          price_usd: "9.5000",
          stock: 10,
        },
      ],
    });

    await expect(
      validateAndPriceCart([{ variantId: PSN_10_VARIANT_ID, quantity: 1 }])
    ).rejects.toMatchObject({
      code: "PRICE_UPDATED",
      statusCode: 409,
    });

    const lookupAfter = await getVariantsLookupByIds([PSN_10_VARIANT_ID]);
    const refreshedVariant = lookupAfter.get(PSN_10_VARIANT_ID)!.variant;
    expect(refreshedVariant.unitCostCents).toBe(950);
    expect(refreshedVariant.salePriceCents).toBeGreaterThanOrEqual(960);

    const meta = await getVariantPricingMetaMap();
    expect(meta[PSN_10_VARIANT_ID]?.exactCostUsd).toBe("9.5000");

    // Stale expectedUnitPriceCents from client localStorage still rejected
    await expect(
      validateAndPriceCart([
        {
          variantId: PSN_10_VARIANT_ID,
          quantity: 1,
          expectedUnitPriceCents: 914,
        },
      ])
    ).rejects.toBeInstanceOf(CheckoutValidationError);

    // Matching updated cart proceeds and records exact live wholesale cost
    const validRes = await validateAndPriceCart([
      {
        variantId: PSN_10_VARIANT_ID,
        quantity: 1,
        expectedUnitPriceCents: refreshedVariant.salePriceCents,
      },
    ]);
    expect(validRes.validatedLines[0]?.variant.unitCostCents).toBe(950);
  });

  it("blocks distributor purchase in fulfillOrder with MANUAL_REVIEW if cost spikes above paid price after payment", async () => {
    // At checkout time cost is safe ($9.0500 < $9.14 paid)
    fazerOffersMock.mockResolvedValueOnce({
      categoryId: "12",
      name: "PlayStation US",
      offers: [
        {
          card_id: "99",
          name: "10 USD",
          price_usd: "9.0500",
          stock: 10,
        },
      ],
    });

    const checkout = await initiateCheckout({
      email: "carlos@storycheap.com",
      items: [
        {
          variantId: PSN_10_VARIANT_ID,
          quantity: 1,
          expectedUnitPriceCents: 914,
        },
      ],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: {
        id: "00000000-0000-4000-8000-00000000c001",
        email: "carlos@storycheap.com",
        role: "customer",
        aal: "aal1",
        isSandbox: true,
      },
      ipAddress: "127.0.0.1",
    });

    const checkoutId = checkout.order.gatewayCheckoutId!;
    setSandboxZenoCheckout({
      id: checkoutId,
      orderId: checkout.order.id,
      priceCurrency: "USD",
      priceAmount: "9.14",
      paidAmount: "9.14",
      status: "COMPLETED",
      expiresAt: checkout.order.expiresAt,
      checkoutUrl: checkout.checkoutUrl,
      createdAt: checkout.order.createdAt,
      successRedirectUrl: null,
    });

    // Clear 45s quote cache and spike FazerCards cost to $9.5000 BEFORE webhook triggers fulfillment!
    invalidateSupplierQuoteCache();
    fazerOffersMock.mockResolvedValueOnce({
      categoryId: "12",
      name: "PlayStation US",
      offers: [
        {
          card_id: "99",
          name: "10 USD",
          price_usd: "9.5000",
          stock: 10,
        },
      ],
    });

    const webhookRes = await processVerifiedWebhookEvent({
      gateway: "zenobank",
      eventId: "evt_price_spike_1",
      eventType: "checkout.completed",
      orderId: checkout.order.id,
      checkoutId,
      priceCents: 914,
      paidCents: 914,
      status: "COMPLETED",
      rawPayload: {},
    });
    expect(webhookRes.outcome).toBe("delivered_or_fulfilling");
    expect(createFazerOrderMock).not.toHaveBeenCalled();

    const latestOrder = await getOrderById(checkout.order.id);
    expect(latestOrder?.status).toBe("MANUAL_REVIEW");
    expect(latestOrder?.needsAttention).toBe(true);
    expect(latestOrder?.attentionReason).toContain("anti-pérdida");
    expect(latestOrder?.fulfillments).toHaveLength(0);
  });
});
