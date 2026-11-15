import "server-only";
import type {
  ProductDTO,
  ProductVariantDTO,
  SupplierCostChangeRecord,
  SupplierPricingPolicy,
  SupplierSyncState,
} from "@/types";
import {
  evaluateSupplierPriceChange,
  parseUsdToTenthsOfCent,
  tenthsOfCentToExactUsdString,
  tenthsOfCentToRoundedCents,
} from "@/lib/supplier-pricing-policy";
import { isCentralOneConfigured, isFazerCardsConfigured } from "./env";
import {
  batchSaveVariantPricingMeta,
  getProviderConfig,
  getSupplierPricingPolicy,
  getSupplierSyncState,
  getVariantPricingMetaMap,
  listCatalog,
  saveSupplierSyncState,
  updateVariantAdmin,
  type VariantPricingMeta,
} from "./repository";
import { getCentralOneCatalog } from "./suppliers/centralone";
import {
  getFazerCardsCategoryOffers,
  isFazerCardsProductId,
  parseFazerCardsProductId,
} from "./suppliers/fazercards";

export interface LiveSupplierQuote {
  skuId: string;
  provider: "fazercards" | "centralone";
  costRaw: string;
  costTenths: number;
  costCents: number;
  available: boolean;
  stockCount: number | null;
  name?: string;
  sku?: string;
  region?: string;
}

const QUOTE_CACHE_TTL_MS = 45_000;
const fazerCategoryQuoteCache = new Map<
  string,
  { fetchedAt: number; quotes: Map<string, LiveSupplierQuote> }
>();
let centralOneQuoteCache: {
  fetchedAt: number;
  quotes: Map<string, LiveSupplierQuote>;
} | null = null;

let inFlightCatalogSync: Promise<SupplierSyncState> | null = null;
let lastAutoSyncMemoryAt = 0;

export function invalidateSupplierQuoteCache() {
  fazerCategoryQuoteCache.clear();
  centralOneQuoteCache = null;
}

async function fetchFazerQuotesForCategories(
  categoryIds: string[],
  forceFresh: boolean
): Promise<Map<string, LiveSupplierQuote>> {
  const result = new Map<string, LiveSupplierQuote>();
  if (categoryIds.length === 0 || !isFazerCardsConfigured()) return result;

  const now = Date.now();
  const staleCategories: string[] = [];

  for (const catId of categoryIds) {
    const cached = fazerCategoryQuoteCache.get(catId);
    if (!forceFresh && cached && now - cached.fetchedAt < QUOTE_CACHE_TTL_MS) {
      for (const [k, q] of cached.quotes.entries()) {
        result.set(k, q);
      }
    } else {
      staleCategories.push(catId);
    }
  }

  if (staleCategories.length === 0) return result;

  const batchResults = await Promise.allSettled(
    staleCategories.map((catId) => getFazerCardsCategoryOffers(catId))
  );

  const fetchedAt = Date.now();
  for (let i = 0; i < batchResults.length; i++) {
    const catId = staleCategories[i];
    const settled = batchResults[i];
    if (!catId || settled.status !== "fulfilled") continue;
    const catQuotes = new Map<string, LiveSupplierQuote>();
    for (const offer of settled.value.offers) {
      if (!offer.card_id) continue;
      const tenths = parseUsdToTenthsOfCent(offer.price_usd);
      if (tenths === null || tenths <= 0) continue;
      const skuId = `fazer:${catId}:${offer.card_id}`;
      const quote: LiveSupplierQuote = {
        skuId,
        provider: "fazercards",
        costRaw: tenthsOfCentToExactUsdString(tenths),
        costTenths: tenths,
        costCents: tenthsOfCentToRoundedCents(tenths),
        available: offer.stock > 0,
        stockCount: offer.stock,
        name: `${settled.value.name} — ${offer.name}`,
        sku: `FZR:${catId}:${offer.card_id}`,
        region: `FazerCards · Stock: ${offer.stock}`,
      };
      catQuotes.set(skuId, quote);
      result.set(skuId, quote);
    }
    fazerCategoryQuoteCache.set(catId, { fetchedAt, quotes: catQuotes });
  }

  return result;
}

