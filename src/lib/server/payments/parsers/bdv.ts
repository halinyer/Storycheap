import { findBankCodeInText } from "@/lib/catalog-banks";
import { buildParsedResult } from "./bancamiga";
import type { ParsedBankNotification, ParseNotificationInput } from "./types";

/**
 * Parser tailored to Banco de Venezuela (0102) notifications from BDVApp /
 * BDV Digital / PagomóvilBDV push alerts as well as SMS/Email backups.
 */
export function parseBdvNotification(
  input: ParseNotificationInput
): ParsedBankNotification {
  const fullText = [input.title, input.content].filter(Boolean).join("\n").trim();
  const looksLikeBdv =
    input.preferredBankCode === "0102" ||
    findBankCodeInText(fullText) === "0102" ||
    /pagom[oó]vil\s*bdv|\bbdv\b|bancodevenezuela/i.test(
      `${input.appPackage ?? ""} ${fullText}`
    );

  return buildParsedResult({
    fullText,
    parserUsed: input.sourceType === "APP_PUSH" ? "bdv_app_v1" : "bdv_v1",
    bankHint: "0102",
    ownBankCode: "0102",
    allowUnlabeledDigitsFallback: looksLikeBdv,
  });
}
