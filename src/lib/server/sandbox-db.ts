import "server-only";
import { CATALOG_SEED } from "@/lib/catalog-seed";
import type {
  AuditLogEntryDTO,
  CreditLedgerEntryDTO,
  CustomerSummaryDTO,
  InventoryStatus,
  OrderDTO,
  OrderItemDTO,
  ProductDTO,
  ProviderConfigDTO,
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
      id: "pablito",
      label: "Pablito Pago Móvil (Próximamente)",
      enabled: false,
      sandboxMode: true,
      minBalanceAlertCents: 0,
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
          const manualCount = manualCfg?.enabled ? availableMap.get(v.id) ?? 0 : 0;
          const reloadlyAvailable =
            Boolean(reloadlyCfg?.enabled) &&
            v.sourcePriority !== "manual_only" &&
            Boolean(v.reloadlyProductId);
          return {
            ...v,
            availableStock: manualCount,
            inStock: manualCount > 0 || reloadlyAvailable,
          };
        }),
    }));
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

  return {
    ...order,
    items: order.items.map((it) => ({ ...it })),
    fulfillments,
  };
}