async function fetchCentralOneQuotes(
  forceFresh: boolean
): Promise<Map<string, LiveSupplierQuote>> {
  if (!isCentralOneConfigured()) return new Map();

  const now = Date.now();
  if (
    !forceFresh &&
    centralOneQuoteCache &&
    now - centralOneQuoteCache.fetchedAt < QUOTE_CACHE_TTL_MS
  ) {
    return centralOneQuoteCache.quotes;
  }

  const catalog = await getCentralOneCatalog();
  const map = new Map<string, LiveSupplierQuote>();
  for (const item of catalog) {
    const tenths = parseUsdToTenthsOfCent(item.resellerPriceRaw);
    if (tenths === null || tenths <= 0) continue;
    map.set(item.id, {
      skuId: item.id,
      provider: "centralone",
      costRaw: tenthsOfCentToExactUsdString(tenths),
      costTenths: tenths,
      costCents: tenthsOfCentToRoundedCents(tenths),
      available: item.available,
      stockCount: null,
      name: item.name,
      sku: item.sku,
      region: item.region,
    });
  }
  centralOneQuoteCache = { fetchedAt: Date.now(), quotes: map };
  return map;
}

export async function fetchLiveQuotesForSkus(
  skuIds: string[],
  options?: { forceFresh?: boolean }
): Promise<Map<string, LiveSupplierQuote>> {
  const forceFresh = Boolean(options?.forceFresh);
  const fazerCategories = new Set<string>();
  const centralOneIds: string[] = [];

  for (const rawId of skuIds) {
    const clean = rawId?.trim();
    if (!clean) continue;
    if (isFazerCardsProductId(clean)) {
      const parsed = parseFazerCardsProductId(clean);
      if (parsed) fazerCategories.add(parsed.categoryId);
    } else {
      centralOneIds.push(clean);
    }
  }

  const [fazerQuotes, c1Quotes] = await Promise.all([
    fazerCategories.size > 0
      ? fetchFazerQuotesForCategories(Array.from(fazerCategories), forceFresh).catch(
          () => new Map<string, LiveSupplierQuote>()
        )
      : Promise.resolve(new Map<string, LiveSupplierQuote>()),
    centralOneIds.length > 0
      ? fetchCentralOneQuotes(forceFresh).catch(
          () => new Map<string, LiveSupplierQuote>()
        )
      : Promise.resolve(new Map<string, LiveSupplierQuote>()),
  ]);

  const combined = new Map<string, LiveSupplierQuote>();
  for (const id of skuIds) {
    const clean = id?.trim();
    if (!clean) continue;
    const quote = isFazerCardsProductId(clean)
      ? fazerQuotes.get(clean)
      : c1Quotes.get(clean);
    if (quote) combined.set(clean, quote);
  }
  return combined;
}

export async function fetchLiveQuoteForSku(
  skuId: string,
  options?: { forceFresh?: boolean }
): Promise<LiveSupplierQuote | null> {
  const map = await fetchLiveQuotesForSkus([skuId], options);
  return map.get(skuId.trim()) ?? null;
}

