import "server-only";
import crypto from "crypto";
import { getBinancePayCredentials } from "../env";

const USD_STABLECOINS = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "BUSD",
  "DAI",
  "USD",
]);

export class BinancePayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinancePayConfigError";
  }
}

export class BinancePayRegionBlockedError extends Error {
  readonly status = 451;
  constructor(
    message = "Binance API rechazó la conexión desde la región actual del servidor (HTTP 451)."
  ) {
    super(message);
    this.name = "BinancePayRegionBlockedError";
  }
}

export class BinancePayApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "BinancePayApiError";
    this.status = status;
  }
}

export interface BinancePayIncomingTx {
  transactionId: string;
  orderId: string;
  orderType: string;
  currency: string;
  amount: string;
  usdCents: number;
  transactionTime: number;
  createdAt: string;
  payerName: string | null;
  counterpartyId: string | null;
  receiverBinanceId: string | null;
  note?: string | null;
}

export interface RawBinancePayTxItem {
  uid?: number | string;
  counterpartyId?: number | string;
  orderId?: string;
  note?: string;
  orderType?: string;
  transactionId?: string;
  transactionTime?: number;
  amount?: string;
  currency?: string;
  payerInfo?: {
    name?: string;
    binanceId?: number | string;
    type?: string;
  };
  receiverInfo?: {
    binanceId?: number | string;
    accountId?: number | string;
    name?: string;
  };
}

export function buildBinanceSignedQuery(
  params: Record<string, string | number | undefined>,
  secret: string
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      sp.set(k, String(v));
    }
  }
  const query = sp.toString();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(query)
    .digest("hex");
  return `${query}&signature=${signature}`;
}

