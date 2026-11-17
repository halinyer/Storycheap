import { findBankCodeInText, normalizeVePhone } from "@/lib/catalog-banks";
import { extractAmountAndCurrency } from "./amount";
import type { ParsedBankNotification, ParseNotificationInput } from "./types";

const OUTGOING_PATTERNS = [
  /\brealizaste\b/i,
  /\benviaste\b/i,
  /\bhas\s+enviado\b/i,
  /\bpago\s+enviado\b/i,
  /\bpagom[oó]vil\s*(?:bdv)?\s+enviado\b/i,
  /\bpago\s+realizado\b/i,
  /\btransferencia\s+enviada\b/i,
  /\btransferiste\b/i,
  /\bd[eé]bito\s+(?:a|por|en|de)\b/i,
  /\bse\s+debit[oó]\b/i,
  /\bretiro\b/i,
  /\bcompra\s+(?:aprobada|en|por)\b/i,
  /\bconsumo\b/i,
  /\bcargo\s+a\s+tu\b/i,
];

const INCOMING_PATTERNS = [
  /\brecibiste\b/i,
  /\bhas\s+recibido\b/i,
  /\bpago\s*m[oó]vil\s*(?:bdv\s+)?recibid[oa]\b/i,
  /\bpor\s+concepto\s+de\s+pagom[oó]vil\s*bdv\b/i,
  /\bpago\s+recibido\b/i,
  /\btransferencia\s+recibida\b/i,
  /\babono\b/i,
  /\bacreditad[oa]\b/i,
  /\bse\s+ha\s+acreditado\b/i,
  /\bacreditaci[oó]n\b/i,
  /\bcr[eé]dito\s+(?:a|en|por)\b/i,
  /\bte\s+envi[oó]\b/i,
  /\bingreso\b/i,
  /\brecibido\b/i,
];

export function detectIncomingDirection(fullText: string): {
  isIncoming: boolean;
  reason: string | null;
} {
  const hasIncoming = INCOMING_PATTERNS.some((re) => re.test(fullText));
  const hasOutgoing = OUTGOING_PATTERNS.some((re) => re.test(fullText));

  if (hasOutgoing && !hasIncoming) {
    return {
      isIncoming: false,
      reason: "Movimiento saliente / débito detectado (ignorado para acreditación)",
    };
  }
  return { isIncoming: true, reason: null };
}

