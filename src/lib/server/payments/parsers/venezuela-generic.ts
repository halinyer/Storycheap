import { findBankCodeInText } from "@/lib/catalog-banks";
import { buildParsedResult } from "./bancamiga";
import type { ParsedBankNotification, ParseNotificationInput } from "./types";

export function parseGenericVenezuelanNotification(
  input: ParseNotificationInput
): ParsedBankNotification {
  const fullText = [input.title, input.content].filter(Boolean).join("\n").trim();
  const detectedBank = findBankCodeInText(fullText) ?? input.preferredBankCode ?? null;
  const parserUsed =
    detectedBank === "0102"
      ? "bdv_generic"
      : detectedBank === "0134"
        ? "banesco_generic"
        : detectedBank === "0105"
          ? "mercantil_generic"
          : "venezuela_generic";

  return buildParsedResult({
    fullText,
    parserUsed,
    bankHint: detectedBank,
    ownBankCode: input.preferredBankCode ?? detectedBank,
  });
}
