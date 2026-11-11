import { beforeEach, describe, expect, it } from "vitest";
import { validateAndPriceCart, CheckoutValidationError } from "@/lib/server/pricing";
import {
  appendCreditLedgerEntry,
  getUserCreditBalanceCents,
  insertInventoryBatch,
  previewCsvInventoryBatch,
} from "@/lib/server/repository";
import { resetSandboxStateForTests } from "@/lib/server/sandbox-db";
import { canTransitionOrder } from "@/lib/server/state-machine";

const PSN_10_VARIANT_ID = "20000000-0000-4000-8000-000000000101";

describe("State Machine, Pricing, CSV Hash Deduplication & Ledger Non-Negativity", () => {
  beforeEach(() => {
    resetSandboxStateForTests();
  });

  it("enforces deterministic forward-only order transitions", () => {
    expect(canTransitionOrder("CREATED", "PENDING_PAYMENT")).toBe(true);
    expect(canTransitionOrder("PENDING_PAYMENT", "PAID")).toBe(true);
    expect(canTransitionOrder("PAID", "FULFILLING")).toBe(true);
    expect(canTransitionOrder("FULFILLING", "DELIVERED")).toBe(true);

    expect(canTransitionOrder("DELIVERED", "PAID")).toBe(false);
    expect(canTransitionOrder("DELIVERED", "REFUNDED_CREDIT")).toBe(false);
    expect(canTransitionOrder("EXPIRED", "DELIVERED")).toBe(false);
    expect(canTransitionOrder("PENDING_PAYMENT", "DELIVERED")).toBe(false);
  });

  it("validates authoritative server pricing and blocks invalid variants/quantities", async () => {
    const priced = await validateAndPriceCart([
      { variantId: PSN_10_VARIANT_ID, quantity: 2 },
    ]);
    expect(priced.subtotalCents).toBe(2100); // 2 * $10.50

    await expect(
      validateAndPriceCart([{ variantId: PSN_10_VARIANT_ID, quantity: 99 }])
    ).rejects.toThrow(CheckoutValidationError);

    await expect(
      validateAndPriceCart([
        { variantId: "99999999-0000-4000-8000-000000000000", quantity: 1 },
      ])
    ).rejects.toThrow(CheckoutValidationError);
  });

  it("enforces non-negative credit_ledger balance", async () => {
    const userId = "00000000-0000-4000-8000-00000000c001";
    const initial = await getUserCreditBalanceCents(userId);
    expect(initial).toBe(350);

    await expect(
      appendCreditLedgerEntry({
        userId,
        deltaCents: -(initial + 100),
        reason: "checkout_apply",
        note: "Attempt overdraft",
      })
    ).rejects.toThrow(/INSUFFICIENT_CREDIT_BALANCE/);

    expect(await getUserCreditBalanceCents(userId)).toBe(initial);
  });

  it("detects intra-batch and database SHA-256 duplicate codes in CSV import", async () => {
    const preview1 = await previewCsvInventoryBatch([
      { code: "PSN-NEW-0001" },
      { code: "PSN-NEW-0001" },
      { code: "ab" },
    ]);
    expect(preview1.map((r) => r.status)).toEqual([
      "valid",
      "duplicate_batch",
      "invalid",
    ]);

    const res = await insertInventoryBatch({
      variantId: PSN_10_VARIANT_ID,
      batchId: "BATCH-TEST-1",
      rows: [{ code: "PSN-NEW-0001" }, { code: "PSN-NEW-0002" }],
    });
    expect(res.insertedCount).toBe(2);

    const preview2 = await previewCsvInventoryBatch([
      { code: "PSN-NEW-0001" },
      { code: "PSN-NEW-0003" },
    ]);
    expect(preview2.map((r) => r.status)).toEqual(["duplicate_db", "valid"]);
  });
});
