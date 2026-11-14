import "server-only";
import crypto from "crypto";
import {
  getFazerCardsApiKey,
  getFazerCardsBaseUrl,
  getFazerCardsWebhookSecret,
  isFazerCardsConfigured,
} from "../env";
import {
  parseCentralOneDecimalToCents,
  type CentralOneCatalogItem,
} from "./centralone";
import type { SupplierBalanceStatus } from "./types";

export const FAZERCARDS_PRODUCT_PREFIX = "fazer:";

export function isFazerCardsProductId(id?: string | null): boolean {
  return Boolean(id && id.trim().toLowerCase().startsWith(FAZERCARDS_PRODUCT_PREFIX));
}

/**
 * Parses a FazerCards product identifier stored in `centralone_product_id`
 * Format: `fazer:<category_id>:<card_id>`
 */
export function parseFazerCardsProductId(
  id: string
): { categoryId: string; cardId: string } | null {
  if (!isFazerCardsProductId(id)) return null;
  const raw = id.trim().slice(FAZERCARDS_PRODUCT_PREFIX.length);
  const sepIndex = raw.indexOf(":");
  if (sepIndex <= 0 || sepIndex >= raw.length - 1) return null;
  const categoryId = raw.slice(0, sepIndex).trim();
  const cardId = raw.slice(sepIndex + 1).trim();
  if (!categoryId || !cardId) return null;
  return { categoryId, cardId };
}

export function formatFazerCardsProductId(categoryId: string, cardId: string): string {
  return `${FAZERCARDS_PRODUCT_PREFIX}${categoryId.trim()}:${cardId.trim()}`;
}

export interface FazerCardsGiftCardCategory {
  category_id: string;
  name: string;
  note?: string;
  imageurl?: string | null;
}

export interface FazerCardsGiftCardOffer {
  card_id: string | null;
  name: string;
  price_usd: string;
  stock: number;
  min_order_quantity: number;
  max_order_quantity: number;
}

export interface FazerCardsOrderResource {
  id: string;
  kind?: "gift_card" | "topup" | "game_topup" | string;
  status: "created" | "processing" | "completed" | "failed" | "refund" | string;
  category_id?: string | null;
  category_name?: string | null;
  card_id?: string | null;
  item_name?: string;
  quantity?: number;
  price_usd_per_unit?: string;
  total_usd?: string;
  created_at?: string;
  completed_at?: string | null;
  cards?: string[];
  keys?: string[];
  fail_reason?: string | null;
}

let cachedBalanceCents: { value: number | null; expiresAt: number } | null = null;

export function invalidateFazerCardsBalanceCache() {
  cachedBalanceCents = null;
}

async function fazerRequest<T = any>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    idempotencyKey?: string;
  } = {}
): Promise<T> {
  const apiKey = getFazerCardsApiKey();
  if (!apiKey) {
    throw new Error("FAZERCARDS_API_KEY no configurada en el servidor.");
  }
  const baseUrl = getFazerCardsBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    "X-API-Key": apiKey,
    Accept: "application/json",
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`FazerCards non-JSON response (${res.status}): ${text.slice(0, 180)}`);
  }

  if (!res.ok || json?.ok === false) {
    const errMsg =
      json?.error?.message ||
      json?.message ||
      `FazerCards API error (${res.status})`;
    throw new Error(errMsg);
  }

  return json as T;
}

export async function getFazerCardsBalance(): Promise<SupplierBalanceStatus> {
  if (!isFazerCardsConfigured()) {
    return {
      configured: false,
      sandbox: false,
      balanceCents: null,
      currency: "USD",
      healthy: false,
      errorMessage: "FAZERCARDS_API_KEY no configurada en el servidor.",
    };
  }

  try {
    const data = await fazerRequest<{ ok?: boolean; balance: string | number; currency?: string }>(
      "/balance"
    );
    const cents = parseCentralOneDecimalToCents(data.balance);
    if (cents !== null) {
      cachedBalanceCents = {
        value: cents,
        expiresAt: Date.now() + 60_000,
      };
    }
    return {
      configured: true,
      sandbox: false,
      balanceCents: cents ?? 0,
      currency: data.currency || "USD",
      healthy: true,
    };
  } catch (err: any) {
    return {
      configured: true,
      sandbox: false,
      balanceCents: null,
      currency: "USD",
      healthy: false,
      errorMessage: err?.message || "Error al consultar GET /balance en FazerCards",
    };
  }
}

