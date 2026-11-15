import "server-only";

export interface SupplierDeliveredCode {
  source: "manual" | "reloadly" | "centralone";
  codePlaintext: string;
  pinPlaintext?: string | null;
  codeInventoryId?: string | null;
  supplierTxId?: string | null;
}

export interface SupplierBalanceStatus {
  configured: boolean;
  sandbox: boolean;
  balanceCents: number | null;
  exactBalanceUsd?: string | null;
  currency: string;
  healthy: boolean;
  errorMessage?: string;
}

export function normalizeExactUsdString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const normalized = String(raw).trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(4);
}
