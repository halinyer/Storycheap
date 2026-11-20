import "server-only";

import crypto from "crypto";
import {
  isLoginModeTarget,
  normalizeTargetPayloadMap,
  normalizeTargetSchema,
} from "@/lib/topup-targets";
import type { TargetSchemaField } from "@/types";
import {
  getCentralOneApiKey,
  getCentralOneBaseUrl,
  getCentralOneProxyMode,
  getCentralOneProxyUrl,
  getCentralOneWebhookSecret,
  isCentralOneConfigured,
} from "@/lib/server/env";
import { normalizeExactUsdString, type SupplierBalanceStatus } from "./types";

export interface CentralOneCatalogItem {
  id: string;
  sku?: string;
  name: string;
  category?: string;
  productType?: string;
  productFamilyId?: string;
  productFamilyName?: string;
  region?: string;
  resellerPriceRaw: string;
  resellerPriceCents: number;
  currency: string;
  requiresTarget: boolean;
  targetFields: string[];
  targetSchema: TargetSchemaField[];
  isLoginMode: boolean;
  supportsPlayerValidate?: boolean;
  available: boolean;
}

export interface CentralOnePlayerValidationResult {
  status: "valid" | "invalid" | "unverified";
  playerName: string | null;
  reason?: string | null;
}