export async function getCachedFazerCardsBalanceCents(): Promise<number | null> {
  if (!isFazerCardsConfigured()) return null;
  if (cachedBalanceCents && Date.now() < cachedBalanceCents.expiresAt) {
    return cachedBalanceCents.value;
  }
  const res = await getFazerCardsBalance();
  if (!res.healthy || typeof res.balanceCents !== "number") {
    cachedBalanceCents = { value: null, expiresAt: Date.now() + 15_000 };
    return null;
  }
  return res.balanceCents;
}

export async function getFazerCardsCategories(params?: {
  limit?: number;
  cursor?: string;
}): Promise<{
  items: FazerCardsGiftCardCategory[];
  hasMore: boolean;
  nextCursor?: string;
}> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params?.limit ?? 100));
  if (params?.cursor) qs.set("cursor", params.cursor);

  const data = await fazerRequest<{
    items?: FazerCardsGiftCardCategory[];
    meta?: { has_more?: boolean; next_cursor?: string };
  }>(`/giftcards?${qs.toString()}`);

  return {
    items: Array.isArray(data.items) ? data.items : [],
    hasMore: Boolean(data.meta?.has_more),
    nextCursor: data.meta?.next_cursor,
  };
}

export async function getFazerCardsCategoryOffers(categoryId: string): Promise<{
  categoryId: string;
  name: string;
  offers: FazerCardsGiftCardOffer[];
}> {
  const qs = new URLSearchParams({ category_id: categoryId });
  const data = await fazerRequest<{
    category_id?: string;
    name?: string;
    offers?: FazerCardsGiftCardOffer[];
  }>(`/giftcards/cards?${qs.toString()}`);

  return {
    categoryId: data.category_id || categoryId,
    name: data.name || categoryId,
    offers: Array.isArray(data.offers) ? data.offers : [],
  };
}

/**
 * Fetches FazerCards Gift Card categories & offers and maps them into the unified
 * `CentralOneCatalogItem` shape so the Admin SKU selector works seamlessly with 1 click.
 */
export async function getFazerCardsCatalog(query?: string): Promise<CentralOneCatalogItem[]> {
  if (!isFazerCardsConfigured()) {
    return [];
  }

  const allCategories: FazerCardsGiftCardCategory[] = [];
  let cursor: string | undefined = undefined;
  for (let page = 0; page < 4; page++) {
    const res = await getFazerCardsCategories({ limit: 100, cursor });
    allCategories.push(...res.items);
    if (!res.hasMore || !res.nextCursor) break;
    cursor = res.nextCursor;
  }

  const q = (query || "").trim().toLowerCase();
  const priorityKeywords = [
    "netflix",
    "playstation",
    "psn",
    "nintendo",
    "xbox",
    "steam",
    "spotify",
    "apple",
    "itunes",
    "roblox",
    "free fire",
    "razer",
    "amazon",
    "google play",
  ];

  const matchingCategories = q
    ? allCategories.filter((c) =>
        `${c.name} ${c.category_id} ${c.note ?? ""}`.toLowerCase().includes(q)
      )
    : allCategories.filter((c) => {
        const hay = `${c.name} ${c.category_id}`.toLowerCase();
        return priorityKeywords.some((kw) => hay.includes(kw));
      });

  const targetCategories = (
    matchingCategories.length > 0 ? matchingCategories : allCategories
  ).slice(0, 24);

  const items: CentralOneCatalogItem[] = [];
  const batchSize = 6;
  for (let i = 0; i < targetCategories.length; i += batchSize) {
    const slice = targetCategories.slice(i, i + batchSize);
    const offerResults = await Promise.allSettled(
      slice.map((cat) => getFazerCardsCategoryOffers(cat.category_id))
    );
    for (let j = 0; j < offerResults.length; j++) {
      const result = offerResults[j];
      const cat = slice[j];
      if (result.status !== "fulfilled" || !cat) continue;
      for (const offer of result.value.offers) {
        if (!offer.card_id) continue;
        const priceCents = parseCentralOneDecimalToCents(offer.price_usd) ?? 0;
        if (priceCents <= 0) continue;
        const compositeId = formatFazerCardsProductId(cat.category_id, offer.card_id);
        items.push({
          id: compositeId,
          sku: `FZR:${cat.category_id}:${offer.card_id}`,
          name: `${cat.name} — ${offer.name}`,
          region: `FazerCards · Stock: ${offer.stock}`,
          resellerPriceRaw: String(offer.price_usd),
          resellerPriceCents: priceCents,
          currency: "USD",
          requiresTarget: false,
          available: offer.stock > 0,
        });
      }
    }
  }

  return items;
}

