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
}

export interface RawBinancePayTxItem {
  uid?: number | string;
  counterpartyId?: number | string;
  orderId?: string;
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
  const signedQuery = buildBinanceSignedQuery(
    {
      startTime: args?.startTimeMs,
      endTime: args?.endTimeMs,
      limit,
      recvWindow: 10000,
      timestamp: Date.now(),
    },
    creds.apiSecret
  );

  const hosts =
    creds.baseUrl !== "https://api.binance.com"
      ? [creds.baseUrl]
      : ["https://api.binance.com", "https://api1.binance.com"];

  let lastErr: Error | null = null;
  for (const host of hosts) {
    try {
      const res = await fetch(
        `${host}/sapi/v1/pay/transactions?${signedQuery}`,
        {
          method: "GET",
          headers: {
            "X-MBX-APIKEY": creds.apiKey,
          },
          cache: "no-store",
        }
      );

      if (res.status === 451) {
        throw new BinancePayRegionBlockedError();
      }

      const json = (await res.json().catch(() => null)) as {
        code?: string;
        message?: string;
        msg?: string;
        data?: RawBinancePayTxItem[];
      } | null;

      if (!res.ok) {
        const msg = json?.msg || json?.message || `Binance HTTP ${res.status}`;
        if (res.status >= 500) {
          lastErr = new BinancePayApiError(msg, res.status);
          continue;
        }
        throw new BinancePayApiError(msg, res.status);
      }

      if (json?.code && json.code !== "000000") {
        throw new BinancePayApiError(
          json.message || `Binance Pay error code ${json.code}`,
          400
        );
      }

      const rawList = Array.isArray(json?.data) ? json.data : [];
      return normalizeBinancePayIncomingList(
        rawList,
        args?.expectedReceiverBinanceId
      );
    } catch (err) {
      if (err instanceof BinancePayRegionBlockedError) {
        throw err;
      }
      if (err instanceof BinancePayApiError && err.status < 500) {
        throw err;
      }
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastErr ?? new BinancePayApiError("No se pudo consultar Binance Pay.");
}

const ORDER_TX_CLOCK_GRACE_MS = 10 * 60_000;

export async function findBinancePayTransactionForOrder(args: {
  txId: string;
  orderCreatedAtIso: string;
  expectedReceiverBinanceId?: string | null;
}): Promise<BinancePayIncomingTx | null> {
  const cleanId = args.txId.trim().toUpperCase();
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

  const match = list.find(
    (t) =>
      t.transactionId.toUpperCase() === cleanId ||
      t.orderId.toUpperCase() === cleanId
  );
  if (!match) return null;

  if (match.transactionTime < minValidMs) {
    return null;
  }

  return match;
}
