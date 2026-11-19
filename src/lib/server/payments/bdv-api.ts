import "server-only";

import { getBdvApiBaseUrl, getBdvApiKey } from "@/lib/server/env";

export interface BdvGetMovementRequest {
  cedulaPagador: string;
  telefonoPagador: string;
  telefonoDestino: string;
  referencia: string;
  fechaPago: string;
  importe: string;
  bancoOrigen: string;
}

export interface BdvMovementVerificationResult {
  verified: boolean;
  code: number | null;
  httpStatus: number;
  message: string;
  amountBsCents: number | null;
  rawAmount: string | null;
  reason: string | null;
  notFound: boolean;
  authError: boolean;
  requestPayload: BdvGetMovementRequest;
  rawResponse: Record<string, unknown> | null;
}

export class BdvGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 502, code = "BDV_API_ERROR") {
    super(message);
    this.name = "BdvGatewayError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Normalizes a Venezuelan ID into BDV's exact contract format: "V27037606"
 * (uppercase letter prefix V/E/J/G/P + digits, no dashes or dots).
 */
export function normalizeBdvCedula(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[\s.\-_]/g, "");
  if (!cleaned) return null;

  const withPrefix = cleaned.match(/^([VEJGP])(\d{5,11})$/);
  if (withPrefix) {
    return `${withPrefix[1]}${withPrefix[2]}`;
  }

  const digitsOnly = cleaned.match(/^(\d{5,10})$/);
  if (digitsOnly) {
    return `V${digitsOnly[1]}`;
  }

  return null;
}

/**
 * Normalizes a Venezuelan mobile number into BDV's exact 11-digit format: "04127141363".
 */
export function normalizeBdvPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length === 11 && /^04(12|14|16|22|24|26)\d{7}$/.test(digits)) {
    return digits;
  }
  if (digits.length === 10 && /^4(12|14|16|22|24|26)\d{7}$/.test(digits)) {
    return `0${digits}`;
  }
  if (
    digits.length === 12 &&
    /^584(12|14|16|22|24|26)\d{7}$/.test(digits)
  ) {
    return `0${digits.slice(2)}`;
  }
  // Fallback for valid 11-digit 04XX numbers (future Venezuelan prefixes)
  if (digits.length === 11 && digits.startsWith("04")) {
    return digits;
  }
  if (digits.length === 10 && digits.startsWith("4")) {
    return `0${digits}`;
  }
  return null;
}

/**
 * Normalizes Venezuelan 4-digit SUDEBAN bank code (e.g. "0102", "0134").
 */
export function normalizeBdvBankCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 4 && digits.startsWith("0")) {
    return digits;
  }
  return null;
}

/**
 * Normalizes bank reference digits for BDV `referencia` field.
 */
export function normalizeBdvReference(raw: string): string {
  return raw.trim().replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/**
 * Formats integer Bs cents into BDV's exact decimal string ("120.00", dot separator).
 */
export function formatBdvImporte(bsCents: number): string {
  const safe = Math.max(0, Math.round(bsCents));
  const whole = Math.floor(safe / 100);
  const cents = safe % 100;
  return `${whole}.${String(cents).padStart(2, "0")}`;
}

/**
 * Parses BDV response `data.amount` (e.g. "120.00", "10", "1250.5") into integer Bs cents.
 */
export function parseBdvAmountToBsCents(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(/\s+/g, "");
  if (!text) return null;

  // Handle "1.250,50" or "1,250.50" or "120.00" or "10"
  let normalized = text;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text)) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{1,2}$/.test(text)) {
    normalized = text.replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(text)) {
    normalized = text.replace(/,/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [wholePart = "0", fracPart = ""] = normalized.split(".");
  const paddedFrac = fracPart.padEnd(3, "0");
  const centsDigits = paddedFrac.slice(0, 2);
  const roundDigit = Number.parseInt(paddedFrac[2] ?? "0", 10);
  let total =
    Number.parseInt(wholePart, 10) * 100 + Number.parseInt(centsDigits, 10);
  if (roundDigit >= 5) total += 1;
  return Number.isFinite(total) && total >= 0 ? total : null;
}

/**
 * Parses customer-entered Bs amount string ("120.00", "120,50", "1.080,00") into integer Bs cents.
 */
export function parseUserBsInputToCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw)
    .trim()
    .replace(/^Bs\.?\s*/i, "")
    .replace(/\s+/g, "");
  return parseBdvAmountToBsCents(cleaned);
}

/**
 * Returns `YYYY-MM-DD` in Venezuela local time (`America/Caracas`, UTC-4)
 * so midnight crossovers match BDV Core Bancario's business date.
 */