function extractCodesFromOrder(order: FazerCardsOrderResource | null | undefined): string[] {
  if (!order) return [];
  const rawCodes = [
    ...(Array.isArray(order.cards) ? order.cards : []),
    ...(Array.isArray(order.keys) ? order.keys : []),
  ];
  return rawCodes
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean);
}

function normalizeFazerStatus(
  status?: string | null
): "COMPLETED" | "PENDING" | "FAILED" {
  const s = (status || "").toLowerCase();
  if (s === "completed" || s === "delivered" || s === "success") return "COMPLETED";
  if (s === "failed" || s === "refund" || s === "cancelled" || s === "canceled") return "FAILED";
  return "PENDING";
}

export async function createFazerCardsGiftCardOrder(input: {
  fazerProductId: string;
  quantity: number;
  customIdentifier: string;
}): Promise<{
  externalOrderId: string;
  rawOrderId: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
  unitCostCents: number;
  codes: string[];
  failReason?: string | null;
  rawResponse: Record<string, unknown>;
}> {
  const parsed = parseFazerCardsProductId(input.fazerProductId);
  if (!parsed) {
    throw new Error(
      `ID FazerCards inválido "${input.fazerProductId}". Formato esperado: "fazer:<category_id>:<card_id>".`
    );
  }

  const data = await fazerRequest<{ ok?: boolean; order?: FazerCardsOrderResource }>(
    "/giftcards/order",
    {
      method: "POST",
      idempotencyKey: input.customIdentifier,
      body: {
        category_id: parsed.categoryId,
        card_id: parsed.cardId,
        quantity: input.quantity,
      },
    }
  );

  invalidateFazerCardsBalanceCache();

  const order: FazerCardsOrderResource = (data?.order ?? (data as any)) as FazerCardsOrderResource;
  if (!order?.id) {
    throw new Error("La respuesta de FazerCards no incluyó un ID de orden.");
  }

  const unitCents = parseCentralOneDecimalToCents(order.price_usd_per_unit);
  const totalCents = parseCentralOneDecimalToCents(order.total_usd);
  const unitCostCents =
    unitCents && unitCents > 0
      ? unitCents
      : totalCents && totalCents > 0 && input.quantity > 0
      ? Math.round(totalCents / input.quantity)
      : 0;

  return {
    externalOrderId: `${FAZERCARDS_PRODUCT_PREFIX}${order.id}`,
    rawOrderId: order.id,
    status: normalizeFazerStatus(order.status),
    unitCostCents,
    codes: extractCodesFromOrder(order),
    failReason: order.fail_reason ?? null,
    rawResponse: data as Record<string, unknown>,
  };
}

export async function getFazerCardsOrder(externalOrRawOrderId: string): Promise<{
  externalOrderId: string;
  rawOrderId: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
  codes: string[];
  failReason?: string | null;
  rawResponse: Record<string, unknown>;
}> {
  const rawOrderId = externalOrRawOrderId.startsWith(FAZERCARDS_PRODUCT_PREFIX)
    ? externalOrRawOrderId.slice(FAZERCARDS_PRODUCT_PREFIX.length)
    : externalOrRawOrderId;

  const data = await fazerRequest<{ ok?: boolean; order?: FazerCardsOrderResource }>(
    `/orders/${encodeURIComponent(rawOrderId)}`
  );

  const order: FazerCardsOrderResource = (data?.order ?? (data as any)) as FazerCardsOrderResource;
  return {
    externalOrderId: `${FAZERCARDS_PRODUCT_PREFIX}${order?.id || rawOrderId}`,
    rawOrderId: order?.id || rawOrderId,
    status: normalizeFazerStatus(order?.status),
    codes: extractCodesFromOrder(order),
    failReason: order?.fail_reason ?? null,
    rawResponse: data as Record<string, unknown>,
  };
}

export function verifyFazerCardsWebhookSignature(
  rawBody: string,
  signatureHeader?: string | null
): boolean {
  const secret = getFazerCardsWebhookSecret();
  if (!secret || !signatureHeader) return false;

  const trimmed = signatureHeader.trim();
  const hexSig = trimmed.toLowerCase().startsWith("sha256=")
    ? trimmed.slice(7)
    : trimmed;

  if (!/^[0-9a-f]{64}$/i.test(hexSig)) return false;

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(hexSig, "hex"),
      Buffer.from(expectedHex, "hex")
    );
  } catch {
    return false;
  }
}
