/**
 * Parses Venezuelan monetary strings into integer cents:
 *  - "1.250,45" -> 125045
 *  - "865,00"   -> 86500
 *  - "1,250.45" -> 125045
 *  - "865.45"   -> 86545
 *  - "1250"     -> 125000
 */
export function parseVenezuelanAmountCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized: string;
  if (lastComma !== -1 && lastDot !== -1) {
    // Both separators present: whichever appears last is the decimal separator
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    const afterComma = cleaned.slice(lastComma + 1);
    if (/^\d{1,2}$/.test(afterComma)) {
      normalized = cleaned.replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (lastDot !== -1) {
    const afterDot = cleaned.slice(lastDot + 1);
    // Single dot followed by 1 or 2 digits -> decimal (e.g. "865.45"); 3 digits -> thousands ("1.250")
    if (/^\d{1,2}$/.test(afterDot) && cleaned.indexOf(".") === lastDot) {
      normalized = cleaned;
    } else {
      normalized = cleaned.replace(/\./g, "");
    }
  } else {
    normalized = cleaned;
  }

  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  // Sanity guard against phone/reference strings accidentally matching as huge amounts (> 500M Bs)
  if (num > 500_000_000) return null;
  return Math.round(num * 100);
}

export function extractAmountAndCurrency(text: string): {
  amountCents: number | null;
  currency: "VES" | "USD" | "USDT";
} {
  const currencyPatterns: Array<{
    regex: RegExp;
    currency: "VES" | "USD" | "USDT";
  }> = [
    // Currency prefix: Bs. 1.250,45 / BsS 865,00 / VEF 500.00 / VES 500,00 / USDT 10.50
    {
      regex: /(?:Bs\.?\s*S?\.?|VEF|VES)\s*:?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})|[\d]+(?:[.,]\d{1,2})?)/i,
      currency: "VES",
    },
    // Amount followed by currency: 1.250,45 Bs / 865,00 VEF / 865.00 VES
    {
      regex: /([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})|[\d]+(?:[.,]\d{1,2})?)\s*(?:Bs\.?\s*S?\.?|Bolívares|Bolivares|VEF|VES)\b/i,
      currency: "VES",
    },
    // Labeled Monto / Valor / Importe / Total
    {
      regex: /(?:Monto|Valor|Importe|Total(?:\s+recibido)?)\s*:?\s*(?:Bs\.?\s*S?\.?|VEF|VES)?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})|[\d]+(?:[.,]\d{1,2})?)/i,
      currency: "VES",
    },
    // "por 865,00" or "de 865,00"
    {
      regex: /\b(?:por|de)\s+(?:Bs\.?\s*S?\.?|VEF|VES)?\s*([\d]{1,3}(?:[.,]\d{3})*[.,]\d{2}|[\d]+[.,]\d{2})\b/i,
      currency: "VES",
    },
    // USDT / USD (e.g. Binance Pay)
    {
      regex: /(?:USDT)\s*:?\s*([\d.,]+)|([\d]+(?:[.,]\d{1,2})?)\s*USDT\b/i,
      currency: "USDT",
    },
    {
      regex: /(?:USD|\$)\s*([\d]+(?:[.,]\d{1,2})?)|([\d]+(?:[.,]\d{1,2})?)\s*USD\b/i,
      currency: "USD",
    },
  ];

  for (const entry of currencyPatterns) {
    const m = text.match(entry.regex);
    if (!m) continue;
    const rawNum = m[1] || m[2];
    if (!rawNum) continue;
    const cents = parseVenezuelanAmountCents(rawNum);
    if (cents && cents > 0) {
      return { amountCents: cents, currency: entry.currency };
    }
  }

  return { amountCents: null, currency: "VES" };
}
