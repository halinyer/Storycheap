import type { SupplierPricingPolicy } from "@/types";

export function parseUsdToTenthsOfCent(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole = "0", frac = ""] = unsigned.split(".");
  const paddedFrac = frac.padEnd(5, "0");
  const baseTenths =
    Number.parseInt(whole, 10) * 10_000 + Number.parseInt(paddedFrac.slice(0, 4), 10);
  const roundDigit = Number.parseInt(paddedFrac[4] ?? "0", 10);
  const tenths = roundDigit >= 5 ? baseTenths + 1 : baseTenths;
  return negative ? -tenths : tenths;
}

export function tenthsOfCentToRoundedCents(tenths: number): number {
  return Math.round(tenths / 100);
}

export function tenthsOfCentToExactUsdString(tenths: number): string {
  return (tenths / 10_000).toFixed(4);
}

export function computeSafeFloorSaleCents(
  liveCostTenths: number,
  policy: Pick<SupplierPricingPolicy, "minMarginPct" | "minMarginUsdCents">
): number {
  const minAbsoluteTenths =
    liveCostTenths + Math.max(0, policy.minMarginUsdCents) * 100;
  const minPctTenths = Math.ceil(
    liveCostTenths * (1 + Math.max(0, policy.minMarginPct) / 100)
  );
  const targetTenths = Math.max(minAbsoluteTenths, minPctTenths);
  const minPositiveCeil = Math.floor(liveCostTenths / 100) + 1;
  return Math.max(minPositiveCeil, Math.ceil(targetTenths / 100));
}

export interface EvaluatedSupplierPriceChange {
  valid: boolean;
  liveCostTenths: number;
  nextUnitCostCents: number;
  nextExactCostUsd: string;
  previousExactCostUsd: string | null;
  costChanged: boolean;
  oldSalePriceCents: number;
  nextSalePriceCents: number;
  salePriceChanged: boolean;
  /** True when live supplier cost equals or exceeds the post-evaluation sale price. */
  belowCostFloor: boolean;
  /** True when live supplier cost equaled or exceeded the previous storefront price. */
  breachedOldSalePrice: boolean;
}

export function evaluateSupplierPriceChange(input: {
  currentSaleCents: number;
  oldExactCostUsd?: string | null;
  oldUnitCostCents?: number | null;
  liveCostRaw: string | number;
  policy: SupplierPricingPolicy;
}): EvaluatedSupplierPriceChange {
  const liveCostTenths = parseUsdToTenthsOfCent(input.liveCostRaw);
  if (liveCostTenths === null || liveCostTenths <= 0) {
    return {
      valid: false,
      liveCostTenths: 0,
      nextUnitCostCents: input.oldUnitCostCents ?? 0,
      nextExactCostUsd: input.oldExactCostUsd ?? "0.0000",
      previousExactCostUsd: input.oldExactCostUsd ?? null,
      costChanged: false,
      oldSalePriceCents: input.currentSaleCents,
      nextSalePriceCents: input.currentSaleCents,
      salePriceChanged: false,
      belowCostFloor: false,
      breachedOldSalePrice: false,
    };
  }

  const nextUnitCostCents = tenthsOfCentToRoundedCents(liveCostTenths);
  const nextExactCostUsd = tenthsOfCentToExactUsdString(liveCostTenths);

  const oldTenthsFromExact = parseUsdToTenthsOfCent(input.oldExactCostUsd);
  const oldCostTenths =
    oldTenthsFromExact !== null && oldTenthsFromExact > 0
      ? oldTenthsFromExact
      : typeof input.oldUnitCostCents === "number" && input.oldUnitCostCents > 0
        ? input.oldUnitCostCents * 100
        : null;

  const previousExactCostUsd =
    oldCostTenths !== null ? tenthsOfCentToExactUsdString(oldCostTenths) : null;

  const costChanged =
    oldCostTenths === null ||
    oldCostTenths !== liveCostTenths ||
    input.oldUnitCostCents !== nextUnitCostCents;

  const currentSaleTenths = input.currentSaleCents * 100;
  const breachedOldSalePrice = liveCostTenths >= currentSaleTenths;
  let nextSalePriceCents = input.currentSaleCents;

  if (input.policy.mode === "protect_floor") {
    if (breachedOldSalePrice) {
      nextSalePriceCents = computeSafeFloorSaleCents(liveCostTenths, input.policy);
    }
  } else if (input.policy.mode === "keep_margin_on_increase") {
    const costIncreased = oldCostTenths !== null && liveCostTenths > oldCostTenths;
    if (costIncreased && oldCostTenths > 0 && currentSaleTenths > oldCostTenths) {
      const preservedTenths = (liveCostTenths * currentSaleTenths) / oldCostTenths;
      const preservedCents = Math.ceil(preservedTenths / 100);
      const safeFloorCents = computeSafeFloorSaleCents(liveCostTenths, input.policy);
      nextSalePriceCents = Math.max(input.currentSaleCents, preservedCents, safeFloorCents);
    } else if (breachedOldSalePrice) {
      nextSalePriceCents = computeSafeFloorSaleCents(liveCostTenths, input.policy);
    }
  }

  const belowCostFloor = liveCostTenths >= nextSalePriceCents * 100;

  return {
    valid: true,
    liveCostTenths,
    nextUnitCostCents,
    nextExactCostUsd,
    previousExactCostUsd,
    costChanged,
    oldSalePriceCents: input.currentSaleCents,
    nextSalePriceCents,
    salePriceChanged: nextSalePriceCents !== input.currentSaleCents,
    belowCostFloor,
    breachedOldSalePrice,
  };
}
