import { NextResponse } from "next/server";
import { connection } from "next/server";
import { AuthError, requireAdminUser } from "@/lib/server/auth";
import { getBinancePayCredentials } from "@/lib/server/env";
import { buildBinanceSignedQuery } from "@/lib/server/payments/binance-pay";
import { listTreasuryMovementsAdmin } from "@/lib/server/repository";

export const preferredRegion = ["gru1", "fra1"];

interface RawBinanceWithdrawal {
  id?: string;
  txId?: string;
  coin?: string;
  amount?: string;
  transactionFee?: string;
  network?: string;
  status?: number;
  applyTime?: string;
  address?: string;
}

export interface BinanceWithdrawalItemDTO {
  id: string;
  txId: string | null;
  coin: string;
  netAmountUsd: number;
  feeUsd: number;
  grossAmountUsd: number;
  network: string;
  status: number;
  applyTime: string;
  addressMasked: string | null;
  alreadyRecorded: boolean;
}

function maskAddress(addr?: string): string | null {
  const clean = addr?.trim();
  if (!clean) return null;
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

export async function GET() {
  await connection();
  try {
    await requireAdminUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const creds = getBinancePayCredentials();
  if (!creds) {
    return NextResponse.json(
      {
        configured: false,
        withdrawals: [],
        error: "BINANCE_API_KEY / BINANCE_API_SECRET no configuradas.",
      },
      { status: 200 }
    );
  }

  try {
    const query = buildBinanceSignedQuery(
      {
        limit: 25,
        timestamp: Date.now(),
        recvWindow: 15_000,
      },
      creds.apiSecret
    );

    const [res, movements] = await Promise.all([
      fetch(`${creds.baseUrl}/sapi/v1/capital/withdraw/history?${query}`, {
        method: "GET",
        headers: {
          "X-MBX-APIKEY": creds.apiKey,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(9000),
      }),
      listTreasuryMovementsAdmin(),
    ]);

    if (res.status === 451) {
      return NextResponse.json(
        {
          configured: true,
          regionBlocked: true,
          withdrawals: [],
          error:
            "Binance bloqueó la región del servidor (HTTP 451). Configura región fuera de EE.UU. para consultar retiros.",
        },
        { status: 200 }
      );
    }

    const rawText = await res.text();
    let parsed: unknown = [];
    try {
      parsed = rawText ? JSON.parse(rawText) : [];
    } catch {
      return NextResponse.json(
        {
          configured: true,
          withdrawals: [],
          error: `Respuesta inválida de Binance (HTTP ${res.status}).`,
        },
        { status: 200 }
      );
    }

    if (!res.ok || !Array.isArray(parsed)) {
      const msg =
        parsed && typeof parsed === "object" && "msg" in parsed
          ? String((parsed as { msg?: unknown }).msg)
          : `Error Binance API (HTTP ${res.status})`;
      return NextResponse.json(
        { configured: true, withdrawals: [], error: msg },
        { status: 200 }
      );
    }

    const activeMovements = movements.filter(
      (m) => !m.voidedAt && m.sourceAccount === "zenobank"
    );
    const recordedRefs = new Set<string>();
    for (const m of activeMovements) {
      if (m.reference?.trim()) {
        recordedRefs.add(m.reference.trim().toLowerCase());
      }
    }

    const withdrawals: BinanceWithdrawalItemDTO[] = [];
    for (const item of parsed as RawBinanceWithdrawal[]) {
      const coin = String(item.coin ?? "").toUpperCase();
      if (!["USDT", "USDC", "FDUSD", "BUSD"].includes(coin)) continue;
      if (item.status !== 6) continue; // 6 = Completed in Binance API

      const netAmountUsd = Number.parseFloat(String(item.amount ?? "0"));
      const feeUsd = Number.parseFloat(String(item.transactionFee ?? "0"));
      if (!Number.isFinite(netAmountUsd) || netAmountUsd <= 0) continue;

      const safeFee = Number.isFinite(feeUsd) && feeUsd >= 0 ? feeUsd : 0;
      const grossAmountUsd = Number((netAmountUsd + safeFee).toFixed(2));
      const id = String(item.id ?? item.txId ?? `${item.applyTime}-${netAmountUsd}`);
      const txId = item.txId?.trim() || null;

      const netCents = Math.round(netAmountUsd * 100);
      const grossCents = Math.round(grossAmountUsd * 100);
      const dayKey = String(item.applyTime ?? "").slice(0, 10);

      const alreadyRecorded =
        (txId !== null && recordedRefs.has(txId.toLowerCase())) ||
        recordedRefs.has(id.toLowerCase()) ||
        activeMovements.some((m) => {
          const sameDay = m.occurredAt.slice(0, 10) === dayKey;
          const amountClose =
            Math.abs(m.amountUsdCents - netCents) <= 2 ||
            Math.abs(m.amountUsdCents - grossCents) <= 2;
          return sameDay && amountClose;
        });

      withdrawals.push({
        id,
        txId,
        coin,
        netAmountUsd: Number(netAmountUsd.toFixed(2)),
        feeUsd: Number(safeFee.toFixed(2)),
        grossAmountUsd,
        network: String(item.network ?? "BSC"),
        status: item.status ?? 6,
        applyTime: String(item.applyTime ?? ""),
        addressMasked: maskAddress(item.address),
        alreadyRecorded,
      });
    }

    return NextResponse.json(
      { configured: true, withdrawals },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        withdrawals: [],
        error:
          err instanceof Error
            ? err.message
            : "Error consultando historial de retiros de Binance.",
      },
      { status: 200 }
    );
  }
}
