import "server-only";
import { isReloadlyConfigured } from "../env";
import type { SupplierBalanceStatus, SupplierDeliveredCode } from "./types";

interface TokenCache {
  token: string;
  expiresAt: number;
  sandbox: boolean;
}

let cachedToken: TokenCache | null = null;

function isReloadlySandbox(): boolean {
  return process.env.RELOADLY_SANDBOX !== "false";
}

function getAudienceUrl(sandbox: boolean): string {
  return sandbox
    ? "https://giftcards-sandbox.reloadly.com"
    : "https://giftcards.reloadly.com";
}

async function getReloadlyAccessToken(): Promise<{
  token: string;
  baseUrl: string;
}> {
  const clientId = process.env.RELOADLY_CLIENT_ID?.trim();
  const clientSecret = process.env.RELOADLY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Reloadly credentials are not configured.");
  }

  const sandbox = isReloadlySandbox();
  const baseUrl = getAudienceUrl(sandbox);

  if (
    cachedToken &&
    cachedToken.sandbox === sandbox &&
    cachedToken.expiresAt > Date.now() + 60_000
  ) {
    return { token: cachedToken.token, baseUrl };
  }

  const res = await fetch("https://auth.reloadly.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      audience: baseUrl,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Reloadly OAuth failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    sandbox,
  };
  return { token: data.access_token, baseUrl };
}

export async function getReloadlyBalance(): Promise<SupplierBalanceStatus> {
  const sandbox = isReloadlySandbox();
  if (!isReloadlyConfigured()) {
    return {
      configured: false,
      sandbox,
      balanceCents: null,
      currency: "USD",
      healthy: false,
      errorMessage:
        "Credenciales Reloadly no configuradas (se opera 100% con inventario propio CSV).",
    };
  }

  try {
    const { token, baseUrl } = await getReloadlyAccessToken();
    const res = await fetch(`${baseUrl}/accounts/balance`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/com.reloadly.giftcards-v1+json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        configured: true,
        sandbox,
        balanceCents: null,
        currency: "USD",
        healthy: false,
        errorMessage: `HTTP ${res.status} al consultar balance de Reloadly`,
      };
    }
    const json = (await res.json()) as {
      balance: number;
      currencyCode?: string;
    };
    return {
      configured: true,
      sandbox,
      balanceCents: Math.round((json.balance ?? 0) * 100),
      currency: json.currencyCode || "USD",
      healthy: true,
    };
  } catch (err) {
    return {
      configured: true,
      sandbox,
      balanceCents: null,
      currency: "USD",
      healthy: false,
      errorMessage: err instanceof Error ? err.message : "Error de conexión Reloadly",
    };
  }
}

export async function purchaseReloadlyCard(params: {
  reloadlyProductId: number;
  unitFaceValueUsd: number;
  customIdentifier: string;
  recipientEmail: string;
}): Promise<SupplierDeliveredCode> {
  const { token, baseUrl } = await getReloadlyAccessToken();

  const orderRes = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/com.reloadly.giftcards-v1+json",
    },
    body: JSON.stringify({
      productId: params.reloadlyProductId,
      countryCode: "US",
      quantity: 1,
      unitPrice: params.unitFaceValueUsd,
      customIdentifier: params.customIdentifier,
      senderName: "StoryCheap",
      recipientEmail: params.recipientEmail,
      preOrder: false,
    }),
  });

  if (!orderRes.ok) {
    const errText = await orderRes.text().catch(() => "");
    throw new Error(
      `Reloadly order rejected (${orderRes.status}): ${errText.slice(0, 240)}`
    );
  }

  const orderJson = (await orderRes.json()) as { transactionId: number | string };
  const txId = String(orderJson.transactionId);

  const cardsRes = await fetch(
    `${baseUrl}/orders/transactions/${encodeURIComponent(txId)}/cards`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/com.reloadly.giftcards-v1+json",
      },
      cache: "no-store",
    }
  );

  if (!cardsRes.ok) {
    throw new Error(`Reloadly card retrieval failed (${cardsRes.status}) for tx ${txId}`);
  }

  const cards = (await cardsRes.json()) as Array<{
    cardNumber?: string;
    pinCode?: string | null;
  }>;
  const first = cards[0];
  if (!first?.cardNumber) {
    throw new Error(`Reloadly returned empty card payload for tx ${txId}`);
  }

  return {
    source: "reloadly",
    codePlaintext: first.cardNumber,
    pinPlaintext: first.pinCode ?? null,
    supplierTxId: txId,
  };
}