export function extractReferenceDigits(
  text: string,
  options?: { allowUnlabeledDigitsFallback?: boolean }
): string | null {
  const patterns = [
    /(?:(?:Nro\.?|N[uú]mero)\s*(?:de\s*)?)?(?:Ref(?:erencia)?|Comprobante|Confirmaci[oó]n|Secuencia|Operaci[oó]n|Movimiento|Serial|Clave|Autorizaci[oó]n|ID\s*(?:Tx|Transacci[oó]n)?)\s*(?:Nro\.?|N[uú]mero|No\.?|#|:|\.)*\s*([A-Z0-9-]{4,28})/i,
    /#\s*(\d{4,20})\b/,
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (!m?.[1]) continue;
    if (/^\d{2,4}[-/]\d{2}[-/]\d{2,4}$/.test(m[1])) continue;
    const digitsOnly = m[1].replace(/\D/g, "");
    if (digitsOnly.length >= 4 && digitsOnly.length <= 24) {
      return digitsOnly;
    }
    const alnum = m[1].replace(/[^A-Za-z0-9]/g, "");
    if (alnum.length >= 6) {
      return alnum;
    }
  }

  if (options?.allowUnlabeledDigitsFallback) {
    // Strip phones, cedulas, bank codes and amounts before looking for a bare 6..16 digit reference
    const scrubbed = text
      .replace(/\b(?:\+?58[\s-]?)?0?4(?:12|14|16|24|26)[\s-]?\d{3}[\s-]?\d{4}\b/g, " ")
      .replace(/\b[VEJGP][-\s]?\d{5,10}\b/gi, " ")
      .replace(/\b01\d{2}\b/g, " ")
      .replace(/\d{1,3}(?:[.,]\d{3})*[.,]\d{2}/g, " ");
    const bare = scrubbed.match(/\b(\d{6,16})\b/);
    if (bare?.[1]) {
      return bare[1];
    }
  }

  return null;
}

export function extractSenderFields(
  text: string,
  ownBankCode?: string | null
): {
  senderPhone: string | null;
  senderDni: string | null;
  senderBankCode: string | null;
} {
  // Phone: prefer labeled sender/origin phone, else any VE mobile number in text
  const labeledPhone = text.match(
    /(?:Tel[eé]fono(?:\s+(?:origen|pagador|emisor|cliente))?|Celular|Desde|De)\s*:?\s*(\+?58?\s*0?4(?:12|14|16|24|26)[\s-]?\d{3}[\s-]?\d{4})/i
  );
  const genericPhone = text.match(
    /\b((?:\+?58[\s-]?)?0?4(?:12|14|16|24|26)[\s-]?\d{3}[\s-]?\d{4})\b/
  );
  const senderPhone = normalizeVePhone(labeledPhone?.[1] ?? genericPhone?.[1] ?? null);

  const dniMatch = text.match(/\b([VEJGP])[-\s]?(\d{5,10})\b/i);
  const senderDni = dniMatch
    ? `${dniMatch[1].toUpperCase()}-${dniMatch[2]}`
    : null;

  // Try explicit origin bank mention before falling back to generic text search
  const originBankLabeled = text.match(
    /(?:Banco\s+(?:origen|emisor)|Desde\s+(?:el\s+)?(?:banco\s+)?|Banco)\s*:?\s*([A-Za-zÀ-ÿ0-9\s]{3,40})/i
  );
  let senderBankCode = originBankLabeled
    ? findBankCodeInText(originBankLabeled[1])
    : null;
  if (!senderBankCode) {
    // Avoid mistaking the receiver bank header ("Bancamiga te informa...") for the sender bank
    senderBankCode = findBankCodeInText(text, ownBankCode);
  }

  return { senderPhone, senderDni, senderBankCode };
}

export function buildParsedResult(args: {
  fullText: string;
  parserUsed: string;
  bankHint: string | null;
  ownBankCode?: string | null;
  allowUnlabeledDigitsFallback?: boolean;
}): ParsedBankNotification {
  const direction = detectIncomingDirection(args.fullText);
  const { amountCents, currency } = extractAmountAndCurrency(args.fullText);
  const referenceFull = extractReferenceDigits(args.fullText, {
    allowUnlabeledDigitsFallback: args.allowUnlabeledDigitsFallback,
  });
  const { senderPhone, senderDni, senderBankCode } = extractSenderFields(
    args.fullText,
    args.ownBankCode
  );

  if (!direction.isIncoming) {
    return {
      matched: false,
      isIncomingPayment: false,
      directionReason: direction.reason ?? undefined,
      bankHint: args.bankHint,
      amountBsCents: amountCents,
      currency,
      referenceFull,
      referenceLast6: referenceFull ? referenceFull.slice(-6) : null,
      referenceLast4: referenceFull ? referenceFull.slice(-4) : null,
      senderPhone,
      senderDni,
      senderBankCode,
      confidence: "high",
      parserUsed: args.parserUsed,
      failureReason: direction.reason,
    };
  }

  if (!amountCents || !referenceFull) {
    const missing: string[] = [];
    if (!amountCents) missing.push("monto");
    if (!referenceFull) missing.push("referencia");
    return {
      matched: false,
      isIncomingPayment: true,
      bankHint: args.bankHint,
      amountBsCents: amountCents,
      currency,
      referenceFull,
      referenceLast6: referenceFull ? referenceFull.slice(-6) : null,
      referenceLast4: referenceFull ? referenceFull.slice(-4) : null,
      senderPhone,
      senderDni,
      senderBankCode,
      confidence: "low",
      parserUsed: args.parserUsed,
      failureReason: `No se pudo extraer: ${missing.join(" y ")}.`,
    };
  }

  return {
    matched: true,
    isIncomingPayment: true,
    bankHint: args.bankHint,
    amountBsCents: amountCents,
    currency,
    referenceFull,
    referenceLast6: referenceFull.slice(-6),
    referenceLast4: referenceFull.slice(-4),
    senderPhone,
    senderDni,
    senderBankCode,
    confidence: senderPhone || senderBankCode ? "high" : "medium",
    parserUsed: args.parserUsed,
    failureReason: null,
  };
}

export function parseBancamigaNotification(
  input: ParseNotificationInput
): ParsedBankNotification {
  const fullText = [input.title, input.content].filter(Boolean).join("\n").trim();
  return buildParsedResult({
    fullText,
    parserUsed: "bancamiga_v1",
    bankHint: "0172",
    ownBankCode: "0172",
  });
}
