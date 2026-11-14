import { beforeEach, describe, expect, it } from "vitest";
import { initiateCheckout } from "@/lib/server/checkout-service";
import {
  deleteProductAdmin,
  deleteVariantAdmin,
  listCatalog,
  toggleVariantActiveAdmin,
} from "@/lib/server/repository";
import { resetSandboxStateForTests } from "@/lib/server/sandbox-db";
import type { SessionUser } from "@/types";

const CUSTOMER_SESSION: SessionUser = {
  id: "00000000-0000-4000-8000-00000000c001",
  email: "carlos@storycheap.com",
  role: "customer",
  aal: "aal1",
  isSandbox: true,
};

describe("Admin catalog visibility toggle & deletion", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.ENABLE_DEMO_SANDBOX = "true";
    resetSandboxStateForTests();
  });

  it("hides unchecked variants from storefront and hides product when all variants are unchecked", async () => {
    const initialPublic = await listCatalog(false);
    const disney = initialPublic.find((p) => p.slug === "disney-gift-card-usa");
    expect(disney).toBeDefined();
    const firstVariantId = disney!.variants[0].id;

    // Uncheck single variant
    await toggleVariantActiveAdmin(firstVariantId, false);

    const afterSingleHide = await listCatalog(false);
    const disneyAfterOne = afterSingleHide.find((p) => p.slug === "disney-gift-card-usa");
    expect(disneyAfterOne).toBeDefined();
    expect(disneyAfterOne!.variants.some((v) => v.id === firstVariantId)).toBe(false);

    // Admin still sees it
    const adminCatalog = await listCatalog(true);
    const disneyAdmin = adminCatalog.find((p) => p.slug === "disney-gift-card-usa");
    expect(disneyAdmin!.variants.find((v) => v.id === firstVariantId)?.active).toBe(false);

    // Uncheck ALL remaining variants of Disney
    for (const v of disney!.variants) {
      await toggleVariantActiveAdmin(v.id, false);
    }

    const afterAllHidden = await listCatalog(false);
    expect(afterAllHidden.some((p) => p.slug === "disney-gift-card-usa")).toBe(false);
  });

  it("deletes unreferenced variants and products cleanly, and archives ordered ones safely", async () => {
    const adminCatalog = await listCatalog(true);
    const disney = adminCatalog.find((p) => p.slug === "disney-gift-card-usa")!;
    const targetVariant = disney.variants[0];

    const delVarRes = await deleteVariantAdmin(targetVariant.id);
    expect(delVarRes).toEqual({ deleted: true, archived: false });

    const afterDelVar = await listCatalog(true);
    const disneyAfterVar = afterDelVar.find((p) => p.slug === "disney-gift-card-usa")!;
    expect(disneyAfterVar.variants.some((v) => v.id === targetVariant.id)).toBe(false);

    // Deleting product with no orders removes it completely
    const delProdRes = await deleteProductAdmin(disney.id);
    expect(delProdRes).toEqual({ deleted: true, archived: false });
    expect((await listCatalog(true)).some((p) => p.id === disney.id)).toBe(false);

    // Deleting a variant referenced by an order archives it instead of failing
    const targetProd = (await listCatalog(false)).find((p) =>
      p.variants.some((v) => v.inStock)
    )!;
    const orderedVariant = targetProd.variants.find((v) => v.inStock)!;
    await initiateCheckout({
      email: CUSTOMER_SESSION.email,
      items: [{ variantId: orderedVariant.id, quantity: 1 }],
      applyStoreCredit: false,
      paymentGateway: "zenobank",
      sessionUser: CUSTOMER_SESSION,
      ipAddress: "127.0.0.1",
    });

    const archVarRes = await deleteVariantAdmin(orderedVariant.id);
    expect(archVarRes).toEqual({ deleted: false, archived: true });

    const prodPublicAfter = (await listCatalog(false)).find(
      (p) => p.id === targetProd.id
    );
    expect(prodPublicAfter?.variants.some((v) => v.id === orderedVariant.id) ?? false).toBe(
      false
    );
  });
});