export interface CentralOneOrderResult {
  externalOrderId: string;
  referenceCode: string | null;
  status: string;
  deliveredCount: number;
  completedLineCount: number;
  failedLineCount: number;
  refundedLineCount: number;
  refunded: boolean;
  unitCostCents: number | null;
  failureCode?: string | null;
  failureAction?: string | null;
  failureReason?: string | null;
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

type UndiciModule = typeof import("undici");
let cachedProxyUrl: string | null = null;
let cachedProxyAgent: InstanceType<UndiciModule["ProxyAgent"]> | null = null;
let cachedUndiciFetch: UndiciModule["fetch"] | null = null;

// Sticky failover latch: stays 0 (direct, zero Fixie usage) until Central One actually returns 403 ip_not_allowed
const PROXY_FAILOVER_STICKY_MS = 6 * 60 * 60_000;
let proxyFailoverUntilMs = 0;

function isIpNotAllowedResponse(
  status: number,
  parsed: unknown
): boolean {
  if (status !== 403) return false;
  const errObj = (parsed as { error?: { code?: string; message?: string } })?.error;
  const code = String(errObj?.code ?? "").toLowerCase();
  const msg = String(errObj?.message ?? "").toLowerCase();
  return (
    code === "ip_not_allowed" ||
    msg.includes("ip_not_allowed") ||
    msg.includes("allowlist") ||
    msg.includes("ip")
  );
}

async function executeCentralOneHttp(args: {
  useProxy: boolean;
  proxyUrl: string | null;
  targetUrl: string;
  init: RequestInit;
  headers: Headers;
}): Promise<{
  ok: boolean;
  status: number;
  text: string;
  parsed: unknown;
  retryAfter: string | null;
}> {
  const signal =
    args.init.signal ?? AbortSignal.timeout(args.useProxy ? 45_000 : 35_000);
  const response =
    args.useProxy && args.proxyUrl
      ? await fetchViaStaticProxy(args.proxyUrl, args.targetUrl, {
          method: args.init.method,
          headers: args.headers,
          body: args.init.body,
          signal,
        })
      : await fetch(args.targetUrl, {
          ...args.init,
          headers: args.headers,
          cache: "no-store",
          signal,
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
  return {
    ok: response.ok,
    status: response.status,
    text,
    parsed,
    retryAfter: response.headers.get("Retry-After"),
  };
}

async function fetchViaStaticProxy(
  proxyUrl: string,
  url: string,
  init: {
    method?: string;
    headers: Headers;
    body?: RequestInit["body"];
    signal: AbortSignal;
  }
): Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
}> {
  if (!cachedProxyAgent || !cachedUndiciFetch || cachedProxyUrl !== proxyUrl) {
    const undici = await import("undici");
    cachedProxyAgent = new undici.ProxyAgent(proxyUrl);
    cachedUndiciFetch = undici.fetch;
    cachedProxyUrl = proxyUrl;
  }

  const headerRecord: Record<string, string> = {};
  init.headers.forEach((value, key) => {
    headerRecord[key] = value;
  });

  const res = await cachedUndiciFetch(url, {
    method: init.method,
    headers: headerRecord,
    body: init.body as Parameters<UndiciModule["fetch"]>[1] extends { body?: infer B }
      ? B
      : undefined,
    signal: init.signal,
    dispatcher: cachedProxyAgent,
  });

  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    headers: {
      get: (name: string) => res.headers.get(name),
    },
  };
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

  const proxyUrl = getCentralOneProxyUrl();
  const proxyMode =
    typeof getCentralOneProxyMode === "function"
      ? getCentralOneProxyMode()
      : "fallback";
  const targetUrl = `${baseUrl}${path}`;

  const shouldStartWithProxy = Boolean(
    proxyUrl &&
      (proxyMode === "always" ||
        (proxyMode === "fallback" && Date.now() < proxyFailoverUntilMs))
  );

  let attempt = await executeCentralOneHttp({
    useProxy: shouldStartWithProxy,
    proxyUrl,
    targetUrl,
    init,
    headers,
  });

  // Zero-cost standby failover: if Central One suddenly enforces IP Allowlist (403 ip_not_allowed),
  // immediately retry this exact request via Fixie static IPs and latch failover for 6 hours.
  if (
    !attempt.ok &&
    !shouldStartWithProxy &&
    proxyUrl &&
    proxyMode === "fallback" &&
    isIpNotAllowedResponse(attempt.status, attempt.parsed)
  ) {
    proxyFailoverUntilMs = Date.now() + PROXY_FAILOVER_STICKY_MS;
    console.warn(
      "[centralone] Direct IP rejected (403 ip_not_allowed). Automatically failing over to static-IP proxy."
    );
    attempt = await executeCentralOneHttp({
      useProxy: true,
      proxyUrl,
      targetUrl,
      init,
      headers,
    });
  }

  if (!attempt.ok) {
    const errObj = (attempt.parsed as { error?: { code?: string; message?: string } })?.error;
    const code = errObj?.code ?? `http_${attempt.status}`;
    const msg = errObj?.message ?? `Central One HTTP ${attempt.status}`;
    const err = new Error(
      attempt.retryAfter
        ? `${code}: ${msg} (Retry-After ${attempt.retryAfter}s)`
        : `${code}: ${msg}`
    ) as Error & { code?: string; httpStatus?: number };
    err.code = code;
    err.httpStatus = attempt.status;
    throw err;
  }

  return { status: attempt.status, data: attempt.parsed as T };
}

const BALANCE_CACHE_TTL_MS = 5 * 60_000;
let cachedBalanceStatus: { status: SupplierBalanceStatus; fetchedAt: number } | null = null;
let cachedBalanceState: { balanceCents: number | null; fetchedAt: number } | null = null;

const CATALOG_CACHE_TTL_MS = 15 * 60_000;
let cachedCatalogState: { items: CentralOneCatalogItem[]; fetchedAt: number } | null = null;

/** Clears cached Central One balance (e.g., right after creating an order). */
export function invalidateCentralOneBalanceCache(): void {
  cachedBalanceStatus = null;
  cachedBalanceState = null;
}

export async function getCentralOneBalance(options?: {
  forceRefresh?: boolean;
}): Promise<SupplierBalanceStatus> {
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

  const now = Date.now();
  if (
    !options?.forceRefresh &&
    cachedBalanceStatus &&
    now - cachedBalanceStatus.fetchedAt < BALANCE_CACHE_TTL_MS
  ) {
    return cachedBalanceStatus.status;
  }

  try {
    const { data } = await centralOneFetch<Record<string, unknown>>("/balance");
    const rawBalance =
      (data.available_balance as string | undefined) ??
      (data.balance as string | undefined) ??
      (data.amount as string | undefined) ??
      "0";
    const balanceCents = parseCentralOneDecimalToCents(rawBalance);

    const status: SupplierBalanceStatus = {
      configured: true,
      sandbox: false,
      balanceCents,
      exactBalanceUsd: normalizeExactUsdString(rawBalance),
      currency: String(data.currency ?? "USD"),
      healthy: balanceCents !== null,
    };
    if (status.healthy) {
      cachedBalanceStatus = { status, fetchedAt: now };
      cachedBalanceState = { balanceCents, fetchedAt: now };
    }
    return status;
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

/**
 * Returns cached Central One available balance in cents (5-min TTL, immediately
 * invalidated after every purchase) so storefront/admin views stay fast and
 * preserve proxy request quotas.
 */
export async function getCachedCentralOneBalanceCents(): Promise<number | null> {
  if (!isCentralOneConfigured()) return null;
  const now = Date.now();
  if (cachedBalanceState && now - cachedBalanceState.fetchedAt < BALANCE_CACHE_TTL_MS) {
    return cachedBalanceState.balanceCents;
  }
  const status = await getCentralOneBalance();
  return status.healthy ? status.balanceCents : null;
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

const PLAYER_COVERAGE_TTL_MS = 15 * 60_000;
let cachedValidateCoverage: { productIds: Set<string>; fetchedAt: number } | null = null;

const PLAYER_VALIDATE_CACHE_TTL_MS = 5 * 60_000;
const playerValidateCache = new Map<
  string,
  { result: CentralOnePlayerValidationResult; fetchedAt: number }
>();

export function clearCentralOneValidationCachesForTests(): void {
  cachedValidateCoverage = null;
  playerValidateCache.clear();
  cachedBalanceStatus = null;
  cachedBalanceState = null;
  cachedCatalogState = null;
  proxyFailoverUntilMs = 0;
}

export async function getCentralOnePlayerValidateCoverage(): Promise<Set<string>> {
  if (!isCentralOneConfigured()) return new Set();
  const now = Date.now();
  if (
    cachedValidateCoverage &&
    now - cachedValidateCoverage.fetchedAt < PLAYER_COVERAGE_TTL_MS
  ) {
    return cachedValidateCoverage.productIds;
  }

  try {
    const { data } = await centralOneFetch<{
      products?: Array<{ product_id?: string; catalog_item_id?: string; id?: string }>;
    }>("/player/validate/coverage");
    const ids = new Set<string>();
    for (const p of data.products ?? []) {
      const id = String(p.product_id ?? p.catalog_item_id ?? p.id ?? "").trim();
      if (id) ids.add(id);
    }
    cachedValidateCoverage = { productIds: ids, fetchedAt: now };
    return ids;
  } catch {
    return cachedValidateCoverage?.productIds ?? new Set();
  }
}

export async function validateCentralOnePlayer(params: {
  productId: string;
  targetPayload: Record<string, string>;
}): Promise<CentralOnePlayerValidationResult> {
  if (!isCentralOneConfigured()) {
    return {
      status: "unverified",
      playerName: null,
      reason: "centralone_not_configured",
    };
  }

  const cleanPayload = normalizeTargetPayloadMap(params.targetPayload);
  const cacheKey = `${params.productId}::${JSON.stringify(cleanPayload)}`;
  const now = Date.now();
  const cached = playerValidateCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < PLAYER_VALIDATE_CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    const { data } = await centralOneFetch<Record<string, unknown>>("/player/validate", {
      method: "POST",
      body: JSON.stringify({
        product_id: params.productId,
        target_payload: cleanPayload,
      }),
    });

    const rawStatus = String(data.status ?? "unverified").toLowerCase();
    const playerObj =
      data.player && typeof data.player === "object"
        ? (data.player as Record<string, unknown>)
        : null;
    const playerName =
      typeof playerObj?.name === "string" && playerObj.name.trim()
        ? playerObj.name.trim()
        : null;
    const reason =
      typeof data.reason === "string" && data.reason.trim()
        ? data.reason.trim()
        : null;

    const result: CentralOnePlayerValidationResult =
      rawStatus === "valid"
        ? { status: "valid", playerName, reason: null }
        : rawStatus === "invalid"
          ? { status: "invalid", playerName: null, reason }
          : { status: "unverified", playerName: null, reason };

    if (result.status !== "unverified" || reason === "not_supported") {
      playerValidateCache.set(cacheKey, { result, fetchedAt: now });
      if (playerValidateCache.size > 500) {
        const oldestKey = playerValidateCache.keys().next().value;
        if (oldestKey) playerValidateCache.delete(oldestKey);
      }
    }

    return result;
  } catch (err) {
    const e = err as Error & { code?: string; httpStatus?: number };
    if (e.httpStatus === 429 || e.code === "rate_limited") {
      return {
        status: "unverified",
        playerName: null,
        reason: "rate_limited",
      };
    }
    return {
      status: "unverified",
      playerName: null,
      reason: e.code ?? "temporarily_unavailable",
    };
  }
}

export async function getCentralOneCatalog(options?: {
  forceRefresh?: boolean;
}): Promise<CentralOneCatalogItem[]> {
  const now = Date.now();
  if (
    !options?.forceRefresh &&
    cachedCatalogState &&
    now - cachedCatalogState.fetchedAt < CATALOG_CACHE_TTL_MS
  ) {
    return cachedCatalogState.items;
  }

  const [{ data }, coverageIds] = await Promise.all([
    centralOneFetch<Record<string, unknown> | Array<Record<string, unknown>>>(
      "/catalog"
    ),
    getCentralOnePlayerValidateCoverage().catch(() => new Set<string>()),
  ]);

  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data.items)
      ? (data.items as Array<Record<string, unknown>>)
      : Array.isArray(data.products)
        ? (data.products as Array<Record<string, unknown>>)
        : [];

  const items = rows
    .map((item) => {
      const id = String(item.catalog_item_id ?? item.product_id ?? item.id ?? "").trim();
      const rawPrice = String(item.reseller_price ?? item.price ?? "0");
      const cents = parseCentralOneDecimalToCents(rawPrice) ?? 0;
      const isStatusActive =
        typeof item.status === "string"
          ? item.status.toLowerCase() === "active"
          : item.active !== false;
      const rawTargetFields = Array.isArray(item.target_fields)
        ? (item.target_fields as unknown[])
            .map((k) => String(k ?? "").trim())
            .filter(Boolean)
        : [];
      const rawTargetSchema = Array.isArray(item.target_schema)
        ? (item.target_schema as Array<Record<string, unknown>>)
        : [];
      const targetSchema = normalizeTargetSchema(rawTargetFields, rawTargetSchema);
      const targetFields =
        rawTargetFields.length > 0
          ? rawTargetFields
          : targetSchema.map((f) => f.key);
      const requiresTarget = Boolean(item.requires_target) || targetSchema.length > 0;
      const name = String(item.name ?? item.title ?? item.product_name ?? id);
      const isLoginMode =
        requiresTarget && isLoginModeTarget(targetFields, targetSchema, name);

      return {
        id,
        sku: typeof item.sku === "string" ? item.sku : undefined,
        name,
        category: typeof item.category === "string" ? item.category : undefined,
        productType:
          typeof item.product_type === "string" ? item.product_type : undefined,
        productFamilyId:
          typeof item.product_family_id === "string"
            ? item.product_family_id
            : undefined,
        productFamilyName:
          typeof item.product_family_name === "string"
            ? item.product_family_name
            : undefined,
        region: typeof item.region === "string" ? item.region : undefined,
        resellerPriceRaw: rawPrice,
        resellerPriceCents: cents,
        currency: String(item.currency ?? "USD"),
        requiresTarget,
        targetFields,
        targetSchema,
        isLoginMode,
        supportsPlayerValidate: requiresTarget && coverageIds.has(id),
        available: item.in_stock !== false && isStatusActive,
      };
    })
    .filter((item) => item.id.length > 0);

  if (items.length > 0) {
    cachedCatalogState = { items, fetchedAt: now };
  }
  return items;
}

function extractCentralOneFailure(
  obj: Record<string, unknown> | undefined
): { code: string | null; action: string | null; message: string | null } | null {
  if (!obj || typeof obj !== "object") return null;
  const f = obj.failure as Record<string, unknown> | null | undefined;
  if (!f || typeof f !== "object") return null;
  const msgEs = typeof f.message_es === "string" ? f.message_es.trim() : "";
  const msg = typeof f.message === "string" ? f.message.trim() : "";
  const code = typeof f.code === "string" ? f.code.trim() : "";
  const action = typeof f.action === "string" ? f.action.trim() : "";
  const message = msgEs || msg || code || null;
  if (!message && !code) return null;
  return {
    code: code || null,
    action: action || null,
    message,
  };
}

function normalizeCentralOneOrderResponse(
  raw: Record<string, unknown>,
  expectedQuantity = 1
): CentralOneOrderResult {
  const orderObj =
    raw.order && typeof raw.order === "object"
      ? (raw.order as Record<string, unknown>)
      : raw;

  // Central One GET /orders/{id} may return `items[]` (v1 official) or `lines[]` (legacy/webhook).
  const lines = Array.isArray(orderObj.items)
    ? (orderObj.items as Array<Record<string, unknown>>)
    : Array.isArray(orderObj.lines)
      ? (orderObj.lines as Array<Record<string, unknown>>)
      : [];

  const deliveredCount = lines.reduce(
    (sum, line) => sum + Number(line.delivered_count ?? 0),
    0
  );

  let completedLineCount = 0;
  let failedLineCount = 0;
  let refundedLineCount = 0;
  for (const line of lines) {
    const lineStatus = String(line.status ?? "").toLowerCase();
    const lineQty = Math.max(1, Number(line.quantity ?? 1) || 1);
    if (lineStatus === "completed" || lineStatus === "delivered") {
      completedLineCount += lineQty;
    } else if (lineStatus === "failed" || lineStatus === "cancelled") {
      failedLineCount += lineQty;
    } else if (lineStatus === "refunded") {
      refundedLineCount += lineQty;
    }
  }

  const firstLine = lines[0];
  const rawUnitPrice =
    (firstLine?.unit_sale_price as string | number | undefined) ??
    (firstLine?.unit_price as string | number | undefined) ??
    (firstLine?.reseller_price as string | number | undefined);
  let unitCostCents = parseCentralOneDecimalToCents(rawUnitPrice);
  if (unitCostCents === null) {
    const totalSaleCents = parseCentralOneDecimalToCents(
      orderObj.total_sale_amount as string | number | undefined
    );
    const totalLineQty =
      lines.reduce((sum, l) => sum + (Number(l.quantity ?? 1) || 1), 0) ||
      expectedQuantity;
    const divisor = Math.max(1, totalLineQty);
    unitCostCents =
      totalSaleCents !== null ? Math.round(totalSaleCents / divisor) : null;
  }

  const orderRefund =
    orderObj.refund && typeof orderObj.refund === "object"
      ? (orderObj.refund as Record<string, unknown>)
      : null;
  const refunded = Boolean(orderRefund?.refunded) || refundedLineCount > 0;

  const failureInfo =
    extractCentralOneFailure(orderObj) ??
    lines
      .map(extractCentralOneFailure)
      .find((f): f is NonNullable<ReturnType<typeof extractCentralOneFailure>> =>
        Boolean(f)
      ) ??
    null;

  return {
    externalOrderId: String(orderObj.id ?? ""),
    referenceCode: orderObj.reference_code ? String(orderObj.reference_code) : null,
    status: String(orderObj.status ?? "confirmed").toLowerCase(),
    deliveredCount,
    completedLineCount,
    failedLineCount,
    refundedLineCount,
    refunded,
    unitCostCents,
    failureCode: failureInfo?.code ?? null,
    failureAction: failureInfo?.action ?? null,
    failureReason: failureInfo?.message ?? null,
    raw,
  };
}

export async function createCentralOneOrder(params: {
  idempotencyKey: string;
  catalogItemId: string;
  quantity: number;
  externalReference?: string;
  targetPayload?: Record<string, string> | null;
  expectedUnitPrice?: number;
}): Promise<CentralOneOrderResult> {
  const cleanTarget = params.targetPayload
    ? normalizeTargetPayloadMap(params.targetPayload)
    : null;
  const hasTarget = Boolean(cleanTarget && Object.keys(cleanTarget).length > 0);
  const priceField =
    typeof params.expectedUnitPrice === "number" &&
    Number.isFinite(params.expectedUnitPrice) &&
    params.expectedUnitPrice >= 0
      ? { expected_unit_price: Number(params.expectedUnitPrice.toFixed(4)) }
      : {};

  // Per Central One v1 docs, direct top-up products may reject quantity > 1
  // (`quantity_not_supported`); send separate quantity:1 lines automatically.
  const orderItems =
    hasTarget && params.quantity > 1
      ? Array.from({ length: Math.min(20, params.quantity) }, () => ({
          catalog_item_id: params.catalogItemId,
          quantity: 1,
          target_payload: cleanTarget!,
          ...priceField,
        }))
      : [
          {
            catalog_item_id: params.catalogItemId,
            quantity: params.quantity,
            ...(hasTarget ? { target_payload: cleanTarget! } : {}),
            ...priceField,
          },
        ];

  const { data } = await centralOneFetch<Record<string, unknown>>("/orders", {
    method: "POST",
    headers: {
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      items: orderItems,
      ...(params.externalReference ? { note: params.externalReference } : {}),
    }),
  });

  return normalizeCentralOneOrderResponse(data, params.quantity);
}

export async function getCentralOneOrder(
  externalOrderId: string
): Promise<CentralOneOrderResult> {
  const { data } = await centralOneFetch<Record<string, unknown>>(
    `/orders/${encodeURIComponent(externalOrderId)}`
  );
  return normalizeCentralOneOrderResponse(data);
}

function collectCentralOneCodeEntries(
  entries: unknown[],
  out: CentralOneOrderCode[]
): void {
  for (const entry of entries) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+-\s+/);
      out.push({
        codePlaintext: parts[0] ?? trimmed,
        pinPlaintext: parts[1] ?? null,
      });
      continue;
    }

    if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      // Official GET /orders/{id}/codes nests `codes: ["..."]` per order_line_id.
      if (Array.isArray(obj.codes)) {
        collectCentralOneCodeEntries(obj.codes, out);
        continue;
      }

      const rawCode = String(obj.code ?? obj.pin ?? obj.value ?? "").trim();
      if (!rawCode) continue;
      const pinVal = obj.serial ?? obj.pin_code ?? null;
      if (!pinVal && rawCode.includes(" - ")) {
        const [first, second] = rawCode.split(/\s+-\s+/);
        out.push({
          codePlaintext: first ?? rawCode,
          pinPlaintext: second ?? null,
        });
      } else {
        out.push({
          codePlaintext: rawCode,
          pinPlaintext: pinVal ? String(pinVal) : null,
        });
      }
    }
  }
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
      : Array.isArray(root.lines)
        ? root.lines
        : Array.isArray(root.items)
          ? (root.items as Array<Record<string, unknown>>).flatMap((line) =>
              Array.isArray(line.codes) ? line.codes : [line]
            )
          : [];

  const parsed: CentralOneOrderCode[] = [];
  collectCentralOneCodeEntries(rawEntries, parsed);
  return parsed;
}

