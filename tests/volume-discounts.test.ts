import { beforeEach, describe, expect, it } from "vitest";
import { formatBsFromUsdCents, usdCentsToBsCents } from "@/lib/currency";
import {
  computeCartTotals,
  normalizeVolumeDiscountTiers,
  resolveVolumeTierPrice,
  validateVolumeDiscountTiersForAdmin,
} from "@/lib/volume-discounts";
import { initiateCheckout } from "@/lib/server/checkout-service";
import { CheckoutValidationError, validateAndPriceCart } from "@/lib/server/pricing";
import {
  listCatalog,
  saveVariantPricingMeta,
  setBsRateCents,
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

describe("Volume Discounts & Dual Currency Helpers", () => {
  beforeEach(() => {
    resetSandboxStateForTests();
  });

  it("normalizes tiers, deduplicates quantities, and drops invalid entries", () => {
    const normalized = normalizeVolumeDiscountTiers(
      [
        { minQuantity: 5, unitPriceCents: 990 },
        { minQuantity: 3, unitPriceCents: 1020 },
        { minQuantity: 3, unitPriceCents: 1010 }, // latest wins
        { minQuantity: 1, unitPriceCents: 900 }, // below 2 dropped
        { minQuantity: 11, unitPriceCents: 900 }, // above 10 dropped
        { minQuantity: 4, unitPriceCents: 1050 }, // equal to base dropped
      ],
      1050
    );

    expect(normalized).toEqual([
      { minQuantity: 3, unitPriceCents: 1010 },
      { minQuantity: 5, unitPriceCents: 990 },
    ]);
  });

  it("blocks loss-making, duplicate, or non-decreasing tiers in admin validation", () => {
    const belowCost = validateVolumeDiscountTiersForAdmin({
      tiers: [{ minQuantity: 3, unitPriceCents: 940 }],
      baseUnitPriceCents: 1050,
      unitCostCents: 960,
    });
    expect(belowCost.ok).toBe(false);

    const nonDecreasing = validateVolumeDiscountTiersForAdmin({
      tiers: [
        { minQuantity: 3, unitPriceCents: 1000 },
        { minQuantity: 5, unitPriceCents: 1010 },
      ],
      baseUnitPriceCents: 1050,
      unitCostCents: 950,
    });
    expect(nonDecreasing.ok).toBe(false);

    const valid = validateVolumeDiscountTiersForAdmin({
      tiers: [
        { minQuantity: 5, unitPriceCents: 990 },
        { minQuantity: 3, unitPriceCents: 1020 },
      ],
      baseUnitPriceCents: 1050,
      unitCostCents: 950,
    });
    expect(valid).toEqual({
      ok: true,
      tiers: [
        { minQuantity: 3, unitPriceCents: 1020 },
        { minQuantity: 5, unitPriceCents: 990 },
      ],
    });
  });

  it("resolves applied tier, next tier, savings, and cart totals accurately", () => {
    const tiers = [
      { minQuantity: 3, unitPriceCents: 1020 },
      { minQuantity: 5, unitPriceCents: 990 },
    ];

    const qty2 = resolveVolumeTierPrice({
      baseUnitPriceCents: 1050,
      quantity: 2,
      volumeDiscounts: tiers,
    });
    expect(qty2.appliedTier).toBeNull();
    expect(qty2.nextTier).toEqual({ minQuantity: 3, unitPriceCents: 1020 });
    expect(qty2.effectiveUnitPriceCents).toBe(1050);
    expect(qty2.lineTotalCents).toBe(2100);
    expect(qty2.lineSavingsCents).toBe(0);

    const qty4 = resolveVolumeTierPrice({
      baseUnitPriceCents: 1050,
      quantity: 4,
      volumeDiscounts: tiers,
    });
    expect(qty4.appliedTier).toEqual({ minQuantity: 3, unitPriceCents: 1020 });
    expect(qty4.nextTier).toEqual({ minQuantity: 5, unitPriceCents: 990 });
    expect(qty4.effectiveUnitPriceCents).toBe(1020);
    expect(qty4.lineTotalCents).toBe(4080);
    expect(qty4.lineSavingsCents).toBe(120);

    const totals = computeCartTotals([
      {
        variantId: PSN_10_VARIANT_ID,
        productId: "p1",
        productSlug: "psn",
        productName: "PSN",
        brand: "PlayStation",
        region: "USA",
        imageUrl: "/cards/playstation.jpg",
        denominationLabel: "$10 USD",
        unitPriceCents: 1050,
        quantity: 5,
        volumeDiscounts: tiers,
      },
    ]);
    expect(totals.subtotalCents).toBe(4950);
    expect(totals.regularSubtotalCents).toBe(5250);
    expect(totals.totalSavingsCents).toBe(300);
  });

  it("formats Bs equivalents cleanly using shop rate", () => {
    expect(usdCentsToBsCents(1050, 40500)).toBe(425250); // $10.50 * 405.00 = Bs 4.252,50
    const formatted = formatBsFromUsdCents(1050, 40500);
    expect(formatted).toContain("Bs ");
    expect(formatted).toContain("4.252,50");
    expect(formatBsFromUsdCents(1050, null)).toBeNull();
  });
});

describe("Server Authoritative Tiered Pricing & Checkout", () => {
  beforeEach(() => {
    resetSandboxStateForTests();
  });

  it("hydrates volumeDiscounts in listCatalog and enforces tiered prices in checkout", async () => {
    await saveVariantPricingMeta(PSN_10_VARIANT_ID, {
      volumeDiscounts: [
        { minQuantity: 3, unitPriceCents: 1010 },
        { minQuantity: 5, unitPriceCents: 980 },
      ],
    });
    await setBsRateCents(40000); // 400.00 Bs/USD

    const catalog = await listCatalog(false);
    const variant = catalog
      .flatMap((p) => p.variants)
      .find((v) => v.id === PSN_10_VARIANT_ID);
    expect(variant?.volumeDiscounts).toEqual([
      { minQuantity: 3, unitPriceCents: 1010 },
      { minQuantity: 5, unitPriceCents: 980 },
    ]);

    // Stale client expecting base $10.50 on qty 3 gets rejected with PRICE_UPDATED (409)
    await expect(
      validateAndPriceCart([
        {
          variantId: PSN_10_VARIANT_ID,
          quantity: 3,
          expectedUnitPriceCents: 1050,
        },
      ])
    ).rejects.toMatchObject({
      code: "PRICE_UPDATED",
      statusCode: 409,
    });

    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [
        {
          variantId: PSN_10_VARIANT_ID,
          quantity: 3,
          expectedUnitPriceCents: 1010,
        },
      ],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    expect(checkout.order.subtotalCents).toBe(3030);
    expect(checkout.order.amountDueCents).toBe(3030);
    expect(checkout.order.totalBsCents).toBe(1212000); // $30.30 * 400.00 = Bs 12.120,00
    expect(checkout.order.items[0]?.unitPriceCents).toBe(1010);
  });

  it("ignores any volume tier that falls below current live unit cost", async () => {
    const state = getSandboxState();
    const psnVariant = state.products
      .flatMap((p) => p.variants)
      .find((v) => v.id === PSN_10_VARIANT_ID);
    if (!psnVariant) throw new Error("Missing sandbox variant");
    psnVariant.unitCostCents = 1025; // cost spiked above the $10.10 tier

    await saveVariantPricingMeta(PSN_10_VARIANT_ID, {
      volumeDiscounts: [{ minQuantity: 3, unitPriceCents: 1010 }],
    });

    const validated = await validateAndPriceCart([
      { variantId: PSN_10_VARIANT_ID, quantity: 3 },
    ]);
    expect(validated.subtotalCents).toBe(3150); // Falls back to safe base price $10.50 * 3
    expect(validated.validatedLines[0]?.effectiveUnitPriceCents).toBe(1050);
    expect(CheckoutValidationError).toBeDefined();
  });
});
