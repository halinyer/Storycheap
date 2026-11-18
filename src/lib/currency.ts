export type DisplayCurrency = "USD" | "VES";

export function usdCentsToBsCents(
  usdCents: number,
  bsRateCents: number | null | undefined
): number | null {
  if (
    !Number.isFinite(usdCents) ||
    typeof bsRateCents !== "number" ||
    !Number.isFinite(bsRateCents) ||
    bsRateCents <= 0
  ) {
    return null;
  }
  return Math.round((usdCents * bsRateCents) / 100);
}

export function formatBsNumber(bsCents: number): string {
  return (bsCents / 100).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatBsCents(bsCents: number): string {
  const sign = bsCents < 0 ? "-" : "";
  return `${sign}Bs ${formatBsNumber(Math.abs(bsCents))}`;
}

export function formatBsFromUsdCents(
  usdCents: number,
  bsRateCents: number | null | undefined
): string | null {
  const bsCents = usdCentsToBsCents(usdCents, bsRateCents);
  if (bsCents === null) return null;
  return formatBsCents(bsCents);
}

export interface VariantDualPaymentComparison {
  saleUsd: number;
  costUsd: number | null;
  directUsdtProfit: number | null;
  directUsdtMarkupPct: number | null;
  saleBsCents: number | null;
  storeBsRate: number | null;
  usdtP2pRate: number | null;
  realUsdtFromBs: number | null;
  realUsdtFromBsRounded: number | null;
  bsProfitUsdt: number | null;
  bsMarkupPct: number | null;
  extraCushionUsdt: number | null;
  effectiveBsPerCostDollar: number | null;
  effectiveBsSpreadOverUsdt: number | null;
}

/**
 * Computes the admin-only dual payment method comparison (Direct USDT vs Bolívares converted at live USDT P2P rate):
 * - Real USDT from Bs = Price in Bs / Current USDT P2P Rate
 * - Net USDT profit in Bs = Real USDT from Bs - Wholesale Cost in USD
 * - Markup % over wholesale cost for both Direct USDT and Bolívares
 */
export function computeVariantDualPaymentComparison(input: {
  saleUsd: number;
  costUsd: number | null;
  storeBsRateCents: number | null | undefined;
  usdtP2pRateCents?: number | null | undefined;
}): VariantDualPaymentComparison | null {
  const { saleUsd, costUsd, storeBsRateCents } = input;
  if (!Number.isFinite(saleUsd) || saleUsd <= 0) return null;

  const validCost =
    typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0
      ? costUsd
      : null;

  const directUsdtProfit = validCost !== null ? saleUsd - validCost : null;
  const directUsdtMarkupPct =
    directUsdtProfit !== null && validCost !== null && validCost > 0
      ? (directUsdtProfit / validCost) * 100
      : null;

  const hasStoreRate =
    typeof storeBsRateCents === "number" &&
    Number.isFinite(storeBsRateCents) &&
    storeBsRateCents > 0;

  if (!hasStoreRate) {
    return {
      saleUsd,
      costUsd: validCost,
      directUsdtProfit,
      directUsdtMarkupPct,
      saleBsCents: null,
      storeBsRate: null,
      usdtP2pRate: null,
      realUsdtFromBs: null,
      realUsdtFromBsRounded: null,
      bsProfitUsdt: null,
      bsMarkupPct: null,
      extraCushionUsdt: null,
      effectiveBsPerCostDollar: null,
      effectiveBsSpreadOverUsdt: null,
    };
  }

  const saleUsdCents = Math.round(saleUsd * 100);
  const saleBsCents = usdCentsToBsCents(saleUsdCents, storeBsRateCents)!;
  const effectiveUsdtRateCents =
    typeof input.usdtP2pRateCents === "number" &&
    Number.isFinite(input.usdtP2pRateCents) &&
    input.usdtP2pRateCents > 0
      ? input.usdtP2pRateCents
      : storeBsRateCents;

  const storeBsRate = storeBsRateCents / 100;
  const usdtP2pRate = effectiveUsdtRateCents / 100;

  // Dólares reales (USDT) = Precio en Bolívares / Tasa USDT del momento
  const realUsdtFromBs = saleBsCents / effectiveUsdtRateCents;
  const realUsdtFromBsRounded = Math.round(realUsdtFromBs * 100) / 100;

  const bsProfitUsdt =
    validCost !== null ? realUsdtFromBsRounded - validCost : null;
  const bsMarkupPct =
    validCost !== null && validCost > 0
      ? ((realUsdtFromBs - validCost) / validCost) * 100
      : null;

  const extraCushionUsdt = realUsdtFromBsRounded - saleUsd;
  const effectiveBsPerCostDollar =
    validCost !== null && validCost > 0 ? saleBsCents / 100 / validCost : null;
  const effectiveBsSpreadOverUsdt =
    effectiveBsPerCostDollar !== null
      ? effectiveBsPerCostDollar - usdtP2pRate
      : null;

  return {
    saleUsd,
    costUsd: validCost,
    directUsdtProfit,
    directUsdtMarkupPct,
    saleBsCents,
    storeBsRate,
    usdtP2pRate,
    realUsdtFromBs,
    realUsdtFromBsRounded,
    bsProfitUsdt,
    bsMarkupPct,
    extraCushionUsdt,
    effectiveBsPerCostDollar,
    effectiveBsSpreadOverUsdt,
  };
}
