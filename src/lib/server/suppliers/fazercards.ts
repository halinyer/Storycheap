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
import { normalizeExactUsdString, type SupplierBalanceStatus } from "./types";

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
let cachedCategories: { items: FazerCardsGiftCardCategory[]; expiresAt: number } | null = null;

export function invalidateFazerCardsBalanceCache() {
  cachedBalanceCents = null;
}

async function fazerRequest<T = Record<string, unknown>>(
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
    signal: AbortSignal.timeout(8000),
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`FazerCards non-JSON response (${res.status}): ${text.slice(0, 180)}`);
  }

  if (!res.ok || json.ok === false) {
    const errObj =
      json.error && typeof json.error === "object"
        ? (json.error as { message?: unknown })
        : null;
    const errMsg =
      (typeof errObj?.message === "string" && errObj.message) ||
      (typeof json.message === "string" && json.message) ||
      `FazerCards API error (${res.status})`;
    throw new Error(errMsg);
  }

  return json as unknown as T;
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
      exactBalanceUsd: normalizeExactUsdString(data.balance),
      currency: data.currency || "USD",
      healthy: true,
    };
  } catch (err: unknown) {
    return {
      configured: true,
      sandbox: false,
      balanceCents: null,
      currency: "USD",
      healthy: false,
      errorMessage:
        err instanceof Error
          ? err.message
          : "Error al consultar GET /balance en FazerCards",
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

const FAZER_SEARCH_FILLER_TOKENS = new Set([
  "gift",
  "card",
  "cards",
  "tarjeta",
  "tarjetas",
  "store",
  "tienda",
  "pin",
  "pins",
  "voucher",
  "digital",
  "codigo",
  "codigos",
  "code",
  "codes",
  "wallet",
  "eshop",
  "network",
  "usd",
]);

const FAZER_PRIORITY_KEYWORDS = [
  "netflix",
  "disney",
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

const FAZER_ALIAS_MAP: Record<string, string[]> = {
  usa: ["us", "usa"],
  eeuu: ["us", "usa"],
  psn: ["playstation", "psn"],
  ps4: ["playstation"],
  ps5: ["playstation"],
  spain: ["es", "spain"],
  espana: ["es"],
  europa: ["eu", "es", "fr", "de", "it", "pt"],
  uk: ["uk", "gb"],
  gb: ["uk", "gb"],
  latam: ["latam", "ar", "br", "cl", "co", "mx", "pe", "uy"],
};

function normalizeFazerSearchText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function splitFazerCardsSearchQuery(query?: string): {
  categoryTokens: string[];
  offerTokens: string[];
  numericTokens: string[];
} {
  const normalized = normalizeFazerSearchText(query ?? "");
  const rawTokens = normalized
    .replace(/[()[\]{}·:_/\\|,-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^\$/, "").trim())
    .filter(Boolean);

  const numericTokens: string[] = [];
  const textTokens: string[] = [];
  for (const token of rawTokens) {
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      numericTokens.push(token);
    } else {
      textTokens.push(token);
    }
  }

  const nonFiller = textTokens.filter((t) => !FAZER_SEARCH_FILLER_TOKENS.has(t));
  const categoryTokens = nonFiller.length > 0 ? nonFiller : textTokens;
  const offerTokens = [...categoryTokens, ...numericTokens];
  return { categoryTokens, offerTokens, numericTokens };
}

function getFazerRegionPriorityBoost(cat: FazerCardsGiftCardCategory): number {
  const hay = normalizeFazerSearchText(`${cat.category_id} ${cat.name}`);
  if (/(?:^|[_\s(])us(?:$|[_\s)])/i.test(hay) || /\busa\b/i.test(hay)) {
    return 90;
  }
  if (/(?:^|[_\s(])global(?:$|[_\s)])/i.test(hay)) {
    return 70;
  }
  if (/(?:^|[_\s(])(?:es|mx|co|cl|ar|br|latam)(?:$|[_\s)])/i.test(hay)) {
    return 40;
  }
  if (/(?:^|[_\s(])(?:uk|gb|ca|eu)(?:$|[_\s)])/i.test(hay)) {
    return 25;
  }
  return 0;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreTokenAgainstCategory(
  token: string,
  idAndNameNorm: string,
  noteNorm: string
): number {
  const candidates = FAZER_ALIAS_MAP[token] ?? [token];
  let best = 0;

  for (const cand of candidates) {
    const wordBoundary = new RegExp(`(?:^|[\\s_()\\[\\]·:-])${escapeRegex(cand)}(?:$|[\\s_()\\[\\]·:-])`, "i");
    if (wordBoundary.test(idAndNameNorm)) {
      best = Math.max(best, cand.length <= 2 ? 120 : 100);
    } else if (idAndNameNorm.includes(cand)) {
      // Short 2-letter tokens (like "us") match inside "austria"/"music"/"russia"; keep low unless bounded
      best = Math.max(best, cand.length <= 2 ? 4 : 60);
    } else if (wordBoundary.test(noteNorm)) {
      best = Math.max(best, 30);
    } else if (cand.length > 2 && noteNorm.includes(cand)) {
      best = Math.max(best, 15);
    }
  }

  return best;
}

export function selectFazerCardsCategoriesForQuery(
  allCategories: FazerCardsGiftCardCategory[],
  query?: string,
  limit = 48
): Array<{ category: FazerCardsGiftCardCategory; score: number }> {
  const { categoryTokens } = splitFazerCardsSearchQuery(query);

  if (categoryTokens.length === 0) {
    const prioritized = allCategories
      .map((cat) => {
        const hay = normalizeFazerSearchText(`${cat.name} ${cat.category_id}`);
        const isPopular = FAZER_PRIORITY_KEYWORDS.some((kw) => hay.includes(kw));
        if (!isPopular) return null;
        return {
          category: cat,
          score: 100 + getFazerRegionPriorityBoost(cat),
        };
      })
      .filter((entry): entry is { category: FazerCardsGiftCardCategory; score: number } => Boolean(entry))
      .sort((a, b) => b.score - a.score || a.category.name.localeCompare(b.category.name));

    const source =
      prioritized.length > 0
        ? prioritized
        : allCategories.map((category) => ({
            category,
            score: getFazerRegionPriorityBoost(category),
          }));
    return source.slice(0, limit);
  }

  const strictMatches: Array<{ category: FazerCardsGiftCardCategory; score: number }> = [];
  const partialMatches: Array<{ category: FazerCardsGiftCardCategory; score: number }> = [];

  for (const cat of allCategories) {
    const idAndNameNorm = normalizeFazerSearchText(`${cat.name} ${cat.category_id}`);
    const noteNorm = normalizeFazerSearchText(cat.note ?? "");
    let matchedCount = 0;
    let totalScore = 0;

    for (const token of categoryTokens) {
      const tokenScore = scoreTokenAgainstCategory(token, idAndNameNorm, noteNorm);
      if (tokenScore > 0) {
        matchedCount += 1;
        totalScore += tokenScore;
      }
    }

    if (matchedCount === 0) continue;
    const regionBoost = getFazerRegionPriorityBoost(cat);
    const entry = { category: cat, score: totalScore + regionBoost };
    if (matchedCount === categoryTokens.length) {
      strictMatches.push(entry);
    } else {
      partialMatches.push(entry);
    }
  }

  const chosen = strictMatches.length > 0 ? strictMatches : partialMatches;
  if (chosen.length === 0) {
    return allCategories
      .map((category) => ({ category, score: getFazerRegionPriorityBoost(category) }))
      .sort((a, b) => b.score - a.score || a.category.name.localeCompare(b.category.name))
      .slice(0, Math.min(limit, 24));
  }

  return chosen
    .sort((a, b) => b.score - a.score || a.category.name.localeCompare(b.category.name))
    .slice(0, limit);
}

/**
 * Fetches FazerCards Gift Card categories & offers and maps them into the unified
 * `CentralOneCatalogItem` shape so the Admin SKU selector works seamlessly with 1 click.
 */
export async function getFazerCardsCatalog(query?: string): Promise<CentralOneCatalogItem[]> {
  if (!isFazerCardsConfigured()) {
    return [];
  }

  let allCategories: FazerCardsGiftCardCategory[] = [];
  if (cachedCategories && Date.now() < cachedCategories.expiresAt) {
    allCategories = cachedCategories.items;
  } else {
    let cursor: string | undefined = undefined;
    for (let page = 0; page < 10; page++) {
      const res = await getFazerCardsCategories({ limit: 100, cursor });
      allCategories.push(...res.items);
      if (!res.hasMore || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
    if (allCategories.length > 0) {
      cachedCategories = {
        items: allCategories,
        expiresAt: Date.now() + 10 * 60_000,
      };
    }
  }

  const selectedCategories = selectFazerCardsCategoriesForQuery(allCategories, query, 48);
  const { numericTokens } = splitFazerCardsSearchQuery(query);

  const rankedItems: Array<{
    item: CentralOneCatalogItem;
    catScore: number;
    offerMatchBoost: number;
  }> = [];

  const batchSize = 8;
  for (let i = 0; i < selectedCategories.length; i += batchSize) {
    const slice = selectedCategories.slice(i, i + batchSize);
    const offerResults = await Promise.allSettled(
      slice.map(({ category }) => getFazerCardsCategoryOffers(category.category_id))
    );
    for (let j = 0; j < offerResults.length; j++) {
      const result = offerResults[j];
      const entry = slice[j];
      if (result.status !== "fulfilled" || !entry) continue;
      const cat = entry.category;
      for (const offer of result.value.offers) {
        if (!offer.card_id) continue;
        const priceCents = parseCentralOneDecimalToCents(offer.price_usd) ?? 0;
        if (priceCents <= 0) continue;
        const compositeId = formatFazerCardsProductId(cat.category_id, offer.card_id);
        const offerHay = normalizeFazerSearchText(`${offer.name} ${offer.card_id}`);
        const offerMatchBoost =
          numericTokens.length > 0 &&
          numericTokens.some((num) =>
            new RegExp(`(?:^|[^0-9])${escapeRegex(num)}(?:$|[^0-9])`).test(offerHay)
          )
            ? 200
            : 0;

        rankedItems.push({
          catScore: entry.score,
          offerMatchBoost,
          item: {
            id: compositeId,
            sku: `FZR:${cat.category_id}:${offer.card_id}`,
            name: `${cat.name} — ${offer.name}`,
            region: `FazerCards · Stock: ${offer.stock}`,
            resellerPriceRaw: String(offer.price_usd),
            resellerPriceCents: priceCents,
            currency: "USD",
            requiresTarget: false,
            targetFields: [],
            targetSchema: [],
            isLoginMode: false,
            available: offer.stock > 0,
          },
        });
      }
    }
  }

  rankedItems.sort((a, b) => {
    if (b.offerMatchBoost !== a.offerMatchBoost) return b.offerMatchBoost - a.offerMatchBoost;
    if (b.catScore !== a.catScore) return b.catScore - a.catScore;
    if (a.item.available !== b.item.available) return a.item.available ? -1 : 1;
    return a.item.resellerPriceCents - b.item.resellerPriceCents;
  });

  return rankedItems.map((entry) => entry.item);
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

function extractFazerOrderUnitCostCents(
  order: FazerCardsOrderResource | null | undefined,
  quantityFallback = 1
): number {
  if (!order) return 0;
  const unitCents = parseCentralOneDecimalToCents(order.price_usd_per_unit);
  if (unitCents && unitCents > 0) return unitCents;
  const totalCents = parseCentralOneDecimalToCents(order.total_usd);
  const qty = Number(order.quantity ?? quantityFallback);
  if (totalCents && totalCents > 0 && qty > 0) {
    return Math.round(totalCents / qty);
  }
  return 0;
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

  const order = (data?.order ?? data) as unknown as FazerCardsOrderResource;
  if (!order?.id) {
    throw new Error("La respuesta de FazerCards no incluyó un ID de orden.");
  }

  return {
    externalOrderId: `${FAZERCARDS_PRODUCT_PREFIX}${order.id}`,
    rawOrderId: order.id,
    status: normalizeFazerStatus(order.status),
    unitCostCents: extractFazerOrderUnitCostCents(order, input.quantity),
    codes: extractCodesFromOrder(order),
    failReason: order.fail_reason ?? null,
    rawResponse: data as Record<string, unknown>,
  };
}

export async function getFazerCardsOrder(externalOrRawOrderId: string): Promise<{
  externalOrderId: string;
  rawOrderId: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
  unitCostCents: number;
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

  const order = (data?.order ?? data) as unknown as FazerCardsOrderResource;
  return {
    externalOrderId: `${FAZERCARDS_PRODUCT_PREFIX}${order?.id || rawOrderId}`,
    rawOrderId: order?.id || rawOrderId,
    status: normalizeFazerStatus(order?.status),
    unitCostCents: extractFazerOrderUnitCostCents(order, 1),
    codes: extractCodesFromOrder(order),
    failReason: order?.fail_reason ?? null,
    rawResponse: data as Record<string, unknown>,
  };
}

export interface FazerCardsApiOrderSummary {
  id: string;
  externalOrderId: string;
  title: string;
  quantity: number;
  totalUsdCents: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface SupplierOrdersReport<T> {
  configured: boolean;
  healthy: boolean;
  errorMessage?: string;
  orders: T[];
  totalSpentCents: number;
  completedCount: number;
}

export async function listFazerCardsOrders(
  limit = 50
): Promise<SupplierOrdersReport<FazerCardsApiOrderSummary>> {
  if (!isFazerCardsConfigured()) {
    return {
      configured: false,
      healthy: false,
      errorMessage: "FAZERCARDS_API_KEY no configurada en el servidor.",
      orders: [],
      totalSpentCents: 0,
      completedCount: 0,
    };
  }

  try {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const data = await fazerRequest<{
      ok?: boolean;
      items?: Array<Record<string, unknown>>;
    }>(`/orders?limit=${safeLimit}`);

    const rawItems = Array.isArray(data.items) ? data.items : [];
    const orders: FazerCardsApiOrderSummary[] = rawItems.map((it) => {
      const id = String(it.id ?? "").trim();
      const totalCents =
        parseCentralOneDecimalToCents(it.total_usd as string | number | undefined) ?? 0;
      const offer = String(it.offer_name ?? "").trim();
      const category = String(it.category_name ?? "").trim();
      const fallbackTitle = [category, offer].filter(Boolean).join(" · ") || id;
      return {
        id,
        externalOrderId: id.startsWith(FAZERCARDS_PRODUCT_PREFIX)
          ? id
          : `${FAZERCARDS_PRODUCT_PREFIX}${id}`,
        title: String(it.title ?? fallbackTitle),
        quantity: Number(it.quantity ?? 1) || 1,
        totalUsdCents: totalCents,
        status: normalizeFazerStatus(String(it.status ?? "PENDING")),
        createdAt: String(it.created_at ?? ""),
        completedAt: it.completed_at ? String(it.completed_at) : null,
      };
    });

    const completed = orders.filter((o) => o.status === "COMPLETED");
    const totalSpentCents = completed.reduce((sum, o) => sum + o.totalUsdCents, 0);

    return {
      configured: true,
      healthy: true,
      orders,
      totalSpentCents,
      completedCount: completed.length,
    };
  } catch (err) {
    return {
      configured: true,
      healthy: false,
      errorMessage:
        err instanceof Error ? err.message : "Error consultando GET /orders en FazerCards",
      orders: [],
      totalSpentCents: 0,
      completedCount: 0,
    };
  }
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
