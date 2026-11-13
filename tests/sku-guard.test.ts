import { describe, expect, it } from "vitest";
import {
  evaluateSkuAlignment,
  extractDenominationNumbers,
  suggestDenominationLabel,
} from "@/lib/sku-guard";

describe("SKU denomination & margin guardrails", () => {
  it("flags critical mismatch when 520 diamonds label is linked to 110 diamonds SKU", () => {
    const report = evaluateSkuAlignment({
      denominationLabel: "520 + 52 Diamantes",
      productName: "Free Fire PIN Diamantes (Latam)",
      supplierName: "Free Fire 110 Diamantes (100 + 10% de bono) · PIN",
      supplierSku: "FF-110-DIAMONDS-PIN",
      costUsd: 0.6901,
      saleUsd: 0.72,
    });

    expect(report.severity).toBe("critical");
    expect(report.denominationMismatch).toBe(true);
    expect(report.suggestedLabel).toBe("110 Diamantes (100 + 10% de bono)");
    expect(report.messages[0]).toContain("520 + 52 Diamantes");
  });

  it("allows valid matches like 520 + 52 Diamantes linked to Free Fire 572 (520 + 10% de bono)", () => {
    const report = evaluateSkuAlignment({
      denominationLabel: "520 + 52 Diamantes",
      productName: "Free Fire PIN Diamantes (Latam)",
      supplierName: "Free Fire 572 Diamantes (520 + 10% de bono) · PIN",
      supplierSku: "FF-572-DIAMONDS-PIN",
      costUsd: 3.4803,
      saleUsd: 3.85,
    });

    expect(report.severity).toBe("ok");
    expect(report.denominationMismatch).toBe(false);
    expect(report.marginIssue).toBeNull();
  });

  it("ignores percentages like 10% when extracting numbers and flags extreme markup or loss", () => {
    expect(extractDenominationNumbers("Free Fire 110 Diamantes (100 + 10% de bono)")).toEqual([
      110, 100,
    ]);

    const loss = evaluateSkuAlignment({
      denominationLabel: "$10 USD",
      supplierName: "PlayStation $10 USA",
      costUsd: 10.5,
      saleUsd: 9.99,
    });
    expect(loss.severity).toBe("critical");
    expect(loss.marginIssue).toBe("loss");

    const extreme = evaluateSkuAlignment({
      denominationLabel: "110 Diamantes",
      supplierName: "Free Fire 110 Diamantes · PIN",
      costUsd: 0.6901,
      saleUsd: 4.99,
    });
    expect(extreme.severity).toBe("warn");
    expect(extreme.marginIssue).toBe("extreme_markup");
  });

  it("formats clean store denomination suggestions", () => {
    expect(
      suggestDenominationLabel(
        "Free Fire 110 Diamantes (100 + 10% de bono) · PIN",
        "Free Fire PIN Diamantes (Latam)"
      )
    ).toBe("110 Diamantes (100 + 10% de bono)");
  });
});