export function getVenezuelaDateYmd(date: Date | number | string = new Date()): string {
  const d =
    date instanceof Date
      ? date
      : typeof date === "number"
        ? new Date(date)
        : new Date(date);
  const valid = Number.isFinite(d.getTime()) ? d : new Date();

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Caracas",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(valid);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {
    // Fallback to fixed UTC-4 offset (Venezuela does not observe DST)
  }

  const veMs = valid.getTime() - 4 * 60 * 60_000;
  const veDate = new Date(veMs);
  const y = veDate.getUTCFullYear();
  const m = String(veDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(veDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isValidYmdDate(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw.trim());
}

/**
 * Calls Banco de Venezuela's official API Conciliación (`POST /getMovement`, MDU-006).
 * Strictly enforces all 7 mandatory fields and `X-API-Key` header.
 */
export async function verifyBdvMovement(params: {
  cedulaPagador: string;
  telefonoPagador: string;
  telefonoDestino: string;
  referencia: string;
  fechaPago: string;
  importeBsCents: number;
  bancoOrigen: string;
  apiKeyOverride?: string;
  endpointOverride?: string;
}): Promise<BdvMovementVerificationResult> {
  const apiKey = params.apiKeyOverride?.trim() || getBdvApiKey();
  if (!apiKey) {
    throw new BdvGatewayError(
      "BDV_API_KEY no está configurada en el servidor.",
      503,
      "BDV_NOT_CONFIGURED"
    );
  }

  const endpoint = params.endpointOverride?.trim() || getBdvApiBaseUrl();

  const cedula = normalizeBdvCedula(params.cedulaPagador);
  const telPagador = normalizeBdvPhone(params.telefonoPagador);
  const telDestino = normalizeBdvPhone(params.telefonoDestino);
  const bankCode = normalizeBdvBankCode(params.bancoOrigen);
  const ref = normalizeBdvReference(params.referencia);
  const fecha = params.fechaPago.trim();

  if (!cedula) {
    throw new BdvGatewayError("Cédula del pagador inválida (ej. V27037606).", 400, "INVALID_CEDULA");
  }
  if (!telPagador) {
    throw new BdvGatewayError("Teléfono pagador inválido (ej. 04121234567).", 400, "INVALID_PHONE");
  }
  if (!telDestino) {
    throw new BdvGatewayError("Teléfono destino BDV no configurado correctamente.", 500, "INVALID_RECEIVER_PHONE");
  }
  if (!bankCode) {
    throw new BdvGatewayError("Código de banco de origen inválido (ej. 0102).", 400, "INVALID_BANK");
  }
  if (ref.length < 4) {
    throw new BdvGatewayError("Número de referencia bancaria inválido.", 400, "INVALID_REFERENCE");
  }
  if (!isValidYmdDate(fecha)) {
    throw new BdvGatewayError("Fecha de pago inválida (formato YYYY-MM-DD).", 400, "INVALID_DATE");
  }
  if (!Number.isFinite(params.importeBsCents) || params.importeBsCents <= 0) {
    throw new BdvGatewayError("El monto en Bs debe ser mayor a 0.", 400, "INVALID_AMOUNT");
  }

  const requestPayload: BdvGetMovementRequest = {
    cedulaPagador: cedula,
    telefonoPagador: telPagador,
    telefonoDestino: telDestino,
    referencia: ref,
    fechaPago: fecha,
    importe: formatBdvImporte(params.importeBsCents),
    bancoOrigen: bankCode,
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(requestPayload),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new BdvGatewayError(
      isTimeout
        ? "Banco de Venezuela tardó demasiado en responder. Intenta nuevamente en unos segundos."
        : "No se pudo conectar con el servicio de conciliación del Banco de Venezuela.",
      504,
      isTimeout ? "BDV_TIMEOUT" : "BDV_NETWORK_ERROR"
    );
  }

  const rawText = await res.text().catch(() => "");
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }

  const codeNum =
    parsed && parsed.code !== undefined && parsed.code !== null
      ? Number(parsed.code)
      : null;
  const message =
    (typeof parsed?.message === "string" && parsed.message.trim()) ||
    (typeof parsed?.error === "string" && parsed.error.trim()) ||
    `Respuesta HTTP ${res.status} del Banco de Venezuela`;

  const authError =
    res.status === 401 ||
    res.status === 403 ||
    /no afiliado|unauthorized|api.?key/i.test(message);

  const dataObj =
    parsed?.data && typeof parsed.data === "object"
      ? (parsed.data as Record<string, unknown>)
      : null;

  const isSuccess =
    res.ok &&
    codeNum === 1000 &&
    dataObj !== null &&
    (dataObj.status === undefined ||
      dataObj.status === null ||
      String(dataObj.status) === "1000");

  if (isSuccess) {
    const rawAmount =
      dataObj?.amount !== undefined && dataObj?.amount !== null
        ? String(dataObj.amount)
        : null;
    const parsedBsCents =
      parseBdvAmountToBsCents(rawAmount) ?? params.importeBsCents;
    const reason =
      typeof dataObj?.reason === "string" ? dataObj.reason : "Transaccion realizada";

    return {
      verified: true,
      code: 1000,
      httpStatus: res.status,
      message,
      amountBsCents: parsedBsCents,
      rawAmount,
      reason,
      notFound: false,
      authError: false,
      requestPayload,
      rawResponse: parsed,
    };
  }

  const notFound =
    !authError &&
    (codeNum === 1010 || /no existe|no se pudo validar/i.test(message));

  return {
    verified: false,
    code: Number.isFinite(codeNum) ? codeNum : null,
    httpStatus: res.status,
    message,
    amountBsCents: null,
    rawAmount: null,
    reason: null,
    notFound,
    authError,
    requestPayload,
    rawResponse: parsed,
  };
}
