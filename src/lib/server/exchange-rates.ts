import "server-only";
import type {
  BsRateAutoSyncPolicy,
  LiveVenezuelaRatesSnapshot,
  VenezuelaRateBenchmarkKey,
} from "@/types";
import { isDemoSandboxEnabled } from "./env";
import { getBsRateCents, setBsRateCents } from "./repository";
import { getSandboxState } from "./sandbox-db";
import { getSupabaseAdmin } from "./supabase-admin";

const BS_RATE_POLICY_KEY = "bs_rate_auto_sync_policy";
const LIVE_RATES_CACHE_TTL_MS = 60_000;

export const DEFAULT_BS_RATE_POLICY: BsRateAutoSyncPolicy = {
  mode: "manual",
  benchmark: "binance_p2p",
  spreadPct: 0,
  onlyIncrease: true,
  autoSyncIntervalMinutes: 15,
  lastSyncedAt: null,
  lastSyncedRateCents: null,
};

let cachedRatesSnapshot: LiveVenezuelaRatesSnapshot | null = null;
let cachedRatesAtMs = 0;

export interface RawBinanceP2pAdvItem {
  adv?: {
    price?: string | number;
    minSingleTransAmount?: string | number;
    maxSingleTransAmount?: string | number;
    tradableQuantity?: string | number;
  };
}

/**
 * Computes a clean, manipulation-resistant USDT/VES rate from Binance P2P ads.
 * Filters out narrow-range "bait ads" (e.g. min 300 Bs / max 301 Bs) and averages
 * the top liquid offers.
 */
export function computeFilteredBinanceP2pRate(
  items: ReadonlyArray<RawBinanceP2pAdvItem> | null | undefined
): number | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  const allValidPrices: number[] = [];
  const liquidPrices: number[] = [];

  for (const row of items) {
    const price = Number(row?.adv?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    allValidPrices.push(price);

    const minAmt = Number(row?.adv?.minSingleTransAmount ?? 0);
    const maxAmt = Number(row?.adv?.maxSingleTransAmount ?? 0);
    const rangeAmt = maxAmt - minAmt;

    // Exclude classic 1-Bs bait ads where max - min < 500 Bs or max < 1000 Bs
    const isBaitAd =
      (maxAmt > 0 && maxAmt < 1000) ||
      (maxAmt > 0 && minAmt > 0 && rangeAmt < 500);

    if (!isBaitAd) {
      liquidPrices.push(price);
    }
  }

  const pool = liquidPrices.length > 0 ? liquidPrices.slice(0, 5) : allValidPrices.slice(0, 5);
  if (pool.length === 0) return null;

  const sum = pool.reduce((acc, p) => acc + p, 0);
  return Math.round((sum / pool.length) * 100) / 100;
}

/**
 * Resolves the target store Bs/USD rate (in cents) from the chosen market benchmark,
 * protective spread percentage, and optional floor rule (`onlyIncrease`).
 */
export function computeTargetBsRateFromBenchmark(
  rates: Pick<
    LiveVenezuelaRatesSnapshot,
    "officialBcvCents" | "euroBcvCents" | "paraleloCents" | "binanceP2pCents"
  >,
  policy: Pick<BsRateAutoSyncPolicy, "benchmark" | "spreadPct" | "onlyIncrease">,
  currentBsRateCents?: number | null
): number | null {
  const candidates: Record<Exclude<VenezuelaRateBenchmarkKey, "highest">, number | null> = {
    binance_p2p: rates.binanceP2pCents ?? rates.paraleloCents ?? rates.euroBcvCents ?? rates.officialBcvCents,
    euro_bcv: rates.euroBcvCents ?? rates.officialBcvCents,
    paralelo: rates.paraleloCents ?? rates.binanceP2pCents ?? rates.euroBcvCents,
    official_bcv: rates.officialBcvCents,
  };

  let baseCents: number | null = null;
  if (policy.benchmark === "highest") {
    const positive = [
      rates.binanceP2pCents,
      rates.paraleloCents,
      rates.euroBcvCents,
      rates.officialBcvCents,
    ].filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
    baseCents = positive.length > 0 ? Math.max(...positive) : null;
  } else {
    baseCents = candidates[policy.benchmark] ?? null;
  }

  if (!baseCents || baseCents <= 0) return null;

  const safeSpread = Number.isFinite(policy.spreadPct)
    ? Math.min(35, Math.max(-10, policy.spreadPct))
    : 0;
  const withSpreadCents = Math.round(baseCents * (1 + safeSpread / 100));

  if (
    policy.onlyIncrease &&
    typeof currentBsRateCents === "number" &&
    Number.isFinite(currentBsRateCents) &&
    currentBsRateCents > withSpreadCents
  ) {
    return currentBsRateCents;
  }

  return withSpreadCents;
}

function toCentsOrNull(val: number | null | undefined): number | null {
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) return null;
  return Math.round(val * 100);
}

