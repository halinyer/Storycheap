import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCentralOneBalance, mockGetFazerCardsBalance } = vi.hoisted(() => ({
  mockGetCentralOneBalance: vi.fn(),
  mockGetFazerCardsBalance: vi.fn(),
}));

vi.mock("@/lib/server/suppliers/centralone", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/suppliers/centralone")>();
  return {
    ...actual,
    getCentralOneBalance: mockGetCentralOneBalance,
  };
});

vi.mock("@/lib/server/suppliers/fazercards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/suppliers/fazercards")>();
  return {
    ...actual,
    getFazerCardsBalance: mockGetFazerCardsBalance,
  };
});

import { initiateCheckout } from "@/lib/server/checkout-service";
import { validateAndPriceCart } from "@/lib/server/pricing";
import { saveVariantPricingMeta, updateProviderConfig } from "@/lib/server/repository";
import { getSandboxState, resetSandboxStateForTests } from "@/lib/server/sandbox-db";
import type { SessionUser } from "@/types";

const NINTENDO_5_VARIANT_ID = "20000000-0000-4000-8000-000000000200";
const NINTENDO_10_VARIANT_ID = "20000000-0000-4000-8000-000000000201";

const CUSTOMER_SESSION: SessionUser = {
  id: "00000000-0000-4000-8000-00000000c001",
  email: "carlos@storycheap.com",
  role: "customer",
  aal: "aal1",
  isSandbox: true,
};

describe("Distributor-specific balance validation in checkout & pricing", () => {
  beforeEach(async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ZENOBANK_API_KEY;
    process.env.ENABLE_DEMO_SANDBOX = "true";
    resetSandboxStateForTests();
    getSandboxState().inventory = [];

    mockGetCentralOneBalance.mockReset();
    mockGetFazerCardsBalance.mockReset();

    await saveVariantPricingMeta(NINTENDO_5_VARIANT_ID, { exactCostUsd: "4.6070" });
    await saveVariantPricingMeta(NINTENDO_10_VARIANT_ID, { exactCostUsd: "8.6430" });
  });

  it("checks FazerCards balance ($10.00) rather than Central One ($1.00) for Nintendo US fazer SKU", async () => {
    mockGetCentralOneBalance.mockResolvedValue({
      configured: true,
      sandbox: false,
      balanceCents: 100, // Only $1.00 on Central One
      currency: "USD",
      healthy: true,
    });
    mockGetFazerCardsBalance.mockResolvedValue({
      configured: true,
      sandbox: false,
      balanceCents: 1000, // $10.00 on FazerCards
      currency: "USD",
      healthy: true,
    });

    // Even if Central One is completely disabled, FazerCards variants proceed
    await updateProviderConfig("centralone", { enabled: false }, null);

    const validated = await validateAndPriceCart([
      { variantId: NINTENDO_10_VARIANT_ID, quantity: 1 },
    ]);
    expect(validated.subtotalCents).toBe(865);
    expect(mockGetFazerCardsBalance).toHaveBeenCalledTimes(1);
    expect(mockGetCentralOneBalance).not.toHaveBeenCalled();

    const checkout = await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: NINTENDO_10_VARIANT_ID, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });
    expect(checkout.order.subtotalCents).toBe(865);
    expect(checkout.order.status).toBe("PENDING_PAYMENT");
  });

  it("rejects exceeding FazerCards balance and never uses FazerCards balance for Central One SKUs", async () => {
    mockGetCentralOneBalance.mockResolvedValue({
      configured: true,
      sandbox: false,
      balanceCents: 100, // $1.00 on Central One
      currency: "USD",
      healthy: true,
    });
    mockGetFazerCardsBalance.mockResolvedValue({
      configured: true,
      sandbox: false,
      balanceCents: 1000, // $10.00 on FazerCards
      currency: "USD",
      healthy: true,
    });

    // 2 x Nintendo $10 = $17.2860 > $10.00 FazerCards balance -> only 1 available
    await expect(
      validateAndPriceCart([{ variantId: NINTENDO_10_VARIANT_ID, quantity: 2 }])
    ).rejects.toThrow("Disponibles: 1");

    // 2 x Nintendo $5 = $9.2140 <= $10.00 -> succeeds
    const twoFives = await validateAndPriceCart([
      { variantId: NINTENDO_5_VARIANT_ID, quantity: 2 },
    ]);
    expect(twoFives.subtotalCents).toBe(922);

    // Now test a non-Fazer Central One SKU costing $9.00: must fail against Central One ($1.00), NOT pass against FazerCards ($10.00)
    const state = getSandboxState();
    const psnProd = state.products[0];
    const c1Variant = psnProd.variants[0];
    c1Variant.sourcePriority = "centralone_only";
    c1Variant.centraloneProductId = "c1-uuid-psn-10";
    c1Variant.unitCostCents = 900;

    await expect(
      validateAndPriceCart([{ variantId: c1Variant.id, quantity: 1 }])
    ).rejects.toThrow("Disponibles: 0");
    expect(mockGetCentralOneBalance).toHaveBeenCalledTimes(1);
  });
});
