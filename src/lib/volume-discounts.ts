import type { CartItem, VolumeDiscountTier } from "@/types";

export const MAX_ORDER_QUANTITY_PER_LINE = 10;

export interface ResolvedVolumePricing {
  quantity: number;
  baseUnitPriceCents: number;
  effectiveUnitPriceCents: number;
  appliedTier: VolumeDiscountTier | null;
  nextTier: VolumeDiscountTier | null;
  lineTotalCents: number;
  regularLineTotalCents: number;
  lineSavingsCents: number;
  discountPct: number;
  hasVolumeDiscount: boolean;
}

/**
 * Normalizes raw discount tiers:
 * - keeps integer minQuantity in [2, MAX_ORDER_QUANTITY_PER_LINE]
 * - keeps integer unitPriceCents > 0 and strictly lower than baseUnitPriceCents (if provided)
 * - deduplicates by minQuantity (latest entry wins) and sorts ascending by minQuantity
 */
export function normalizeVolumeDiscountTiers(
  rawTiers: ReadonlyArray<Partial<VolumeDiscountTier>> | null | undefined,
  baseUnitPriceCents?: number | null
): VolumeDiscountTier[] {
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) return [];

  const byMinQty = new Map<number, number>();
  const hasBaseCap =
    typeof baseUnitPriceCents === "number" &&
    Number.isFinite(baseUnitPriceCents) &&
    baseUnitPriceCents > 0;

  for (const tier of rawTiers) {
    if (!tier) continue;
    const minQuantity = Number(tier.minQuantity);
    const unitPriceCents = Number(tier.unitPriceCents);
    if (
      !Number.isInteger(minQuantity) ||
      minQuantity < 2 ||
      minQuantity > MAX_ORDER_QUANTITY_PER_LINE
    ) {
      continue;
    }
    if (!Number.isInteger(unitPriceCents) || unitPriceCents <= 0) {
      continue;
    }
    if (hasBaseCap && unitPriceCents >= baseUnitPriceCents) {
      continue;
    }
    byMinQty.set(minQuantity, unitPriceCents);
  }

  return Array.from(byMinQty.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([minQuantity, unitPriceCents]) => ({
      minQuantity,
      unitPriceCents,
    }));
}

/**
 * Validates admin-edited volume tiers strictly before persisting:
 * - minQuantity integer in [2, 10], unique per tier
 * - strictly cheaper than base sale price
 * - strictly non-increasing unit price as quantity rises
 * - never below unitCostCents when cost is configured
 */
export function validateVolumeDiscountTiersForAdmin(input: {
  tiers: ReadonlyArray<VolumeDiscountTier>;
  baseUnitPriceCents: number;
  unitCostCents: number | null;
}): { ok: true; tiers: VolumeDiscountTier[] } | { ok: false; error: string } {
  if (!Array.isArray(input.tiers) || input.tiers.length === 0) {
    return { ok: true, tiers: [] };
  }

  const seenMin = new Set<number>();
  const clean: VolumeDiscountTier[] = [];

  for (const raw of input.tiers) {
    const minQty = Number(raw.minQuantity);
    const price = Number(raw.unitPriceCents);

    if (
      !Number.isInteger(minQty) ||
      minQty < 2 ||
      minQty > MAX_ORDER_QUANTITY_PER_LINE
    ) {
      return {
        ok: false,
        error: `Cada nivel de descuento debe aplicar entre 2 y ${MAX_ORDER_QUANTITY_PER_LINE} unidades.`,
      };
    }
    if (seenMin.has(minQty)) {
      return {
        ok: false,
        error: `Ya existe un nivel para ${minQty}+ unidades. Usa cantidades mínimas distintas.`,
      };
    }
    seenMin.add(minQty);

    if (!Number.isInteger(price) || price <= 0) {
      return {
        ok: false,
        error: `El precio por unidad para ${minQty}+ unidades debe ser mayor que $0.00.`,
      };
    }
    if (price >= input.baseUnitPriceCents) {
      return {
        ok: false,
        error: `El nivel ${minQty}+ ($${(price / 100).toFixed(2)}) debe ser menor que el precio base ($${(input.baseUnitPriceCents / 100).toFixed(2)}).`,
      };
    }
    if (
      typeof input.unitCostCents === "number" &&
      Number.isFinite(input.unitCostCents) &&
      input.unitCostCents > 0 &&
      price < input.unitCostCents
    ) {
      return {
        ok: false,
        error: `El nivel ${minQty}+ ($${(price / 100).toFixed(2)}) está por debajo del costo ($${(input.unitCostCents / 100).toFixed(2)}) y generaría pérdida.`,
      };
    }

    clean.push({ minQuantity: minQty, unitPriceCents: price });
  }

  clean.sort((a, b) => a.minQuantity - b.minQuantity);

  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1]!;
    const curr = clean[i]!;
    if (curr.unitPriceCents >= prev.unitPriceCents) {
      return {
        ok: false,
        error: `El nivel ${curr.minQuantity}+ ($${(curr.unitPriceCents / 100).toFixed(2)}) debe tener un precio menor que el nivel ${prev.minQuantity}+ ($${(prev.unitPriceCents / 100).toFixed(2)}).`,
      };
    }
  }

  return { ok: true, tiers: clean };
}

