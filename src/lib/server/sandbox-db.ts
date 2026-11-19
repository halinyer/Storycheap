import "server-only";
import { CATALOG_SEED } from "@/lib/catalog-seed";
import { normalizeVolumeDiscountTiers } from "@/lib/volume-discounts";
import type {
  AuditLogEntryDTO,
  BankPaymentNotificationDTO,
  BsRateAutoSyncPolicy,
  CreditLedgerEntryDTO,
  CustomerSummaryDTO,
  InventoryStatus,
  OrderDTO,
  OrderItemDTO,
  OrderItemTargetInfo,
  PagoMovilSettingsDTO,
  ProductDTO,
  ProviderConfigDTO,
  ReceiverBankAccountDTO,
  SupportTicketDTO,
  TargetSchemaField,
  TreasuryMovementDTO,
  VolumeDiscountTier,
  WebhookEventDTO,
} from "@/types";
import {
  SANDBOX_DEFAULT_ADMIN_ID,
  SANDBOX_DEFAULT_CUSTOMER_ID,
} from "./auth";
import { buildSandboxInitialInventory } from "./sandbox-seed-codes";

export interface SandboxInventoryRow {
  id: string;
  variantId: string;
  codeCiphertext: string;
  pinCiphertext: string | null;
  codeHash: string;
  codeLast4: string;
  batchId: string | null;
  expiresAt: string | null;
  status: InventoryStatus;
  reservedOrderId: string | null;
  reservedUntil: string | null;
  deliveredOrderId: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface SandboxFulfillmentRow {
  id: string;
  orderItemId: string;
  orderId: string;
  userId: string | null;
  source: "manual" | "reloadly" | "centralone";
  codeInventoryId: string | null;
  codeCiphertext: string;
  codeLast4: string;
  pinCiphertext: string | null;
  supplierTxId: string | null;
  attempts: number;
  revealedAt: string | null;
  createdAt: string;
}

export interface SandboxProfile {
  id: string;
  email: string;
  role: "customer" | "admin";
  createdAt: string;
}

export interface SandboxOrderPagoMovilReport {
  orderId: string;
  amountDueBsCents: number | null;
  rateExpiresAt: string | null;
  reportedReference: string | null;
  reportedSenderPhone: string | null;
  reportedSenderBank: string | null;
  reportedSenderDni?: string | null;
  reportedAmountBsCents?: number | null;
  reportedPaymentDate?: string | null;
  reportedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export interface SandboxPagoMovilState {
  receiverAccounts: ReceiverBankAccountDTO[];
  notifications: BankPaymentNotificationDTO[];
  orderReports: Record<string, SandboxOrderPagoMovilReport>;
  settings: PagoMovilSettingsDTO;
  webhookSecretCiphertext: string | null;
}

export interface SandboxState {
  products: ProductDTO[];
  inventory: SandboxInventoryRow[];
  orders: OrderDTO[];
  fulfillments: SandboxFulfillmentRow[];
  creditLedger: CreditLedgerEntryDTO[];
  webhookEvents: Array<
    WebhookEventDTO & { payload: Record<string, unknown> }
  >;
  providerConfigs: ProviderConfigDTO[];
  auditLog: AuditLogEntryDTO[];
  profiles: SandboxProfile[];
  bsRateCents: number | null;
  bsRatePolicy?: BsRateAutoSyncPolicy;
  pagoMovil: SandboxPagoMovilState;
  treasuryMovements: TreasuryMovementDTO[];
  supportTickets: SupportTicketDTO[];
  orderItemTargets: Record<string, Record<string, OrderItemTargetInfo>>;
  supplierOrders: Array<{
    id: string;
    orderId: string;
    orderItemId: string;
    provider: string;
    idempotencyKey: string;
    externalOrderId: string | null;
    referenceCode: string | null;
    status: string;
    expectedQty: number;
    deliveredCount: number;
    supplierUnitCostCents: number | null;
    lastSequence: number;
    errorMessage: string | null;
    rawPayload: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>;
  variantPricingMeta: Record<
    string,
    {
      exactCostUsd?: string | null;
      centraloneProductName?: string | null;
      centraloneSku?: string | null;
      centraloneRegion?: string | null;
      previousExactCostUsd?: string | null;
      lastSyncedAt?: string | null;
      supplierAvailable?: boolean | null;
      supplierStockCount?: number | null;
      volumeDiscounts?: VolumeDiscountTier[];
      requiresTarget?: boolean;
      targetFields?: string[];
      targetSchema?: TargetSchemaField[];
      supportsPlayerValidate?: boolean;
    }
  >;
}

declare global {
  var __storycheapSandboxState: SandboxState | undefined;
}

function createInitialSandboxState(): SandboxState {
  const now = new Date().toISOString();
  const products: ProductDTO[] = CATALOG_SEED.map((p) => ({
    ...p,
    redemptionSteps: [...p.redemptionSteps],
    variants: p.variants.map((v) => ({ ...v })),
  }));

  const seededCodes = buildSandboxInitialInventory().map((row) => ({
    ...row,
    expiresAt: null,
    status: "AVAILABLE" as const,
    reservedOrderId: null,
    reservedUntil: null,
    deliveredOrderId: null,
    createdAt: now,
    deliveredAt: null,
  }));

  const profiles: SandboxProfile[] = [
    {
      id: SANDBOX_DEFAULT_CUSTOMER_ID,
      email: "carlos@storycheap.com",
      role: "customer",
      createdAt: now,
    },
    {
      id: SANDBOX_DEFAULT_ADMIN_ID,
      email: "admin@storycheap.com",
      role: "admin",
      createdAt: now,
    },
  ];

  const creditLedger: CreditLedgerEntryDTO[] = [
    {
      id: "40000000-0000-4000-8000-000000000001",
      userId: SANDBOX_DEFAULT_CUSTOMER_ID,
      orderId: null,
      deltaCents: 350,
      reason: "admin_adjust",
      note: "Saldo de bienvenida / compensación demo",
      createdBy: SANDBOX_DEFAULT_ADMIN_ID,
      createdAt: now,
    },
  ];

  const providerConfigs: ProviderConfigDTO[] = [
    {
      id: "global_checkout",
      label: "Checkout Global",
      enabled: true,
      sandboxMode: false,
      minBalanceAlertCents: 0,
      updatedAt: now,
    },
    {
      id: "zenobank",
      label: "ZenoBank Crypto Gateway",
      enabled: true,
      sandboxMode: true,
      minBalanceAlertCents: 0,
      updatedAt: now,
    },
    {
      id: "manual_inventory",
      label: "Inventario Propio (CSV)",
      enabled: true,
      sandboxMode: false,
      minBalanceAlertCents: 3,
      updatedAt: now,
    },
    {
      id: "reloadly",
      label: "Reloadly API (Solo KYC verificado)",
      enabled: false,
      sandboxMode: true,
      minBalanceAlertCents: 10000,
      updatedAt: now,
    },
    {
      id: "pagomovil",
      label: "Pago Móvil Venezuela (Bs)",
      enabled: false,
      sandboxMode: true,
      minBalanceAlertCents: 0,
      updatedAt: now,
    },
    {
      id: "centralone",
      label: "Central One Reseller API",
      enabled: true,
      sandboxMode: false,
      minBalanceAlertCents: 1000,
      updatedAt: now,
    },
    {
      id: "fazercards",
      label: "FazerCards API v2 (Netflix, Gift Cards & Top-Ups)",
      enabled: true,
      sandboxMode: false,
      minBalanceAlertCents: 1000,
      updatedAt: now,
    },
  ];

  return {
    products,
    inventory: seededCodes,
    orders: [],
    fulfillments: [],
    creditLedger,
    webhookEvents: [],
    providerConfigs,
    auditLog: [],
    profiles,
    bsRateCents: null,
    variantPricingMeta: {},
    pagoMovil: {
      receiverAccounts: [
        {
          id: "90000000-0000-4000-8000-000000000102",
          bankCode: "0102",
          bankName: "Banco de Venezuela",
          accountType: "juridical",
          phone: "04120000000",
          dni: "J-000000000",
          holderName: "StoryCheap Demo BDV",
          active: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      notifications: [],
      orderReports: {},
      settings: {
        rateExpirationMinutes: 20,
        orderExpirationMinutes: 25,
        amountToleranceBsCents: 5,
        minReferenceDigits: 6,
        incomingFeePct: 1.5,
        outgoingFeePct: 1.5,
      },
      webhookSecretCiphertext: null,
    },
    treasuryMovements: [],
    supportTickets: [],
    orderItemTargets: {},
    supplierOrders: [],
  };
}

export function getSandboxState(): SandboxState {
  if (!globalThis.__storycheapSandboxState) {
    globalThis.__storycheapSandboxState = createInitialSandboxState();
  }
  return globalThis.__storycheapSandboxState;
}

export function resetSandboxStateForTests(customSeedInventory?: SandboxInventoryRow[]) {
  const fresh = createInitialSandboxState();
  if (customSeedInventory) {
    fresh.inventory = customSeedInventory;
  }
  globalThis.__storycheapSandboxState = fresh;
  return fresh;
}

/**
 * Computes live stock & attaches variant stock metrics on a cloned catalog snapshot.
 */
export function buildSandboxCatalogSnapshot(includeInactive = false): ProductDTO[] {
  const state = getSandboxState();
  const reloadlyCfg = state.providerConfigs.find((c) => c.id === "reloadly");
  const centralOneCfg = state.providerConfigs.find((c) => c.id === "centralone");
  const manualCfg = state.providerConfigs.find((c) => c.id === "manual_inventory");
  const nowMs = Date.now();

  const availableMap = new Map<string, number>();
  for (const code of state.inventory) {
    if (
      code.status === "AVAILABLE" &&
      (!code.expiresAt || Date.parse(code.expiresAt) > nowMs)
    ) {
      availableMap.set(
        code.variantId,
        (availableMap.get(code.variantId) ?? 0) + 1
      );
    }
  }

  return state.products
    .filter((p) => includeInactive || p.active)
    .map((p) => ({
      ...p,
      variants: p.variants
        .filter((v) => includeInactive || v.active)
        .map((v) => {
          const meta = state.variantPricingMeta?.[v.id];
          const requiresTarget = Boolean(meta?.requiresTarget ?? v.requiresTarget);
          const targetFields = meta?.targetFields ?? v.targetFields;
          const targetSchema = meta?.targetSchema ?? v.targetSchema;
          const supportsPlayerValidate = Boolean(
            meta?.supportsPlayerValidate ?? v.supportsPlayerValidate
          );
          const manualCount =
            !requiresTarget && manualCfg?.enabled ? availableMap.get(v.id) ?? 0 : 0;
          const reloadlyAvailable =
            !requiresTarget &&
            Boolean(reloadlyCfg?.enabled) &&
            v.sourcePriority !== "manual_only" &&
            Boolean(v.reloadlyProductId);
          const centralOneAvailable =
            Boolean(centralOneCfg?.enabled) &&
            (v.sourcePriority === "manual_then_centralone" ||
              v.sourcePriority === "centralone_only") &&
            Boolean(v.centraloneProductId);
          const volumeDiscounts = normalizeVolumeDiscountTiers(
            meta?.volumeDiscounts ?? v.volumeDiscounts,
            v.salePriceCents
          );
          return {
            ...v,
            availableStock: manualCount,
            inStock: manualCount > 0 || reloadlyAvailable || centralOneAvailable,
            ...(volumeDiscounts.length > 0 ? { volumeDiscounts } : {}),
            ...(requiresTarget
              ? {
                  requiresTarget: true,
                  targetFields: targetFields ?? [],
                  targetSchema: targetSchema ?? [],
                  supportsPlayerValidate,
                }
              : {}),
          };
        }),
    }))
    .filter((p) => includeInactive || p.variants.length > 0);
}

export function computeSandboxCustomerSummaries(): CustomerSummaryDTO[] {
  const state = getSandboxState();
  return state.profiles.map((prof) => {
    const balance = state.creditLedger
      .filter((e) => e.userId === prof.id)
      .reduce((acc, e) => acc + e.deltaCents, 0);
    const userOrders = state.orders.filter(
      (o) => o.userId === prof.id || o.email.toLowerCase() === prof.email.toLowerCase()
    );
    const paidOrders = userOrders.filter((o) => o.paidCents > 0 || o.status === "DELIVERED");
    return {
      id: prof.id,
      email: prof.email,
      role: prof.role,
      creditBalanceCents: balance,
      ordersCount: userOrders.length,
      totalSpentCents: paidOrders.reduce((acc, o) => acc + o.subtotalCents, 0),
      createdAt: prof.createdAt,
    };
  });
}

export function hydrateSandboxOrder(order: OrderDTO): OrderDTO {
  const state = getSandboxState();
  const itemLookup = new Map<string, OrderItemDTO>();
  for (const it of order.items) {
    itemLookup.set(it.id, it);
  }
  const fulfillments = state.fulfillments
    .filter((f) => f.orderId === order.id)
    .map((f) => {
      const it = itemLookup.get(f.orderItemId);
      return {
        id: f.id,
        orderItemId: f.orderItemId,
        orderId: f.orderId,
        productName: it?.productName ?? "Gift Card",
        denominationLabel: it?.denominationLabel ?? "",
        region: it?.region ?? "USA",
        source: f.source,
        codeLast4: f.codeLast4,
        revealedAt: f.revealedAt,
        createdAt: f.createdAt,
      };
    });

  const targets = state.orderItemTargets?.[order.id] ?? {};
  return {
    ...order,
    items: order.items.map((it) => ({
      ...it,
      targetInfo: targets[it.id] ?? it.targetInfo ?? null,
    })),
    fulfillments,
  };
}
