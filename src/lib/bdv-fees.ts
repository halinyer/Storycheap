export const DEFAULT_BDV_INCOMING_FEE_PCT = 1.5;
export const DEFAULT_BDV_OUTGOING_FEE_PCT = 1.5;

/**
 * Controls whether the BDV bank commission is passed through (grossed-up) to the Bs price
 * charged to customers so the merchant receives their exact target net Bs in the bank:
 * - `"off"`: charge base store Bs rate as-is (merchant absorbs BDV fees).
 * - `"incoming"`: gross-up by 1/(1 - incomingFeePct) so the EXACT target Bs land in BDV.
 * - `"both"`: gross-up by 1/((1 - incomingFeePct)*(1 - outgoingFeePct)) so target Bs remain
 *   even after withdrawing/transferring out of BDV.
 */
export type BdvFeePassThroughMode = "off" | "incoming" | "both";

export const DEFAULT_BDV_FEE_PASS_THROUGH: BdvFeePassThroughMode = "incoming";

export function normalizeBdvFeePassThroughMode(
  raw: unknown,
  fallback: BdvFeePassThroughMode = DEFAULT_BDV_FEE_PASS_THROUGH
): BdvFeePassThroughMode {
  if (raw === "off" || raw === "incoming" || raw === "both") return raw;
  return fallback;
}

export interface BdvFeeBreakdown {
  grossBsCents: number;
  incomingFeePct: number;
  outgoingFeePct: number;
  /** Comisión que descuenta BDV al acreditarte el Pago Móvil */
  incomingFeeBsCents: number;
  /** Saldo REAL que cae disponible en tu cuenta del Banco de Venezuela */
  netCreditedBsCents: number;
  /** Comisión estimada cuando saques/transfieras esos bolívares del BDV */
  estimatedOutgoingFeeBsCents: number;
  /** Bolívares netos que te quedan libres tras entrada + salida BDV */
  netLiquidableBsCents: number;
  /** Porcentaje efectivo combinado perdido entre entrada y salida (ej. 2.98%) */
  combinedEffectiveFeePct: number;
  /** Porcentaje mínimo que debe cubrir tu tasa/margen para absorber entrada + salida (ej. 3.07%) */
  requiredMarkupPct: number;
}

export function clampFeePct(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(25, Math.max(0, Math.round(n * 100) / 100));
}

export function computeBdvFeeRates(
  incomingFeePctRaw: number,
  outgoingFeePctRaw: number
): {
  incomingFeePct: number;
  outgoingFeePct: number;
  combinedEffectiveFeePct: number;
  requiredMarkupPct: number;
} {
  const incomingFeePct = clampFeePct(incomingFeePctRaw, DEFAULT_BDV_INCOMING_FEE_PCT);
  const outgoingFeePct = clampFeePct(outgoingFeePctRaw, DEFAULT_BDV_OUTGOING_FEE_PCT);
  const netFactor = (1 - incomingFeePct / 100) * (1 - outgoingFeePct / 100);
  const combinedEffectiveFeePct = Math.round((1 - netFactor) * 10000) / 100;
  const requiredMarkupPct =
    netFactor > 0 ? Math.round((1 / netFactor - 1) * 10000) / 100 : 0;

  return {
    incomingFeePct,
    outgoingFeePct,
    combinedEffectiveFeePct,
    requiredMarkupPct,
  };
}

/**
 * Calculates exact BDV incoming fee (e.g. 1.5% on Pago Móvil jurídico received)
 * and estimated outgoing fee (e.g. 1.5% when withdrawing/moving Bs out of BDV).
 */