export function parseUsdStablecoinCents(
  amountRaw: string | undefined | null,
  currencyRaw: string | undefined | null
): number | null {
  const currency = currencyRaw?.trim().toUpperCase();
  if (!currency || !USD_STABLECOINS.has(currency)) return null;
  if (!amountRaw) return null;
  const amount = Number.parseFloat(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return cents > 0 ? cents : null;
}

export function normalizeBinancePayIncomingList(
  rawList: RawBinancePayTxItem[],
  expectedReceiverBinanceId?: string | null
): BinancePayIncomingTx[] {
  const expectedReceiver = expectedReceiverBinanceId?.trim() || null;
  const out: BinancePayIncomingTx[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const transactionId = item.transactionId?.trim() ?? "";
    if (!transactionId) continue;

    const receiverBinanceId =
      item.receiverInfo?.binanceId !== undefined
        ? String(item.receiverInfo.binanceId)
        : null;

    if (
      expectedReceiver &&
      receiverBinanceId &&
      receiverBinanceId !== expectedReceiver
    ) {
      continue;
    }

    const usdCents = parseUsdStablecoinCents(item.amount, item.currency);
    if (usdCents === null) continue;

    const txTime =
      typeof item.transactionTime === "number" && Number.isFinite(item.transactionTime)
        ? item.transactionTime
        : Date.now();

    out.push({
      transactionId,
      orderId: item.orderId?.trim() ?? "",
      orderType: item.orderType?.trim() ?? "PAY",
      currency: (item.currency ?? "USDT").trim().toUpperCase(),
      amount: String(item.amount ?? "0"),
      usdCents,
      transactionTime: txTime,
      createdAt: new Date(txTime).toISOString(),
      payerName: item.payerInfo?.name?.trim() || null,
      counterpartyId:
        item.counterpartyId !== undefined ? String(item.counterpartyId) : null,
      receiverBinanceId,
      note: item.note?.trim() || null,
    });
  }

  return out.sort((a, b) => b.transactionTime - a.transactionTime);
}

// Local sandbox state for Vitest / dev testing without hitting real Binance API
const sandboxBinancePayTransactions: RawBinancePayTxItem[] = [];

export function setSandboxBinancePayTransactionsForTests(
  items: RawBinancePayTxItem[]
) {
  sandboxBinancePayTransactions.length = 0;
  sandboxBinancePayTransactions.push(...items);
}

export async function fetchBinancePayIncomingTransactions(args?: {
  startTimeMs?: number;
  endTimeMs?: number;
  limit?: number;
  expectedReceiverBinanceId?: string | null;
}): Promise<BinancePayIncomingTx[]> {
  const creds = getBinancePayCredentials();
  if (!creds) {
    if (process.env.NODE_ENV === "test") {
      const list = sandboxBinancePayTransactions.filter((t) => {
        const ms = t.transactionTime ?? 0;
        if (args?.startTimeMs && ms < args.startTimeMs) return false;
        if (args?.endTimeMs && ms > args.endTimeMs) return false;
        return true;
      });
      return normalizeBinancePayIncomingList(
        list,
        args?.expectedReceiverBinanceId
      );
    }
    throw new BinancePayConfigError(
      "BINANCE_API_KEY y BINANCE_API_SECRET no están configuradas."
    );
  }

  const limit = Math.min(100, Math.max(1, args?.limit ?? 50));

  const hosts =
    creds.baseUrl !== "https://api.binance.com"
      ? [creds.baseUrl]
      : [
          "https://api.binance.com",
          "https://api-gcp.binance.com",
          "https://api1.binance.com",
          "https://api2.binance.com",
          "https://api3.binance.com",
          "https://api4.binance.com",
        ];

  let lastErr: Error | null = null;
  let sawRegionBlock = false;

  for (const host of hosts) {
    try {
      const executeSignedFetch = async (timestampMs: number) => {
        const signedQuery = buildBinanceSignedQuery(
          {
            startTime: args?.startTimeMs,
            endTime: args?.endTimeMs,
            limit,
            recvWindow: 60000,
            timestamp: timestampMs,
          },
          creds.apiSecret
        );
        return fetch(`${host}/sapi/v1/pay/transactions?${signedQuery}`, {
          method: "GET",
          headers: {
            "X-MBX-APIKEY": creds.apiKey,
          },
          cache: "no-store",
        });
      };

      let res = await executeSignedFetch(Date.now());

      if (res.status === 451) {
        sawRegionBlock = true;
        lastErr = new BinancePayRegionBlockedError();
        continue;
      }

      let json = (await res.json().catch(() => null)) as {
        code?: string | number;
        message?: string;
        msg?: string;
        data?: RawBinancePayTxItem[];
      } | null;

      // Auto-recover from server clock skew (-1021 Timestamp outside recvWindow)
      if (!res.ok && Number(json?.code) === -1021) {
        const timeRes = await fetch(`${host}/api/v3/time`, {
          cache: "no-store",
        }).catch(() => null);
        const timeJson = (await timeRes?.json().catch(() => null)) as {
          serverTime?: number;
        } | null;
        if (typeof timeJson?.serverTime === "number") {
          res = await executeSignedFetch(timeJson.serverTime);
          json = (await res.json().catch(() => null)) as typeof json;
        }
      }

      if (!res.ok) {
        const msg = json?.msg || json?.message || `Binance HTTP ${res.status}`;
        if (res.status === 403 || res.status >= 500) {
          lastErr = new BinancePayApiError(msg, res.status);
          continue;
        }
        throw new BinancePayApiError(msg, res.status);
      }

      const codeStr = json?.code !== undefined ? String(json.code) : "000000";
      if (codeStr !== "000000") {
        throw new BinancePayApiError(
          json?.message || json?.msg || `Binance Pay error code ${codeStr}`,
          400
        );
      }

      const rawList = Array.isArray(json?.data) ? json.data : [];
      return normalizeBinancePayIncomingList(
        rawList,
        args?.expectedReceiverBinanceId
      );
    } catch (err) {
      if (err instanceof BinancePayApiError && err.status < 500 && err.status !== 403) {
        throw err;
      }
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (sawRegionBlock) {
    throw new BinancePayRegionBlockedError();
  }

  throw lastErr ?? new BinancePayApiError("No se pudo consultar Binance Pay.");
}

const ORDER_TX_CLOCK_GRACE_MS = 10 * 60_000;

export function extractCleanBinanceTxToken(raw: string): string {
  const upper = raw.trim().toUpperCase();
  const pMatch = upper.match(/P_[A-Z0-9]{8,32}/);
  if (pMatch) return pMatch[0];
  const numMatch = upper.match(/\b\d{14,24}\b/);
  if (numMatch) return numMatch[0];
  return upper.replace(/\s+/g, "");
}

export async function findBinancePayTransactionForOrder(args: {
  txId: string;
  orderCreatedAtIso: string;
  expectedReceiverBinanceId?: string | null;
}): Promise<BinancePayIncomingTx | null> {
  const cleanId = extractCleanBinanceTxToken(args.txId);
  if (cleanId.length < 6) {
    throw new BinancePayApiError(
      "Ingresa un ID de transacción Binance Pay válido (ej. P_A25QH5...).",
      400
    );
  }

  const orderCreatedMs = Date.parse(args.orderCreatedAtIso);
  const minValidMs = Number.isFinite(orderCreatedMs)
    ? orderCreatedMs - ORDER_TX_CLOCK_GRACE_MS
    : Date.now() - 24 * 3600_000;

  const list = await fetchBinancePayIncomingTransactions({
    startTimeMs: minValidMs,
    limit: 100,
    expectedReceiverBinanceId: args.expectedReceiverBinanceId,
  });

  const match = list.find((t) => {
    const txUpper = t.transactionId.toUpperCase();
    const ordUpper = t.orderId.toUpperCase();
    if (txUpper === cleanId || ordUpper === cleanId) return true;
    if (cleanId.length >= 8 && (txUpper.endsWith(cleanId) || ordUpper.endsWith(cleanId))) {
      return true;
    }
    return false;
  });
  if (!match) return null;

  if (match.transactionTime < minValidMs) {
    return null;
  }

  return match;
}
