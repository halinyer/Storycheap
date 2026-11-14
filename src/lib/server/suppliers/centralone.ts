import "server-only";

import crypto from "crypto";
import {
  getCentralOneApiKey,
  getCentralOneBaseUrl,
  getCentralOneWebhookSecret,
  isCentralOneConfigured,
} from "@/lib/server/env";
import type { SupplierBalanceStatus } from "./types";

export interface CentralOneCatalogItem {
  id: string;
  sku?: string;
  name: string;
  region?: string;
  resellerPriceRaw: string;
  resellerPriceCents: number;
  currency: string;
  requiresTarget: boolean;
  available: boolean;
}

export interface CentralOneOrderResult {
  externalOrderId: string;
  referenceCode: string | null;
  status: string;
  deliveredCount: number;
  unitCostCents: number | null;
  raw: Record<string, unknown>;
}

export interface CentralOneOrderCode {
  codePlaintext: string;
  pinPlaintext: string | null;
}

/**
 * Parses a decimal money string (e.g. "470.0000" or "9.3050") into integer cents
 * without floating-point precision loss.
 */
export function parseCentralOneDecimalToCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [wholePart = "0", fracPart = ""] = unsigned.split(".");
  const paddedFrac = fracPart.padEnd(4, "0");
  const centsDigits = paddedFrac.slice(0, 2);
  const roundDigit = Number.parseInt(paddedFrac[2] ?? "0", 10);

  let totalCents = Number.parseInt(wholePart, 10) * 100 + Number.parseInt(centsDigits, 10);
  if (roundDigit >= 5) {
    totalCents += 1;
  }
  return negative ? -totalCents : totalCents;
}

async function centralOneFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; data: T }> {
  const apiKey = getCentralOneApiKey();
  if (!apiKey) {
    throw new Error("CENTRAL_ONE_API_KEY is not configured");
  }

  const baseUrl = getCentralOneBaseUrl();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!response.ok) {
    const errObj = (parsed as { error?: { code?: string; message?: string } })?.error;
    const code = errObj?.code ?? `http_${response.status}`;
    const msg = errObj?.message ?? `Central One HTTP ${response.status}`;
    const retryAfter = response.headers.get("Retry-After");
    const err = new Error(
      retryAfter ? `${code}: ${msg} (Retry-After ${retryAfter}s)` : `${code}: ${msg}`
    ) as Error & { code?: string; httpStatus?: number };
    err.code = code;
    err.httpStatus = response.status;
    throw err;
  }

  return { status: response.status, data: parsed as T };
}

export async function getCentralOneBalance(): Promise<SupplierBalanceStatus> {
  if (!isCentralOneConfigured()) {
    return {
      configured: false,
      sandbox: false,
      balanceCents: null,
      currency: "USD",
      healthy: false,
      errorMessage: "CENTRAL_ONE_API_KEY no configurada en el servidor.",
    };
  }

  try {
    const { data } = await centralOneFetch<Record<string, unknown>>("/balance");
    const rawBalance =
      (data.available_balance as string | undefined) ??
      (data.balance as string | undefined) ??
      (data.amount as string | undefined) ??
      "0";
    const balanceCents = parseCentralOneDecimalToCents(rawBalance);

    return {
      configured: true,
      sandbox: false,
      balanceCents,
      currency: String(data.currency ?? "USD"),
      healthy: balanceCents !== null,
    };
  } catch (err) {
    return {
      configured: true,
      sandbox: false,
      balanceCents: null,
      currency: "USD",
      healthy: false,
      errorMessage: err instanceof Error ? err.message : "Error consultando Central One",
    };
  }
}

const BALANCE_CACHE_TTL_MS = 15_000;
let cachedBalanceState: { balanceCents: number | null; fetchedAt: number } | null = null;

/** Clears cached Central One balance (e.g., right after creating an order). */
export function invalidateCentralOneBalanceCache(): void {
  cachedBalanceState = null;
}