export function computeBdvFeeBreakdown(args: {
  grossBsCents: number;
  incomingFeePct?: number;
  outgoingFeePct?: number;
}): BdvFeeBreakdown {
  const gross = Math.max(0, Math.round(args.grossBsCents));
  const rates = computeBdvFeeRates(
    args.incomingFeePct ?? DEFAULT_BDV_INCOMING_FEE_PCT,
    args.outgoingFeePct ?? DEFAULT_BDV_OUTGOING_FEE_PCT
  );

  const incomingFeeBsCents = Math.round((gross * rates.incomingFeePct) / 100);
  const netCreditedBsCents = Math.max(0, gross - incomingFeeBsCents);
  const estimatedOutgoingFeeBsCents = Math.round(
    (netCreditedBsCents * rates.outgoingFeePct) / 100
  );
  const netLiquidableBsCents = Math.max(
    0,
    netCreditedBsCents - estimatedOutgoingFeeBsCents
  );

  return {
    grossBsCents: gross,
    incomingFeePct: rates.incomingFeePct,
    outgoingFeePct: rates.outgoingFeePct,
    incomingFeeBsCents,
    netCreditedBsCents,
    estimatedOutgoingFeeBsCents,
    netLiquidableBsCents,
    combinedEffectiveFeePct: rates.combinedEffectiveFeePct,
    requiredMarkupPct: rates.requiredMarkupPct,
  };
}

/**
 * Computes the customer-facing Bs/USD rate (in céntimos) required so that after BDV deducts
 * its bank commission(s), the merchant receives the exact target `baseBsRateCents` net.
 */
export function computeGrossUpBsRateCents(args: {
  baseBsRateCents: number | null | undefined;
  incomingFeePct?: number;
  outgoingFeePct?: number;
  passThroughMode?: BdvFeePassThroughMode;
}): number | null {
  const base = args.baseBsRateCents;
  if (typeof base !== "number" || !Number.isFinite(base) || base <= 0) {
    return null;
  }
  const mode = normalizeBdvFeePassThroughMode(args.passThroughMode, "off");
  if (mode === "off") return Math.round(base);

  const rates = computeBdvFeeRates(
    args.incomingFeePct ?? DEFAULT_BDV_INCOMING_FEE_PCT,
    args.outgoingFeePct ?? DEFAULT_BDV_OUTGOING_FEE_PCT
  );

  const inFactor = 1 - rates.incomingFeePct / 100;
  const outFactor = mode === "both" ? 1 - rates.outgoingFeePct / 100 : 1;
  const factor = inFactor * outFactor;
  if (factor <= 0) return Math.round(base);

  let gross = Math.ceil(base / factor);
  // Guarantee rounding never leaves the merchant 1 céntimo short of their target net Bs
  while (gross < base * 2) {
    const check = computeBdvFeeBreakdown({
      grossBsCents: gross,
      incomingFeePct: rates.incomingFeePct,
      outgoingFeePct: rates.outgoingFeePct,
    });
    const achieved =
      mode === "both" ? check.netLiquidableBsCents : check.netCreditedBsCents;
    if (achieved >= Math.round(base)) break;
    gross += 1;
  }
  return gross;
}

/**
 * Given a target net Bs amount the merchant wants to keep (in BDV or after withdrawing),
 * returns the exact gross Bs amount to charge the customer and its full BDV breakdown.
 */
export function computeGrossUpForTargetBs(args: {
  targetNetBsCents: number;
  incomingFeePct?: number;
  outgoingFeePct?: number;
  passThroughMode?: BdvFeePassThroughMode;
}): {
  targetNetBsCents: number;
  chargeGrossBsCents: number;
  effectiveMarkupPct: number;
  breakdown: BdvFeeBreakdown;
} {
  const target = Math.max(0, Math.round(args.targetNetBsCents));
  const mode = normalizeBdvFeePassThroughMode(
    args.passThroughMode,
    DEFAULT_BDV_FEE_PASS_THROUGH
  );
  const chargeGrossBsCents =
    target > 0
      ? (computeGrossUpBsRateCents({
          baseBsRateCents: target,
          incomingFeePct: args.incomingFeePct,
          outgoingFeePct: args.outgoingFeePct,
          passThroughMode: mode,
        }) ?? target)
      : 0;

  const breakdown = computeBdvFeeBreakdown({
    grossBsCents: chargeGrossBsCents,
    incomingFeePct: args.incomingFeePct,
    outgoingFeePct: args.outgoingFeePct,
  });

  const effectiveMarkupPct =
    target > 0
      ? Math.round(((chargeGrossBsCents - target) / target) * 10000) / 100
      : 0;

  return {
    targetNetBsCents: target,
    chargeGrossBsCents,
    effectiveMarkupPct,
    breakdown,
  };
}