export interface CentralOneApiOrderSummary {
  id: string;
  referenceCode: string | null;
  status: string;
  totalSaleCents: number;
  currency: string;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CentralOneOrdersReport {
  configured: boolean;
  healthy: boolean;
  errorMessage?: string;
  orders: CentralOneApiOrderSummary[];
  totalSpentCents: number;
  completedCount: number;
}

const CENTRALONE_SETTLED_ORDER_STATUSES = new Set([
  "delivered",
  "partially_delivered",
  "partially_completed",
  "completed",
  "confirmed",
  "processing",
]);

export async function listCentralOneOrders(limit = 50): Promise<CentralOneOrdersReport> {
  if (!isCentralOneConfigured()) {
    return {
      configured: false,
      healthy: false,
      errorMessage: "CENTRAL_ONE_API_KEY no configurada en el servidor.",
      orders: [],
      totalSpentCents: 0,
      completedCount: 0,
    };
  }

  try {
    // Docs GET /orders allows limit 1..50 (default 20).
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const { data } = await centralOneFetch<Record<string, unknown>>(
      `/orders?limit=${safeLimit}`
    );
    const rawOrders = Array.isArray(data.orders)
      ? (data.orders as Array<Record<string, unknown>>)
      : Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
        : [];

    const orders: CentralOneApiOrderSummary[] = rawOrders.map((o) => {
      const grossCents =
        parseCentralOneDecimalToCents(
          (o.total_sale_amount as string | number | undefined) ??
            (o.total_usd as string | number | undefined)
        ) ?? 0;
      const refundObj =
        o.refund && typeof o.refund === "object"
          ? (o.refund as Record<string, unknown>)
          : null;
      const refundCents = refundObj?.refunded
        ? (parseCentralOneDecimalToCents(
            refundObj.amount as string | number | undefined
          ) ?? 0)
        : 0;
      const totalSaleCents = Math.max(0, grossCents - refundCents);
      const status = String(o.status ?? "unknown").toLowerCase();
      return {
        id: String(o.id ?? ""),
        referenceCode: o.reference_code ? String(o.reference_code) : null,
        status,
        totalSaleCents,
        currency: String(o.currency ?? "USD"),
        lineCount: Number(o.line_count ?? 1) || 1,
        createdAt: String(o.created_at ?? ""),
        updatedAt: String(o.updated_at ?? o.created_at ?? ""),
      };
    });

    const settled = orders.filter((o) => CENTRALONE_SETTLED_ORDER_STATUSES.has(o.status));
    const totalSpentCents = settled.reduce((sum, o) => sum + o.totalSaleCents, 0);

    return {
      configured: true,
      healthy: true,
      orders,
      totalSpentCents,
      completedCount: settled.length,
    };
  } catch (err) {
    return {
      configured: true,
      healthy: false,
      errorMessage:
        err instanceof Error ? err.message : "Error consultando GET /orders en Central One",
      orders: [],
      totalSpentCents: 0,
      completedCount: 0,
    };
  }
}

function timingSafeHexSignatureMatch(expectedHex: string, headerValue: string): boolean {
  const provided = headerValue.trim().replace(/^sha256=/i, "").toLowerCase();
  if (provided.length !== expectedHex.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(provided, "utf8"),
    Buffer.from(expectedHex, "utf8")
  );
}

export function verifyCentralOneWebhookSignature(params: {
  rawBody: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  previousSignatureHeader?: string | null;
  nowMs?: number;
}): { valid: boolean; reason?: string } {
  const secret = getCentralOneWebhookSecret();
  if (!secret) {
    return { valid: false, reason: "CENTRAL_ONE_WEBHOOK_SECRET not configured" };
  }
  if (!params.timestampHeader || (!params.signatureHeader && !params.previousSignatureHeader)) {
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

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${tsSeconds}.${params.rawBody}`)
    .digest("hex")
    .toLowerCase();

  const candidates = [params.signatureHeader, params.previousSignatureHeader].filter(
    (s): s is string => Boolean(s && s.trim().length > 0)
  );
  const valid = candidates.some((headerVal) => timingSafeHexSignatureMatch(expected, headerVal));
  return valid ? { valid: true } : { valid: false, reason: "Invalid HMAC signature" };
}