/**
 * Returns cached Central One available balance in cents (15s TTL) so catalog
 * views stay fast while accurately reflecting zero-balance out-of-stock states.
 */
export async function getCachedCentralOneBalanceCents(): Promise<number | null> {
  if (!isCentralOneConfigured()) return null;
  const now = Date.now();
  if (cachedBalanceState && now - cachedBalanceState.fetchedAt < BALANCE_CACHE_TTL_MS) {
    return cachedBalanceState.balanceCents;
  }
  const status = await getCentralOneBalance();
  const value = status.healthy ? status.balanceCents : null;
  if (status.healthy) {
    cachedBalanceState = { balanceCents: value, fetchedAt: now };
  }
  return value;
}

/**
 * Computes how many units of a variant can be purchased from Central One given
 * a wallet balance in cents and optional 4-decimal unit cost ("0.6901").
 */
export function computeCentralOneUnitCapacity(
  balanceCents: number | null,
  unitCostCents: number | null | undefined,
  exactCostUsd?: string | null
): number | null {
  if (balanceCents === null || balanceCents <= 0) return 0;

  let costTenthsOfCent: number | null = null;
  if (exactCostUsd && /^\d+(\.\d+)?$/.test(exactCostUsd.trim())) {
    const parsed = Number.parseFloat(exactCostUsd.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      costTenthsOfCent = Math.round(parsed * 10_000);
    }
  }
  if (costTenthsOfCent === null && typeof unitCostCents === "number" && unitCostCents > 0) {
    costTenthsOfCent = unitCostCents * 100;
  }
  if (costTenthsOfCent === null || costTenthsOfCent <= 0) {
    return null;
  }

  return Math.floor((balanceCents * 100) / costTenthsOfCent);
}

export async function getCentralOneCatalog(): Promise<CentralOneCatalogItem[]> {
  const { data } = await centralOneFetch<
    Record<string, unknown> | Array<Record<string, unknown>>
  >("/catalog");

  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data.items)
      ? (data.items as Array<Record<string, unknown>>)
      : Array.isArray(data.products)
        ? (data.products as Array<Record<string, unknown>>)
        : [];

  return rows
    .map((item) => {
      const id = String(item.catalog_item_id ?? item.product_id ?? item.id ?? "").trim();
      const rawPrice = String(item.reseller_price ?? item.price ?? "0");
      const cents = parseCentralOneDecimalToCents(rawPrice) ?? 0;
      const isStatusActive =
        typeof item.status === "string"
          ? item.status.toLowerCase() === "active"
          : item.active !== false;
      return {
        id,
        sku: typeof item.sku === "string" ? item.sku : undefined,
        name: String(item.name ?? item.title ?? item.product_name ?? id),
        region: typeof item.region === "string" ? item.region : undefined,
        resellerPriceRaw: rawPrice,
        resellerPriceCents: cents,
        currency: String(item.currency ?? "USD"),
        requiresTarget: Boolean(item.requires_target),
        available: item.in_stock !== false && isStatusActive,
      };
    })
    .filter((item) => item.id.length > 0);
}

function normalizeCentralOneOrderResponse(raw: Record<string, unknown>): CentralOneOrderResult {
  const orderObj =
    raw.order && typeof raw.order === "object"
      ? (raw.order as Record<string, unknown>)
      : raw;

  const lines = Array.isArray(orderObj.items)
    ? (orderObj.items as Array<Record<string, unknown>>)
    : [];

  const deliveredCount = lines.reduce(
    (sum, line) => sum + Number(line.delivered_count ?? 0),
    0
  );

  const firstLine = lines[0];
  const unitCostCents =
    parseCentralOneDecimalToCents(
      (firstLine?.reseller_price as string | undefined) ??
        (firstLine?.unit_price as string | undefined) ??
        (orderObj.total_sale_amount as string | undefined)
    ) ?? null;

  return {
    externalOrderId: String(orderObj.id ?? ""),
    referenceCode: orderObj.reference_code ? String(orderObj.reference_code) : null,
    status: String(orderObj.status ?? "confirmed").toLowerCase(),
    deliveredCount,
    unitCostCents,
    raw,
  };
}