export async function fetchLiveVenezuelaRates(options?: {
  force?: boolean;
}): Promise<LiveVenezuelaRatesSnapshot> {
  const now = Date.now();
  if (
    !options?.force &&
    cachedRatesSnapshot &&
    now - cachedRatesAtMs < LIVE_RATES_CACHE_TTL_MS
  ) {
    return cachedRatesSnapshot;
  }

  const [usdResult, eurResult, p2pResult] = await Promise.allSettled([
    fetch("https://ve.dolarapi.com/v1/dolares", {
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Array<{
        fuente?: string;
        nombre?: string;
        promedio?: number;
      }>;
    }),
    fetch("https://ve.dolarapi.com/v1/euros", {
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Array<{
        fuente?: string;
        nombre?: string;
        promedio?: number;
      }>;
    }),
    fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fiat: "VES",
        page: 1,
        rows: 15,
        tradeType: "BUY",
        asset: "USDT",
        payTypes: [],
      }),
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: RawBinanceP2pAdvItem[] };
      return json.data ?? [];
    }),
  ]);

  let officialBcv: number | null = null;
  let paralelo: number | null = null;
  if (usdResult.status === "fulfilled" && Array.isArray(usdResult.value)) {
    for (const item of usdResult.value) {
      const f = (item.fuente ?? item.nombre ?? "").toLowerCase();
      if (f.includes("oficial") && typeof item.promedio === "number") {
        officialBcv = Math.round(item.promedio * 100) / 100;
      } else if (f.includes("paralelo") && typeof item.promedio === "number") {
        paralelo = Math.round(item.promedio * 100) / 100;
      }
    }
  }

  let euroBcv: number | null = null;
  if (eurResult.status === "fulfilled" && Array.isArray(eurResult.value)) {
    for (const item of eurResult.value) {
      const f = (item.fuente ?? item.nombre ?? "").toLowerCase();
      if (f.includes("oficial") && typeof item.promedio === "number") {
        euroBcv = Math.round(item.promedio * 100) / 100;
        break;
      }
    }
  }

  let binanceP2p: number | null = null;
  if (p2pResult.status === "fulfilled") {
    binanceP2p = computeFilteredBinanceP2pRate(p2pResult.value);
  }
  if (!binanceP2p && paralelo) {
    binanceP2p = paralelo;
  }

  if (!officialBcv && !euroBcv && !paralelo && !binanceP2p) {
    if (cachedRatesSnapshot) return cachedRatesSnapshot;
    throw new Error("No se pudieron consultar las fuentes de tasas en vivo.");
  }

  const officialBcvCents = toCentsOrNull(officialBcv);
  const euroBcvCents = toCentsOrNull(euroBcv);
  const paraleloCents = toCentsOrNull(paralelo);
  const binanceP2pCents = toCentsOrNull(binanceP2p);

  const replacementUsdtRateCents =
    binanceP2pCents ?? paraleloCents ?? euroBcvCents ?? officialBcvCents;

  const bcvToUsdtGapPct =
    officialBcvCents &&
    officialBcvCents > 0 &&
    replacementUsdtRateCents &&
    replacementUsdtRateCents > 0
      ? Math.round(
          (((replacementUsdtRateCents - officialBcvCents) / officialBcvCents) *
            100) *
            10
        ) / 10
      : null;

  const sources: string[] = [];
  if (officialBcv || euroBcv || paralelo) sources.push("BCV / DolarApi");
  if (p2pResult.status === "fulfilled" && binanceP2p) sources.push("Binance P2P USDT");

  const snapshot: LiveVenezuelaRatesSnapshot = {
    officialBcv,
    euroBcv,
    paralelo,
    binanceP2p,
    officialBcvCents,
    euroBcvCents,
    paraleloCents,
    binanceP2pCents,
    replacementUsdtRateCents,
    bcvToUsdtGapPct,
    source: sources.join(" + ") || "Fuentes Venezuela",
    fetchedAt: new Date().toISOString(),
  };

  cachedRatesSnapshot = snapshot;
  cachedRatesAtMs = now;
  return snapshot;
}