export async function applyLiveQuoteToVariant(input: {
  productName: string;
  variant: ProductVariantDTO;
  quote: LiveSupplierQuote;
  existingMeta?: VariantPricingMeta;
  policy: SupplierPricingPolicy;
  updatedBy?: string | null;
  skipMetaWrite?: boolean;
}): Promise<{
  evaluation: ReturnType<typeof evaluateSupplierPriceChange>;
  metaPatch: VariantPricingMeta;
}> {
  const { variant, quote, existingMeta, policy, updatedBy } = input;
  const evaluation = evaluateSupplierPriceChange({
    currentSaleCents: variant.salePriceCents,
    oldExactCostUsd: existingMeta?.exactCostUsd ?? null,
    oldUnitCostCents: variant.unitCostCents,
    liveCostRaw: quote.costRaw,
    policy,
  });

  const nowIso = new Date().toISOString();
  const metaPatch: VariantPricingMeta = {
    ...(existingMeta ?? {}),
    exactCostUsd: evaluation.valid ? evaluation.nextExactCostUsd : existingMeta?.exactCostUsd,
    previousExactCostUsd: evaluation.costChanged
      ? evaluation.previousExactCostUsd
      : existingMeta?.previousExactCostUsd ?? null,
    centraloneProductName: quote.name ?? existingMeta?.centraloneProductName ?? null,
    centraloneSku: quote.sku ?? existingMeta?.centraloneSku ?? null,
    centraloneRegion: quote.region ?? existingMeta?.centraloneRegion ?? null,
    lastSyncedAt: nowIso,
    supplierAvailable: quote.available,
    supplierStockCount: quote.stockCount,
  };

  if (
    evaluation.valid &&
    (evaluation.nextUnitCostCents !== variant.unitCostCents || evaluation.salePriceChanged)
  ) {
    await updateVariantAdmin(variant.id, {
      unitCostCents: evaluation.nextUnitCostCents,
      ...(evaluation.salePriceChanged
        ? { salePriceCents: evaluation.nextSalePriceCents }
        : {}),
    });
  }

  if (!input.skipMetaWrite && (evaluation.costChanged || !existingMeta?.lastSyncedAt)) {
    await batchSaveVariantPricingMeta({ [variant.id]: metaPatch }, updatedBy);
  }

  return { evaluation, metaPatch };
}

export async function syncSupplierCatalogCosts(options?: {
  force?: boolean;
  updatedBy?: string | null;
}): Promise<SupplierSyncState> {
  if (inFlightCatalogSync) {
    return inFlightCatalogSync;
  }

  const run = async (): Promise<SupplierSyncState> => {
    const [catalog, pricingMetaMap, policy, prevState, fazerCfg, c1Cfg] = await Promise.all([
      listCatalog(true),
      getVariantPricingMetaMap(),
      getSupplierPricingPolicy(),
      getSupplierSyncState(),
      getProviderConfig("fazercards"),
      getProviderConfig("centralone"),
    ]);

    const targets: Array<{ product: ProductDTO; variant: ProductVariantDTO }> = [];
    for (const product of catalog) {
      for (const variant of product.variants) {
        if (
          variant.sourcePriority === "manual_only" ||
          variant.sourcePriority === "reloadly_only" ||
          variant.sourcePriority === "manual_then_reloadly"
        ) {
          continue;
        }
        const sku = variant.centraloneProductId?.trim();
        if (!sku) continue;
        const isFazer = isFazerCardsProductId(sku);
        if (isFazer && !(fazerCfg?.enabled ?? true)) continue;
        if (!isFazer && !c1Cfg?.enabled) continue;
        targets.push({ product, variant });
      }
    }

    if (targets.length === 0) {
      const emptyState: SupplierSyncState = {
        ...prevState,
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
        checkedCount: 0,
      };
      lastAutoSyncMemoryAt = Date.now();
      return emptyState;
    }

    try {
      const quotes = await fetchLiveQuotesForSkus(
        targets.map((t) => t.variant.centraloneProductId as string),
        { forceFresh: Boolean(options?.force) }
      );

      const metaUpdates: Record<string, VariantPricingMeta> = {};
      const newChanges: SupplierCostChangeRecord[] = [];
      let updatedCostCount = 0;
      let adjustedSaleCount = 0;
      let atRiskCount = 0;
      const detectedAt = new Date().toISOString();

      for (const { product, variant } of targets) {
        const sku = variant.centraloneProductId!.trim();
        const quote = quotes.get(sku);
        if (!quote) continue;

        const existingMeta = pricingMetaMap[variant.id];
        const { evaluation, metaPatch } = await applyLiveQuoteToVariant({
          productName: product.name,
          variant,
          quote,
          existingMeta,
          policy,
          updatedBy: options?.updatedBy,
          skipMetaWrite: true,
        });
        metaUpdates[variant.id] = metaPatch;

        if (!evaluation.valid) continue;
        if (evaluation.belowCostFloor || !quote.available) {
          atRiskCount += 1;
        }
        if (evaluation.costChanged || evaluation.salePriceChanged) {
          if (evaluation.costChanged) updatedCostCount += 1;
          if (evaluation.salePriceChanged) adjustedSaleCount += 1;
          newChanges.push({
            variantId: variant.id,
            productName: product.name,
            denominationLabel: variant.denominationLabel,
            supplierLabel: quote.provider === "fazercards" ? "FazerCards" : "Central One",
            oldCostUsd: evaluation.previousExactCostUsd,
            newCostUsd: evaluation.nextExactCostUsd,
            oldSaleCents: evaluation.oldSalePriceCents,
            newSaleCents: evaluation.nextSalePriceCents,
            saleAdjusted: evaluation.salePriceChanged,
            belowFloorBlocked: evaluation.belowCostFloor,
            detectedAt,
          });
        }
      }

      if (Object.keys(metaUpdates).length > 0) {
        await batchSaveVariantPricingMeta(metaUpdates, options?.updatedBy);
      }

      const mergedChanges = [...newChanges, ...prevState.recentChanges].slice(0, 30);
      const nextState: SupplierSyncState = {
        lastSyncedAt: detectedAt,
        lastError: null,
        checkedCount: quotes.size,
        updatedCostCount,
        adjustedSaleCount,
        atRiskCount,
        recentChanges: mergedChanges,
      };
      await saveSupplierSyncState(nextState, options?.updatedBy);
      lastAutoSyncMemoryAt = Date.now();
      return nextState;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al consultar costos vivos";
      const errState: SupplierSyncState = {
        ...prevState,
        lastSyncedAt: prevState.lastSyncedAt,
        lastError: msg,
      };
      return errState;
    }
  };

  inFlightCatalogSync = run().finally(() => {
    inFlightCatalogSync = null;
  });
  return inFlightCatalogSync;
}

