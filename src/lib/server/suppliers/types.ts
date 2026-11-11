import "server-only";

export interface SupplierDeliveredCode {
  source: "manual" | "reloadly";
  codePlaintext: string;
  pinPlaintext?: string | null;
  codeInventoryId?: string | null;
  supplierTxId?: string | null;
}

export interface SupplierBalanceStatus {
  configured: boolean;
  sandbox: boolean;
  balanceCents: number | null;
  currency: string;
  healthy: boolean;
  errorMessage?: string;
}