export function resolveVolumeTierPrice(input: {
  baseUnitPriceCents: number;
  quantity: number;
  volumeDiscounts?: ReadonlyArray<Partial<VolumeDiscountTier>> | null;
}): ResolvedVolumePricing {
  const qty = Math.max(1, Math.floor(input.quantity || 1));
  const baseUnitPriceCents = Math.max(0, Math.round(input.baseUnitPriceCents));
  const tiers = normalizeVolumeDiscountTiers(
    input.volumeDiscounts,
    baseUnitPriceCents
  );

  let appliedTier: VolumeDiscountTier | null = null;
  let nextTier: VolumeDiscountTier | null = null;

  for (const tier of tiers) {
    if (qty >= tier.minQuantity) {
      appliedTier = tier;
    } else if (!nextTier) {
      nextTier = tier;
    }
  }

  const effectiveUnitPriceCents = appliedTier
    ? appliedTier.unitPriceCents
    : baseUnitPriceCents;
  const lineTotalCents = effectiveUnitPriceCents * qty;
  const regularLineTotalCents = baseUnitPriceCents * qty;
  const lineSavingsCents = Math.max(0, regularLineTotalCents - lineTotalCents);
  const discountPct =
    baseUnitPriceCents > 0 && effectiveUnitPriceCents < baseUnitPriceCents
      ? Number(
          (
            ((baseUnitPriceCents - effectiveUnitPriceCents) /
              baseUnitPriceCents) *
            100
          ).toFixed(1)
        )
      : 0;

  return {
    quantity: qty,
    baseUnitPriceCents,
    effectiveUnitPriceCents,
    appliedTier,
    nextTier,
    lineTotalCents,
    regularLineTotalCents,
    lineSavingsCents,
    discountPct,
    hasVolumeDiscount: tiers.length > 0,
  };
}

export function getBestVolumeTierHint(input: {
  baseUnitPriceCents: number;
  volumeDiscounts?: ReadonlyArray<Partial<VolumeDiscountTier>> | null;
}): {
  tiers: VolumeDiscountTier[];
  firstTier: VolumeDiscountTier | null;
  bestTier: VolumeDiscountTier | null;
  maxDiscountPct: number;
} {
  const tiers = normalizeVolumeDiscountTiers(
    input.volumeDiscounts,
    input.baseUnitPriceCents
  );
  if (tiers.length === 0) {
    return {
      tiers: [],
      firstTier: null,
      bestTier: null,
      maxDiscountPct: 0,
    };
  }
  const firstTier = tiers[0]!;
  const bestTier = tiers[tiers.length - 1]!;
  const maxDiscountPct =
    input.baseUnitPriceCents > 0
      ? Math.max(
          0,
          Math.round(
            ((input.baseUnitPriceCents - bestTier.unitPriceCents) /
              input.baseUnitPriceCents) *
              100
          )
        )
      : 0;

  return {
    tiers,
    firstTier,
    bestTier,
    maxDiscountPct,
  };
}

export function computeCartTotals(cartItems: ReadonlyArray<CartItem>): {
  subtotalCents: number;
  regularSubtotalCents: number;
  totalSavingsCents: number;
  lines: Map<string, ResolvedVolumePricing>;
} {
  let subtotalCents = 0;
  let regularSubtotalCents = 0;
  const lines = new Map<string, ResolvedVolumePricing>();

  for (const item of cartItems) {
    const resolved = resolveVolumeTierPrice({
      baseUnitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      volumeDiscounts: item.volumeDiscounts,
    });
    subtotalCents += resolved.lineTotalCents;
    regularSubtotalCents += resolved.regularLineTotalCents;
    lines.set(item.variantId, resolved);
  }

  return {
    subtotalCents,
    regularSubtotalCents,
    totalSavingsCents: Math.max(0, regularSubtotalCents - subtotalCents),
    lines,
  };
}