/**
 * Ensures supplier wholesale prices were synced within the configured TTL.
 * Safe to invoke on storefront & admin reads: fast-paths immediately on fresh TTL
 * and enforces a short timeout so public pages never stall on slow third-party APIs.
 */
export async function ensureFreshSupplierCatalogPrices(options?: {
  maxAgeMs?: number;
  timeoutMs?: number;
}): Promise<SupplierSyncState | null> {
  if (!isFazerCardsConfigured() && !isCentralOneConfigured()) {
    return null;
  }

  const fastCheckMs = options?.maxAgeMs ?? 60_000;
  if (lastAutoSyncMemoryAt > 0 && Date.now() - lastAutoSyncMemoryAt < fastCheckMs) {
    return null;
  }

  const [policy, syncState] = await Promise.all([
    getSupplierPricingPolicy(),
    getSupplierSyncState(),
  ]);
  const effectiveMaxAgeMs =
    options?.maxAgeMs ?? Math.max(60_000, policy.autoSyncIntervalMinutes * 60_000);
  const lastMs = syncState.lastSyncedAt ? Date.parse(syncState.lastSyncedAt) : 0;

  if (lastMs > 0 && Date.now() - lastMs < effectiveMaxAgeMs) {
    lastAutoSyncMemoryAt = Math.max(lastAutoSyncMemoryAt, lastMs);
    return syncState;
  }

  const timeoutMs = options?.timeoutMs ?? 2500;
  try {
    return await Promise.race([
      syncSupplierCatalogCosts(),
      new Promise<SupplierSyncState>((resolve) => {
        setTimeout(() => resolve(syncState), timeoutMs);
      }),
    ]);
  } catch {
    return syncState;
  }
}
