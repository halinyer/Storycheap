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
