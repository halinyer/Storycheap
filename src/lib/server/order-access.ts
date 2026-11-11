import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";
import { getCodeEncryptionKeyRaw } from "./env";

export const ORDER_ACCESS_COOKIE = "storycheap_order_access";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function signOrderPayload(orderId: string, expMs: number): string {
  const secret = getCodeEncryptionKeyRaw();
  return crypto
    .createHmac("sha256", secret)
    .update(`${orderId}:${expMs}`)
    .digest("base64url");
}

export function createOrderAccessToken(orderId: string): string {
  const expMs = Date.now() + TOKEN_TTL_MS;
  const sig = signOrderPayload(orderId, expMs);
  return `${orderId}.${expMs}.${sig}`;
}

export function verifyOrderAccessToken(
  token: string,
  expectedOrderId: string
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [orderId, expStr, sig] = parts;
  if (orderId !== expectedOrderId) return false;
  const expMs = Number(expStr);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expectedSig = signOrderPayload(orderId, expMs);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Checks whether the current request cookies contain a valid HMAC capability cookie for `orderId`.
 */
export async function hasOrderAccessCookie(orderId: string): Promise<boolean> {
  try {
    const store = await cookies();
    const raw = store.get(ORDER_ACCESS_COOKIE)?.value;
    if (!raw) return false;
    const tokens = raw.split(",");
    return tokens.some((t) => verifyOrderAccessToken(t, orderId));
  } catch {
    return false;
  }
}

export async function appendOrderAccessCookieValue(
  orderId: string
): Promise<string> {
  const freshToken = createOrderAccessToken(orderId);
  try {
    const store = await cookies();
    const existing = store.get(ORDER_ACCESS_COOKIE)?.value;
    const prev = existing ? existing.split(",").filter(Boolean).slice(-9) : [];
    return [...prev, freshToken].join(",");
  } catch {
    return freshToken;
  }
}
