export interface SkuMismatchReport {
  severity: "ok" | "warn" | "critical";
  denominationMismatch: boolean;
  marginIssue: "loss" | "extreme_markup" | null;
  storeNumbers: number[];
  supplierNumbers: number[];
  suggestedLabel: string | null;
  messages: string[];
}

/**
 * Extracts significant numeric values (denomination amounts, diamond counts, USD values)
 * while ignoring percentages (like "10%") so label-to-SKU checks stay accurate.
 */
export function extractDenominationNumbers(text: string): number[] {
  if (!text) return [];
  const withoutPercents = text.replace(/\d+(?:[.,]\d+)?\s*%/g, " ");
  const matches = withoutPercents.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const nums: number[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/,/g, "");
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) {
      nums.push(parsed);
    }
  }
  return Array.from(new Set(nums));
}

/**
 * Produces a concise, store-ready denomination label from a supplier product name
 * by removing redundant brand prefixes and "· PIN" suffixes.
 */
export function suggestDenominationLabel(
  supplierName: string,
  productName?: string
): string | null {
  const clean = supplierName
    .replace(/\s*·\s*PIN\b/gi, "")
    .replace(/\s*\((?:LATAM|USA|GLOBAL|EU|BR|CIS|MX|CO)\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return null;

  if (productName) {
    const baseBrand = productName.split(/[(·]/)[0]?.trim() ?? "";
    const brandWords = baseBrand
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !["pin", "gift", "card", "usa", "latam"].includes(w));

    let stripped = clean;
    for (const word of brandWords) {
      stripped = stripped.replace(new RegExp(`^${word}\\b[:\\s·-]*`, "i"), "").trim();
    }
    if (stripped.length >= 2) {
      return stripped.slice(0, 40);
    }
  }

  return clean.slice(0, 40);
}

/**
 * Compares what the storefront sells (`denominationLabel`, `saleUsd`) against
 * what Central One will actually deliver (`supplierName`, `supplierSku`, `costUsd`).
 */
export function evaluateSkuAlignment(params: {
  denominationLabel: string;
  productName?: string;
  supplierName?: string | null;
  supplierSku?: string | null;
  costUsd?: number | null;
  saleUsd?: number | null;
}): SkuMismatchReport {
  const messages: string[] = [];
  let denominationMismatch = false;
  let marginIssue: "loss" | "extreme_markup" | null = null;

  const storeNumbers = extractDenominationNumbers(params.denominationLabel);
  const supplierText = [params.supplierName ?? "", params.supplierSku ?? ""].join(" ").trim();
  const supplierNumbers = extractDenominationNumbers(supplierText);

  if (
    params.supplierName &&
    storeNumbers.length > 0 &&
    supplierNumbers.length > 0
  ) {
    const hasMatch = storeNumbers.some((n) => supplierNumbers.includes(n));
    if (!hasMatch) {
      denominationMismatch = true;
      messages.push(
        `Tu tienda dice "${params.denominationLabel}", pero Central One entregará "${params.supplierName}".`
      );
    }
  }

  if (
    typeof params.costUsd === "number" &&
    Number.isFinite(params.costUsd) &&
    typeof params.saleUsd === "number" &&
    Number.isFinite(params.saleUsd) &&
    params.saleUsd > 0
  ) {
    if (params.costUsd > params.saleUsd) {
      marginIssue = "loss";
      messages.push(
        `Costo ($${params.costUsd.toFixed(4)}) supera la venta ($${params.saleUsd.toFixed(2)}): venderías a pérdida.`
      );
    } else if (params.costUsd >= 0.35 && params.saleUsd / params.costUsd >= 2.8) {
      marginIssue = "extreme_markup";
      messages.push(
        `El precio de venta ($${params.saleUsd.toFixed(2)}) es ${(params.saleUsd / params.costUsd).toFixed(1)}x el costo ($${params.costUsd.toFixed(4)}): revisa que no sea un monto mayor vinculado a un SKU menor.`
      );
    }
  }

  const severity: SkuMismatchReport["severity"] =
    denominationMismatch || marginIssue === "loss"
      ? "critical"
      : marginIssue === "extreme_markup"
        ? "warn"
        : "ok";

  const suggestedLabel = params.supplierName
    ? suggestDenominationLabel(params.supplierName, params.productName)
    : null;

  return {
    severity,
    denominationMismatch,
    marginIssue,
    storeNumbers,
    supplierNumbers,
    suggestedLabel,
    messages,
  };
}