export async function getBsRateAutoSyncPolicy(): Promise<BsRateAutoSyncPolicy> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    if (isDemoSandboxEnabled()) {
      return {
        ...DEFAULT_BS_RATE_POLICY,
        ...(getSandboxState().bsRatePolicy ?? {}),
      };
    }
    return { ...DEFAULT_BS_RATE_POLICY };
  }

  const { data, error } = await admin
    .from("store_settings")
    .select("value")
    .eq("key", BS_RATE_POLICY_KEY)
    .maybeSingle();

  if (error || !data?.value) {
    return { ...DEFAULT_BS_RATE_POLICY };
  }

  const raw = data.value as Partial<BsRateAutoSyncPolicy>;
  return {
    mode: raw.mode === "auto" ? "auto" : "manual",
    benchmark:
      raw.benchmark === "binance_p2p" ||
      raw.benchmark === "euro_bcv" ||
      raw.benchmark === "paralelo" ||
      raw.benchmark === "official_bcv" ||
      raw.benchmark === "highest"
        ? raw.benchmark
        : DEFAULT_BS_RATE_POLICY.benchmark,
    spreadPct:
      typeof raw.spreadPct === "number" && Number.isFinite(raw.spreadPct)
        ? Math.min(35, Math.max(-10, raw.spreadPct))
        : 0,
    onlyIncrease:
      raw.onlyIncrease !== undefined
        ? Boolean(raw.onlyIncrease)
        : DEFAULT_BS_RATE_POLICY.onlyIncrease,
    autoSyncIntervalMinutes:
      typeof raw.autoSyncIntervalMinutes === "number" &&
      Number.isFinite(raw.autoSyncIntervalMinutes)
        ? Math.min(720, Math.max(5, Math.round(raw.autoSyncIntervalMinutes)))
        : DEFAULT_BS_RATE_POLICY.autoSyncIntervalMinutes,
    lastSyncedAt: typeof raw.lastSyncedAt === "string" ? raw.lastSyncedAt : null,
    lastSyncedRateCents:
      typeof raw.lastSyncedRateCents === "number" ? raw.lastSyncedRateCents : null,
  };
}

export async function saveBsRateAutoSyncPolicy(
  patch: Partial<BsRateAutoSyncPolicy>,
  updatedBy?: string | null
): Promise<BsRateAutoSyncPolicy> {
  const current = await getBsRateAutoSyncPolicy();
  const next: BsRateAutoSyncPolicy = {
    mode:
      patch.mode !== undefined
        ? patch.mode === "auto"
          ? "auto"
          : "manual"
        : current.mode,
    benchmark: patch.benchmark ?? current.benchmark,
    spreadPct:
      patch.spreadPct !== undefined && Number.isFinite(Number(patch.spreadPct))
        ? Math.min(35, Math.max(-10, Math.round(Number(patch.spreadPct) * 100) / 100))
        : current.spreadPct,
    onlyIncrease:
      patch.onlyIncrease !== undefined
        ? Boolean(patch.onlyIncrease)
        : current.onlyIncrease,
    autoSyncIntervalMinutes:
      patch.autoSyncIntervalMinutes !== undefined &&
      Number.isFinite(Number(patch.autoSyncIntervalMinutes))
        ? Math.min(
            720,
            Math.max(5, Math.round(Number(patch.autoSyncIntervalMinutes)))
          )
        : current.autoSyncIntervalMinutes,
    lastSyncedAt:
      patch.lastSyncedAt !== undefined ? patch.lastSyncedAt : current.lastSyncedAt,
    lastSyncedRateCents:
      patch.lastSyncedRateCents !== undefined
        ? patch.lastSyncedRateCents
        : current.lastSyncedRateCents,
  };

  const admin = getSupabaseAdmin();
  if (!admin) {
    if (isDemoSandboxEnabled()) {
      getSandboxState().bsRatePolicy = next;
    }
    return next;
  }

  const { error } = await admin.from("store_settings").upsert({
    key: BS_RATE_POLICY_KEY,
    value: next,
    updated_by: updatedBy ?? null,
  });
  if (error) throw error;
  return next;
}

export async function syncBsExchangeRateIfNeeded(options?: {
  force?: boolean;
  updatedBy?: string | null;
}): Promise<{
  synced: boolean;
  bsRateCents: number | null;
  policy: BsRateAutoSyncPolicy;
  rates: LiveVenezuelaRatesSnapshot | null;
}> {
  const [policy, currentBsRateCents] = await Promise.all([
    getBsRateAutoSyncPolicy(),
    getBsRateCents(),
  ]);

  if (policy.mode !== "auto" && !options?.force) {
    return {
      synced: false,
      bsRateCents: currentBsRateCents,
      policy,
      rates: null,
    };
  }

  if (!options?.force && policy.lastSyncedAt) {
    const elapsedMs = Date.now() - Date.parse(policy.lastSyncedAt);
    if (
      Number.isFinite(elapsedMs) &&
      elapsedMs < policy.autoSyncIntervalMinutes * 60_000
    ) {
      return {
        synced: false,
        bsRateCents: currentBsRateCents,
        policy,
        rates: cachedRatesSnapshot,
      };
    }
  }

  const rates = await fetchLiveVenezuelaRates({ force: Boolean(options?.force) });
  const targetCents = computeTargetBsRateFromBenchmark(
    rates,
    policy,
    currentBsRateCents
  );

  if (!targetCents || targetCents <= 0) {
    return {
      synced: false,
      bsRateCents: currentBsRateCents,
      policy,
      rates,
    };
  }

  const nowIso = new Date().toISOString();
  await setBsRateCents(targetCents, options?.updatedBy ?? "auto_rate_sync");
  const updatedPolicy = await saveBsRateAutoSyncPolicy(
    {
      lastSyncedAt: nowIso,
      lastSyncedRateCents: targetCents,
    },
    options?.updatedBy ?? "auto_rate_sync"
  );

  return {
    synced: true,
    bsRateCents: targetCents,
    policy: updatedPolicy,
    rates,
  };
}
