import { parseBancamigaNotification } from "./bancamiga";
import { parseBdvNotification } from "./bdv";
import type { ParsedBankNotification, ParseNotificationInput } from "./types";
import { parseGenericVenezuelanNotification } from "./venezuela-generic";

export type { ParsedBankNotification, ParseNotificationInput } from "./types";
export { parseVenezuelanAmountCents, extractAmountAndCurrency } from "./amount";

export function parseBankNotification(
  input: ParseNotificationInput
): ParsedBankNotification {
  const combined = `${input.appPackage ?? ""} ${input.title ?? ""} ${input.content}`.toLowerCase();

  if (
    input.preferredBankCode === "0172" ||
    combined.includes("bancamiga") ||
    combined.includes("0172")
  ) {
    return parseBancamigaNotification(input);
  }

  if (
    input.preferredBankCode === "0102" ||
    combined.includes("bancodevenezuela") ||
    combined.includes("banco de venezuela") ||
    combined.includes("pagomovilbdv") ||
    combined.includes("pagomóvilbdv") ||
    combined.includes("bdv") ||
    combined.includes("0102")
  ) {
    return parseBdvNotification(input);
  }

  return parseGenericVenezuelanNotification(input);
}
