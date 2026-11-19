import "server-only";

// Deterministic dev-only fallback key (only permitted when NODE_ENV !== "production" or ENABLE_DEMO_SANDBOX === "true")
const DEV_FALLBACK_ENCRYPTION_KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export function isSupabasePublicConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  );
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

export function isZenoBankConfigured(): boolean {
  return Boolean(process.env.ZENOBANK_API_KEY?.trim());
}

export function isReloadlyConfigured(): boolean {
  return Boolean(
    process.env.RELOADLY_CLIENT_ID?.trim() &&
      process.env.RELOADLY_CLIENT_SECRET?.trim()
  );
}

export function isCentralOneConfigured(): boolean {
  return Boolean(process.env.CENTRAL_ONE_API_KEY?.trim());
}

export function getCentralOneApiKey(): string | null {
  return process.env.CENTRAL_ONE_API_KEY?.trim() || null;
}

export function getCentralOneWebhookSecret(): string | null {
  return process.env.CENTRAL_ONE_WEBHOOK_SECRET?.trim() || null;
}

export function getCentralOneBaseUrl(): string {
  const configured = process.env.CENTRAL_ONE_BASE_URL?.trim();
  return (configured || "https://portal.centraloneglobal.com/api/v1").replace(/\/+$/, "");
}

/**
 * Optional outbound static-IP HTTP(S) proxy used ONLY for Central One API calls
 * (e.g. Fixie's auto-injected `FIXIE_URL` on Vercel or explicit `CENTRAL_ONE_PROXY_URL`).
 */
export function getCentralOneProxyUrl(): string | null {
  return (
    process.env.CENTRAL_ONE_PROXY_URL?.trim() ||
    process.env.FIXIE_URL?.trim() ||
    null
  );
}

/**
 * Controls when Central One calls use the static-IP proxy (`FIXIE_URL` / `CENTRAL_ONE_PROXY_URL`):
 * - "fallback" (default): calls Central One directly (0 Fixie quota used) and automatically fails
 *   over to Fixie on the exact same request if Central One ever responds `403 ip_not_allowed`.
 * - "always": always route Central One calls through the proxy.
 * - "direct": never route through the proxy.
 */
export function getCentralOneProxyMode(): "fallback" | "always" | "direct" {
  const raw = (process.env.CENTRAL_ONE_PROXY_MODE ?? "fallback")
    .trim()
    .toLowerCase();
  if (raw === "always" || raw === "direct") return raw;
  return "fallback";
}

export function isFazerCardsConfigured(): boolean {
  return Boolean(
    process.env.FAZERCARDS_API_KEY?.trim() || process.env.FAZER_API_KEY?.trim()
  );
}

export function getFazerCardsApiKey(): string | null {
  return (
    process.env.FAZERCARDS_API_KEY?.trim() ||
    process.env.FAZER_API_KEY?.trim() ||
    null
  );
}

export function getFazerCardsWebhookSecret(): string | null {
  return process.env.FAZERCARDS_WEBHOOK_SECRET?.trim() || null;
}

export function getFazerCardsBaseUrl(): string {
  const configured = process.env.FAZERCARDS_BASE_URL?.trim();
  return (configured || "https://api.fzr.cards/api/v2").replace(/\/+$/, "");
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function isDemoSandboxEnabled(): boolean {
  if (isSupabaseAdminConfigured()) {
    return false;
  }
  if (process.env.NODE_ENV === "production") {
    return process.env.ENABLE_DEMO_SANDBOX === "true";
  }
  return process.env.ENABLE_DEMO_SANDBOX !== "false";
}

/**
 * Pre-launch preview: no database and no demo sandbox. The storefront renders
 * the static catalog read-only (all variants out of stock) and checkout,
 * login and admin stay closed. This is the safe default in production.
 */
export function isStorePreviewMode(): boolean {
  return !isSupabaseAdminConfigured() && !isDemoSandboxEnabled();
}

export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export function getCodeEncryptionKeyRaw(): string {
  const configured = process.env.CODE_ENCRYPTION_KEY?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production" && !isDemoSandboxEnabled()) {
    throw new Error(
      "CODE_ENCRYPTION_KEY is required in production to encrypt/decrypt digital codes."
    );
  }
  return DEV_FALLBACK_ENCRYPTION_KEY_HEX;
}

export function getCronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

export function isBinancePayConfigured(): boolean {
  return Boolean(getBinancePayCredentials());
}

export function getBinancePayCredentials(): {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
} | null {
  const apiKey = (
    process.env.BINANCE_API_KEY ??
    process.env.BINANCE_KEY ??
    ""
  ).trim();
  const apiSecret = (
    process.env.BINANCE_API_SECRET ??
    process.env.BINANCE_SECRET_KEY ??
    process.env.BINANCE_SECRET ??
    ""
  ).trim();
  if (!apiKey || !apiSecret) return null;
  const configured = process.env.BINANCE_API_BASE_URL?.trim();
  return {
    apiKey,
    apiSecret,
    baseUrl: (configured || "https://api.binance.com").replace(/\/+$/, ""),
  };
}

export function isBdvConciliacionConfigured(): boolean {
  return Boolean(process.env.BDV_API_KEY?.trim());
}

export function getBdvApiKey(): string | null {
  return process.env.BDV_API_KEY?.trim() || null;
}

export function getBdvApiBaseUrl(): string {
  const configured = process.env.BDV_API_BASE_URL?.trim();
  return (
    configured || "https://bdvconciliacion.banvenez.com:443/getMovement"
  ).replace(/\/+$/, "");
}