export async function createCentralOneOrder(params: {
  idempotencyKey: string;
  catalogItemId: string;
  quantity: number;
  externalReference?: string;
}): Promise<CentralOneOrderResult> {
  const { data } = await centralOneFetch<Record<string, unknown>>("/orders", {
    method: "POST",
    headers: {
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      items: [
        {
          catalog_item_id: params.catalogItemId,
          quantity: params.quantity,
        },
      ],
      ...(params.externalReference ? { external_reference: params.externalReference } : {}),
    }),
  });

  return normalizeCentralOneOrderResponse(data);
}

export async function getCentralOneOrder(
  externalOrderId: string
): Promise<CentralOneOrderResult> {
  const { data } = await centralOneFetch<Record<string, unknown>>(
    `/orders/${encodeURIComponent(externalOrderId)}`
  );
  return normalizeCentralOneOrderResponse(data);
}

export async function getCentralOneOrderCodes(
  externalOrderId: string
): Promise<CentralOneOrderCode[]> {
  const { data } = await centralOneFetch<
    Record<string, unknown> | Array<Record<string, unknown>>
  >(`/orders/${encodeURIComponent(externalOrderId)}/codes`);

  const root =
    !Array.isArray(data) &&
    data.order &&
    typeof data.order === "object"
      ? (data.order as Record<string, unknown>)
      : data;

  const rawEntries: unknown[] = Array.isArray(root)
    ? root
    : Array.isArray(root.codes)
      ? root.codes
      : Array.isArray(root.items)
        ? (root.items as Array<Record<string, unknown>>).flatMap((line) =>
            Array.isArray(line.codes) ? line.codes : [line]
          )
        : [];

  const parsed: CentralOneOrderCode[] = [];
  for (const entry of rawEntries) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+-\s+/);
      parsed.push({
        codePlaintext: parts[0] ?? trimmed,
        pinPlaintext: parts[1] ?? null,
      });
      continue;
    }

    if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const rawCode = String(obj.code ?? obj.pin ?? obj.value ?? "").trim();
      if (!rawCode) continue;
      const pinVal = obj.serial ?? obj.pin_code ?? null;
      if (!pinVal && rawCode.includes(" - ")) {
        const [first, second] = rawCode.split(/\s+-\s+/);
        parsed.push({
          codePlaintext: first ?? rawCode,
          pinPlaintext: second ?? null,
        });
      } else {
        parsed.push({
          codePlaintext: rawCode,
          pinPlaintext: pinVal ? String(pinVal) : null,
        });
      }
    }
  }

  return parsed;
}

export function verifyCentralOneWebhookSignature(params: {
  rawBody: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  nowMs?: number;
}): { valid: boolean; reason?: string } {
  const secret = getCentralOneWebhookSecret();
  if (!secret) {
    return { valid: false, reason: "CENTRAL_ONE_WEBHOOK_SECRET not configured" };
  }
  if (!params.timestampHeader || !params.signatureHeader) {
    return { valid: false, reason: "Missing signature headers" };
  }

  const tsSeconds = Number.parseInt(params.timestampHeader.trim(), 10);
  if (!Number.isFinite(tsSeconds)) {
    return { valid: false, reason: "Invalid timestamp" };
  }

  const nowSeconds = Math.floor((params.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - tsSeconds) > 300) {
    return { valid: false, reason: "Timestamp outside 5-minute replay window" };
  }

  const provided = params.signatureHeader.trim().replace(/^sha256=/i, "").toLowerCase();
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${tsSeconds}.${params.rawBody}`)
    .digest("hex")
    .toLowerCase();

  if (provided.length !== expected.length) {
    return { valid: false, reason: "Signature length mismatch" };
  }

  const valid = crypto.timingSafeEqual(
    Buffer.from(provided, "utf8"),
    Buffer.from(expected, "utf8")
  );
  return valid ? { valid: true } : { valid: false, reason: "Invalid HMAC signature" };
}
