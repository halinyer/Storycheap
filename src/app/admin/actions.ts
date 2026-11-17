"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { ADMIN_INCLUDE_TESTS_COOKIE } from "@/lib/server/admin-preferences";
import {
  BANK_BY_CODE,
  DEFAULT_ANDROID_PACKAGES_BY_BANK,
  normalizeVePhone,
} from "@/lib/catalog-banks";
import { requireAdminUser } from "@/lib/server/auth";
import { sendSupportTicketReplyEmail } from "@/lib/server/email";
import {
  adminRecordManualZenoPayment,
  adminRefundOrderToCredit,
  fulfillOrder,
  reconcileGatewaySession,
  syncAllPendingSupplierOrders,
  syncSupplierOrdersForOrder,
} from "@/lib/server/fulfillment";
import { getPaymentGateway } from "@/lib/server/payments";
import {
  deleteBotDevice,
  listBankNotifications,
  registerBotDevice,
  savePagoMovilBotSettings,
  saveReceiverBankAccount,
  setBotDeviceActive,
} from "@/lib/server/pagomovil-store";
import { adminManualConfirmPagoMovil } from "@/lib/server/payments/pagomovil-bot";
import { parseBankNotification } from "@/lib/server/payments/parsers";
import {
  appendAuditLog,
  appendCreditLedgerEntry,
  createProductWithVariantAdmin,
  createTreasuryMovementAdmin,
  createVariantAdmin,
  deleteProductAdmin,
  deleteVariantAdmin,
  getOrderById,
  getSupportSettings,
  insertInventoryBatch,
  listCatalog,
  markOrderAttentionFlag,
  previewCsvInventoryBatch,
  releaseExpiredReservations,
  replySupportTicketAdmin,
  saveMonthlyCapitalSnapshot,
  saveSupplierPricingPolicy,
  saveSupportSettings,
  saveVariantPricingMeta,
  saveZenoBinanceReceiver,
  setBsRateCents,
  setOrdersTestFlagAdmin,
  toggleProductActiveAdmin,
  toggleVariantActiveAdmin,
  updateProductAdmin,
  updateProviderConfig,
  updateVariantAdmin,
  voidInventoryCode,
  voidTreasuryMovementAdmin,
  type CapitalSnapshotRecord,
  type CsvPreviewRow,
  type VariantPricingMeta,
} from "@/lib/server/repository";
import {
  getCentralOneBalance,
  getCentralOneCatalog,
  type CentralOneCatalogItem,
} from "@/lib/server/suppliers/centralone";
import {
  getFazerCardsBalance,
  getFazerCardsCatalog,
} from "@/lib/server/suppliers/fazercards";
import { getReloadlyBalance } from "@/lib/server/suppliers/reloadly";
import {
  invalidateSupplierQuoteCache,
  syncSupplierCatalogCosts,
} from "@/lib/server/supplier-sync";
import type {
  BotDeviceDTO,
  PagoMovilBotSettingsDTO,
  ProviderConfigDTO,
  SourcePriority,
  SupplierPricingPolicy,
  SupplierSyncState,
  SupportSettingsDTO,
  SupportTicketStatus,
  TreasuryMovementDTO,
  TreasuryMovementType,
} from "@/types";

export async function parseCsvCodesAction(rawText: string): Promise<CsvPreviewRow[]> {
  await requireAdminUser();

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.toLowerCase().startsWith("code,"));

  const rows = lines.slice(0, 500).map((line) => {
    const parts = line.split(",").map((s) => s.trim());
    return {
      code: parts[0] ?? "",
      pin: parts[1] || null,
      expiresAt: parts[2] || null,
    };
  });

  return previewCsvInventoryBatch(rows);
}

const commitCsvSchema = z.object({
  variantId: z.string().uuid(),
  batchId: z.string().trim().min(2).max(60),
  rawText: z.string().min(4),
});

export async function commitCsvInventoryAction(input: {
  variantId: string;
  batchId: string;
  rawText: string;
}) {
  const adminUser = await requireAdminUser();
  const parsed = commitCsvSchema.parse(input);

  const lines = parsed.rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.toLowerCase().startsWith("code,"));

  const rows = lines.slice(0, 500).map((line) => {
    const parts = line.split(",").map((s) => s.trim());
    return {
      code: parts[0] ?? "",
      pin: parts[1] || null,
      expiresAt: parts[2] || null,
    };
  });

  const result = await insertInventoryBatch({
    variantId: parsed.variantId,
    batchId: parsed.batchId,
    rows,
  });

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "inventory.csv_import",
    targetType: "product_variant",
    targetId: parsed.variantId,
    metadata: {
      batchId: parsed.batchId,
      insertedCount: result.insertedCount,
      skippedDuplicates: result.skippedDuplicates,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  return result;
}

export async function voidInventoryCodeAction(inventoryId: string) {
  const adminUser = await requireAdminUser();
  const ok = await voidInventoryCode(inventoryId);
  if (!ok) {
    throw new Error("Solo se pueden anular códigos en estado AVAILABLE.");
  }

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "inventory.void_code",
    targetType: "code_inventory",
    targetId: inventoryId,
    metadata: {},
  });

  revalidatePath("/admin");
  revalidatePath("/admin/inventory");
}

export async function retryOrderFulfillmentAction(orderId: string) {
  const adminUser = await requireAdminUser();
  const syncResult = await syncSupplierOrdersForOrder(orderId).catch(() => ({
    checked: 0,
    addedCodes: 0,
  }));
  const current = await getOrderById(orderId);
  if (!current) {
    throw new Error("Orden no encontrada.");
  }

  const updated =
    current.status === "PAID" ||
    current.status === "PARTIAL" ||
    current.status === "MANUAL_REVIEW"
      ? await fulfillOrder(orderId)
      : current;

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "order.admin_retry_fulfill",
    targetType: "order",
    targetId: orderId,
    metadata: {
      resultingStatus: updated.status,
      syncedSupplierOrders: syncResult.checked,
      addedCodesFromSync: syncResult.addedCodes,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  return updated.status;
}

export async function resolveOrderAttentionAction(orderId: string) {
  const adminUser = await requireAdminUser();
  await markOrderAttentionFlag(orderId, false, null);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "order.admin_mark_resolved",
    targetType: "order",
    targetId: orderId,
    metadata: {},
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
}

export async function refundOrderToCreditAction(input: {
  orderId: string;
  reasonNote: string;
}) {
  const adminUser = await requireAdminUser();
  const cleanNote = input.reasonNote.trim();
  if (cleanNote.length < 5) {
    throw new Error("Debes escribir un motivo de al menos 5 caracteres.");
  }

  await adminRefundOrderToCredit({
    orderId: input.orderId,
    adminUser,
    reasonNote: cleanNote,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${input.orderId}`);
  revalidatePath("/admin/customers");
}

export async function syncZenoBankOrderAdminAction(orderId: string) {
  const adminUser = await requireAdminUser();
  const parsedOrderId = z.string().uuid().parse(orderId);
  const order = await getOrderById(parsedOrderId);
  if (!order) {
    throw new Error("Orden no encontrada.");
  }
  if (order.paymentGateway !== "zenobank") {
    throw new Error("Esta orden no utiliza pasarela ZenoBank.");
  }
  if (!order.gatewayCheckoutId) {
    throw new Error("Esta orden no tiene una sesión de checkout ZenoBank registrada.");
  }

  const gw = getPaymentGateway("zenobank");
  const liveSession = await gw.getCheckout(order.gatewayCheckoutId);
  const { reconciled, outcome } = await reconcileGatewaySession({
    order,
    session: liveSession,
    source: "admin_manual_sync",
  });
  const updated = (await getOrderById(order.id)) ?? order;
  const missingCents = Math.max(0, updated.amountDueCents - updated.paidCents);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "order.sync_zenobank",
    targetType: "order",
    targetId: order.id,
    metadata: {
      checkoutId: order.gatewayCheckoutId,
      liveStatus: liveSession.status,
      livePaidCents: liveSession.paidCents,
      expectedCents: updated.amountDueCents,
      missingCents,
      reconciled,
      outcome: outcome ?? null,
      resultingStatus: updated.status,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${order.id}`);
  revalidatePath(`/order/${order.id}`);

  return {
    liveStatus: liveSession.status,
    livePaidCents: liveSession.paidCents,
    expectedCents: updated.amountDueCents,
    missingCents,
    reconciled,
    nextStatus: updated.status,
  };
}

export async function recordManualZenoPaymentAdminAction(input: {
  orderId: string;
  receivedUsd: string;
  txReference?: string;
}) {
  const adminUser = await requireAdminUser();
  const parsedOrderId = z.string().uuid().parse(input.orderId);
  const normalizedStr = input.receivedUsd.trim().replace(",", ".");
  const parsedUsd = Number(normalizedStr);
  if (!Number.isFinite(parsedUsd) || parsedUsd <= 0) {
    throw new Error("Ingresa un monto recibido válido en USD (ej. 0.75 o 1.00).");
  }
  const receivedCents = Math.round(parsedUsd * 100);
  if (receivedCents <= 0) {
    throw new Error("El monto debe ser al menos $0.01 USD.");
  }

  const res = await adminRecordManualZenoPayment({
    orderId: parsedOrderId,
    receivedCents,
    txReference: input.txReference,
    adminUser,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${parsedOrderId}`);
  revalidatePath(`/order/${parsedOrderId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/account");

  return res;
}

export async function updateVariantAdminAction(input: {
  variantId: string;
  denominationLabel?: string;
  salePriceCents: number;
  unitCostCents: number | null;
  exactCostUsd?: string | null;
  sourcePriority: SourcePriority;
  reloadlyProductId: number | null;
  centraloneProductId: string | null;
  centraloneProductName?: string | null;
  centraloneSku?: string | null;
  centraloneRegion?: string | null;
  lowStockThreshold: number;
  active: boolean;
}) {
  const adminUser = await requireAdminUser();

  const trimmedLabel = input.denominationLabel?.trim();
  if (input.denominationLabel !== undefined && !trimmedLabel) {
    throw new Error("La etiqueta de denominación no puede estar vacía.");
  }

  await updateVariantAdmin(input.variantId, {
    denominationLabel: trimmedLabel,
    salePriceCents: input.salePriceCents,
    unitCostCents: input.unitCostCents,
    sourcePriority: input.sourcePriority,
    reloadlyProductId: input.reloadlyProductId,
    centraloneProductId: input.centraloneProductId,
    lowStockThreshold: input.lowStockThreshold,
    active: input.active,
  });

  const metaPatch: VariantPricingMeta = {
    exactCostUsd: input.exactCostUsd ?? null,
    centraloneProductName: input.centraloneProductId
      ? (input.centraloneProductName ?? null)
      : null,
    centraloneSku: input.centraloneProductId
      ? (input.centraloneSku ?? null)
      : null,
    centraloneRegion: input.centraloneProductId
      ? (input.centraloneRegion ?? null)
      : null,
  };
  await saveVariantPricingMeta(input.variantId, metaPatch, adminUser.id);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "catalog.update_variant",
    targetType: "product_variant",
    targetId: input.variantId,
    metadata: input,
  });

  revalidatePath("/", "layout");
  revalidatePath("/card/[slug]", "page");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
}

export async function updateBsRateAction(rateBsPerUsd: number | null) {
  const adminUser = await requireAdminUser();

  let bsRateCents: number | null = null;
  if (rateBsPerUsd !== null) {
    if (!Number.isFinite(rateBsPerUsd) || rateBsPerUsd <= 0) {
      throw new Error("La tasa Bs/USD debe ser mayor que cero.");
    }
    bsRateCents = Math.round(rateBsPerUsd * 100);
  }

  await setBsRateCents(bsRateCents, adminUser.id);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "settings.update_bs_rate",
    targetType: "store_settings",
    targetId: "bs_exchange_rate",
    metadata: { bsRateCents },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
}

export async function adjustCustomerCreditAction(input: {
  userId: string;
  deltaCents: number;
  note: string;
}) {
  const adminUser = await requireAdminUser();
  const cleanNote = input.note.trim();
  if (cleanNote.length < 5) {
    throw new Error("El motivo del ajuste contable es obligatorio.");
  }
  if (!Number.isInteger(input.deltaCents) || input.deltaCents === 0) {
    throw new Error("El monto debe ser un número entero distinto de cero (en centavos).");
  }

  await appendCreditLedgerEntry({
    userId: input.userId,
    deltaCents: input.deltaCents,
    reason: "admin_adjust",
    note: cleanNote,
    createdBy: adminUser.id,
  });

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "customer.credit_adjust",
    targetType: "profile",
    targetId: input.userId,
    metadata: { deltaCents: input.deltaCents, note: cleanNote },
  });

  revalidatePath("/admin/customers");
  revalidatePath("/admin/audit");
}

export async function toggleProviderConfigAction(input: {
  id: ProviderConfigDTO["id"];
  enabled: boolean;
}) {
  const adminUser = await requireAdminUser();
  await updateProviderConfig(input.id, { enabled: input.enabled }, adminUser.id);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "provider.toggle_enabled",
    targetType: "provider_config",
    targetId: input.id,
    metadata: { enabled: input.enabled },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/providers");
  revalidatePath("/");
}

export async function runReconcileCronAction() {
  const adminUser = await requireAdminUser();
  const res = await releaseExpiredReservations();
  const supplierSync = await syncAllPendingSupplierOrders().catch((err) => ({
    checked: 0,
    addedCodes: 0,
    errors: 1,
    error: err instanceof Error ? err.message : "Error syncing supplier orders",
  }));
  const combined = { ...res, supplierSync };
  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "system.manual_reconcile",
    targetType: "system",
    targetId: "reconcile",
    metadata: combined,
  });
  revalidatePath("/admin");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/orders");
  return combined;
}

export async function fetchCentralOneCatalogAdminAction(): Promise<CentralOneCatalogItem[]> {
  await requireAdminUser();
  return getCentralOneCatalog();
}

export async function fetchFazerCardsCatalogAdminAction(
  query?: string
): Promise<CentralOneCatalogItem[]> {
  await requireAdminUser();
  return getFazerCardsCatalog(query);
}

export async function toggleProductActiveAction(input: {
  productId: string;
  active: boolean;
}) {
  const adminUser = await requireAdminUser();
  await toggleProductActiveAdmin(input.productId, input.active);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "catalog.toggle_product_active",
    targetType: "product",
    targetId: input.productId,
    metadata: { active: input.active },
  });

  revalidatePath("/", "layout");
  revalidatePath("/card/[slug]", "page");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
}

const toggleVariantActiveSchema = z.object({
  variantId: z.string().uuid(),
  active: z.boolean(),
});

export async function toggleVariantActiveAction(input: {
  variantId: string;
  active: boolean;
}) {
  const adminUser = await requireAdminUser();
  const parsed = toggleVariantActiveSchema.parse(input);
  await toggleVariantActiveAdmin(parsed.variantId, parsed.active);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "catalog.toggle_variant_active",
    targetType: "product_variant",
    targetId: parsed.variantId,
    metadata: { active: parsed.active },
  });

  revalidatePath("/", "layout");
  revalidatePath("/card/[slug]", "page");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
}

const deleteVariantSchema = z.object({
  variantId: z.string().uuid(),
});

export async function deleteVariantAdminAction(input: { variantId: string }) {
  const adminUser = await requireAdminUser();
  const parsed = deleteVariantSchema.parse(input);
  const res = await deleteVariantAdmin(parsed.variantId, adminUser.id);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: res.archived ? "catalog.archive_variant" : "catalog.delete_variant",
    targetType: "product_variant",
    targetId: parsed.variantId,
    metadata: res,
  });

  revalidatePath("/", "layout");
  revalidatePath("/card/[slug]", "page");
  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin");
  return res;
}

const deleteProductSchema = z.object({
  productId: z.string().uuid(),
});

export async function deleteProductAdminAction(input: { productId: string }) {
  const adminUser = await requireAdminUser();
  const parsed = deleteProductSchema.parse(input);
  const res = await deleteProductAdmin(parsed.productId, adminUser.id);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: res.archived ? "catalog.archive_product" : "catalog.delete_product",
    targetType: "product",
    targetId: parsed.productId,
    metadata: res,
  });

  revalidatePath("/", "layout");
  revalidatePath("/card/[slug]", "page");
  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin");
  return res;
}

const productImageUrlSchema = z
  .string()
  .trim()
  .max(200_000, "La imagen es demasiado pesada (máx. ~150 KB)")
  .refine(
    (val) =>
      val.startsWith("/") ||
      /^https?:\/\//i.test(val) ||
      /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(val),
    "URL o formato de imagen inválido (usa /cards/..., https://... o sube PNG/JPG/WebP)."
  );

const updateProductMetaSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  region: z.enum(["USA", "Global", "Latam", "Europa"]),
  category: z.enum(["gaming", "streaming", "shopping", "crypto"]),
  imageUrl: productImageUrlSchema.optional(),
});

export async function updateProductMetaAction(
  input: z.infer<typeof updateProductMetaSchema>
) {
  const adminUser = await requireAdminUser();
  const parsed = updateProductMetaSchema.parse(input);

  await updateProductAdmin(parsed.productId, {
    name: parsed.name,
    region: parsed.region,
    category: parsed.category,
    ...(parsed.imageUrl ? { imageUrl: parsed.imageUrl } : {}),
  });

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "catalog.update_product",
    targetType: "product",
    targetId: parsed.productId,
    metadata: parsed,
  });

  revalidatePath("/", "layout");
  revalidatePath("/card/[slug]", "page");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
}

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(80),
  brand: z.string().trim().max(40).optional(),
  category: z.enum(["gaming", "streaming", "shopping", "crypto"]),
  region: z.enum(["USA", "Global", "Latam", "Europa"]),
  description: z.string().trim().max(400).optional(),
  imageUrl: productImageUrlSchema.optional(),
  denominationLabel: z.string().trim().min(1).max(40),
  faceValueCents: z.number().int().positive(),
  salePriceCents: z.number().int().positive(),
  unitCostCents: z.number().int().nonnegative().nullable(),
  sourcePriority: z.enum([
    "manual_only",
    "manual_then_reloadly",
    "reloadly_only",
    "manual_then_centralone",
    "centralone_only",
  ]),
  centraloneProductId: z.string().trim().nullable().optional(),
  exactCostUsd: z.string().trim().nullable().optional(),
  centraloneProductName: z.string().trim().nullable().optional(),
  centraloneSku: z.string().trim().nullable().optional(),
  centraloneRegion: z.string().trim().nullable().optional(),
  reloadlyProductId: z.number().int().positive().nullable().optional(),
});

export async function createProductAction(
  input: z.infer<typeof createProductSchema>
) {
  const adminUser = await requireAdminUser();
  const parsed = createProductSchema.parse(input);
  const created = await createProductWithVariantAdmin({
    ...parsed,
    centraloneProductId: parsed.centraloneProductId || null,
    reloadlyProductId: parsed.reloadlyProductId ?? null,
    active: true,
  });

  if (parsed.exactCostUsd || parsed.centraloneProductName || parsed.centraloneSku) {
    await saveVariantPricingMeta(
      created.variantId,
      {
        exactCostUsd: parsed.exactCostUsd ?? null,
        centraloneProductName: parsed.centraloneProductName ?? null,
        centraloneSku: parsed.centraloneSku ?? null,
        centraloneRegion: parsed.centraloneRegion ?? null,
      },
      adminUser.id
    );
  }

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "catalog.create_product",
    targetType: "product",
    targetId: created.productId,
    metadata: { name: parsed.name, variantId: created.variantId },
  });

  revalidatePath("/");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  return created;
}

const createVariantSchema = z.object({
  productId: z.string().uuid(),
  denominationLabel: z.string().trim().min(1).max(40),
  faceValueCents: z.number().int().positive(),
  salePriceCents: z.number().int().positive(),
  unitCostCents: z.number().int().nonnegative().nullable(),
  sourcePriority: z.enum([
    "manual_only",
    "manual_then_reloadly",
    "reloadly_only",
    "manual_then_centralone",
    "centralone_only",
  ]),
  centraloneProductId: z.string().trim().nullable().optional(),
  exactCostUsd: z.string().trim().nullable().optional(),
  centraloneProductName: z.string().trim().nullable().optional(),
  centraloneSku: z.string().trim().nullable().optional(),
  centraloneRegion: z.string().trim().nullable().optional(),
});

export async function createVariantAction(
  input: z.infer<typeof createVariantSchema>
) {
  const adminUser = await requireAdminUser();
  const parsed = createVariantSchema.parse(input);
  const variantId = await createVariantAdmin({
    ...parsed,
    centraloneProductId: parsed.centraloneProductId || null,
    active: true,
  });

  if (parsed.exactCostUsd || parsed.centraloneProductName || parsed.centraloneSku) {
    await saveVariantPricingMeta(
      variantId,
      {
        exactCostUsd: parsed.exactCostUsd ?? null,
        centraloneProductName: parsed.centraloneProductName ?? null,
        centraloneSku: parsed.centraloneSku ?? null,
        centraloneRegion: parsed.centraloneRegion ?? null,
      },
      adminUser.id
    );
  }

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "catalog.create_variant",
    targetType: "product_variant",
    targetId: variantId,
    metadata: { productId: parsed.productId, label: parsed.denominationLabel },
  });

  revalidatePath("/");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  return { variantId };
}

export async function captureMonthlyCapitalSnapshotAction(
  targetMonth?: string
): Promise<CapitalSnapshotRecord[]> {
  const adminUser = await requireAdminUser();
  const now = new Date();
  const month =
    targetMonth && /^\d{4}-\d{2}$/.test(targetMonth)
      ? targetMonth
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [centralOne, fazerCards, reloadly, catalog] = await Promise.all([
    getCentralOneBalance(),
    getFazerCardsBalance(),
    getReloadlyBalance(),
    listCatalog(true),
  ]);

  let manualCostCents = 0;
  for (const product of catalog) {
    for (const variant of product.variants) {
      if (variant.availableStock > 0 && typeof variant.unitCostCents === "number") {
        manualCostCents += variant.availableStock * variant.unitCostCents;
      }
    }
  }

  const byProvider: Record<string, number> = {
    centralone: centralOne.balanceCents ?? 0,
    fazercards: fazerCards.balanceCents ?? 0,
    manual: manualCostCents,
    reloadly: reloadly.balanceCents ?? 0,
  };
  const totalCents =
    byProvider.centralone +
    byProvider.fazercards +
    byProvider.manual +
    byProvider.reloadly;

  const updated = await saveMonthlyCapitalSnapshot(
    {
      month,
      totalCents,
      byProvider,
      capturedAt: now.toISOString(),
    },
    adminUser.id
  );

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "capital.capture_monthly_snapshot",
    targetType: "store_settings",
    targetId: month,
    metadata: { month, totalCents, byProvider },
  });

  revalidatePath("/admin");
  return updated;
}

// ============================================================================
// PAGO MOVIL BOT VERIFIER ADMIN ACTIONS
// ============================================================================

export async function saveReceiverBankAccountAction(input: {
  id?: string;
  bankCode: string;
  accountType: "natural" | "juridical";
  phone: string;
  dni: string;
  holderName: string;
  allowedPackagesRaw?: string;
  active: boolean;
}) {
  const adminUser = await requireAdminUser();
  const bankInfo = BANK_BY_CODE.get(input.bankCode.trim());
  const normalizedPhone = normalizeVePhone(input.phone);
  if (!normalizedPhone || normalizedPhone.length < 10) {
    throw new Error("Ingresa un teléfono Pago Móvil venezolano válido (ej. 04121234567).");
  }
  const cleanDni = input.dni.trim().toUpperCase();
  if (cleanDni.length < 5) {
    throw new Error("Ingresa la cédula o RIF (ej. V-24123456).");
  }
  const cleanHolder = input.holderName.trim();
  if (cleanHolder.length < 3) {
    throw new Error("Ingresa el nombre del titular de la cuenta.");
  }

  const parsedPackages = input.allowedPackagesRaw
    ? input.allowedPackagesRaw
        .split(/[,\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_ANDROID_PACKAGES_BY_BANK[input.bankCode.trim()] ?? [
        "SMS",
        "EMAIL",
      ];

  const saved = await saveReceiverBankAccount(
    {
      id: input.id,
      bankCode: input.bankCode.trim(),
      bankName: bankInfo?.name ?? "Bancamiga",
      accountType: input.accountType,
      phone: normalizedPhone,
      dni: cleanDni,
      holderName: cleanHolder,
      allowedPackages: parsedPackages,
      active: input.active,
    },
    adminUser.id
  );

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "pagomovil.save_receiver_account",
    targetType: "receiver_bank_account",
    targetId: saved.id,
    metadata: {
      bankCode: saved.bankCode,
      accountType: saved.accountType,
      active: saved.active,
    },
  });

  revalidatePath("/admin/pagomovil");
  revalidatePath("/checkout");
  return saved;
}

export async function registerBotDeviceAction(input: {
  name: string;
  channelType: BotDeviceDTO["channelType"];
  allowPlainBearer: boolean;
  deviceIdentifier?: string;
}) {
  const adminUser = await requireAdminUser();
  const cleanName = input.name.trim();
  if (cleanName.length < 2) {
    throw new Error("El nombre del dispositivo debe tener al menos 2 caracteres.");
  }

  const res = await registerBotDevice(
    {
      name: cleanName,
      channelType: input.channelType,
      allowPlainBearer: input.allowPlainBearer,
      deviceIdentifier: input.deviceIdentifier?.trim() || undefined,
    },
    adminUser.id
  );

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "pagomovil.register_device",
    targetType: "bot_device",
    targetId: res.device.id,
    metadata: {
      name: res.device.name,
      channelType: res.device.channelType,
      allowPlainBearer: res.device.allowPlainBearer,
    },
  });

  revalidatePath("/admin/pagomovil");
  return res;
}

export async function toggleBotDeviceAction(input: {
  deviceId: string;
  active: boolean;
}) {
  const adminUser = await requireAdminUser();
  await setBotDeviceActive(input.deviceId, input.active, adminUser.id);
  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "pagomovil.toggle_device",
    targetType: "bot_device",
    targetId: input.deviceId,
    metadata: { active: input.active },
  });
  revalidatePath("/admin/pagomovil");
}

export async function deleteBotDeviceAction(deviceId: string) {
  const adminUser = await requireAdminUser();
  await deleteBotDevice(deviceId, adminUser.id);
  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "pagomovil.delete_device",
    targetType: "bot_device",
    targetId: deviceId,
    metadata: {},
  });
  revalidatePath("/admin/pagomovil");
}

export async function savePagoMovilBotSettingsAction(
  input: Partial<PagoMovilBotSettingsDTO>
) {
  const adminUser = await requireAdminUser();
  const saved = await savePagoMovilBotSettings(input, adminUser.id);
  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "pagomovil.save_settings",
    targetType: "store_settings",
    targetId: "pagomovil_bot_settings",
    metadata: { ...saved },
  });
  revalidatePath("/admin/pagomovil");
  revalidatePath("/checkout");
  return saved;
}

export async function testNotificationParserAction(input: {
  title?: string;
  content: string;
  appPackage?: string;
  sourceType?: "APP_PUSH" | "SMS" | "EMAIL";
  preferredBankCode?: string;
}) {
  await requireAdminUser();
  if (!input.content.trim()) {
    throw new Error("Ingresa el texto de prueba de la notificación.");
  }
  const parsed = parseBankNotification({
    title: input.title ?? null,
    content: input.content,
    appPackage: input.appPackage ?? null,
    sourceType: input.sourceType ?? "APP_PUSH",
    preferredBankCode: input.preferredBankCode ?? "0172",
  });
  const senderBankName = parsed.senderBankCode
    ? BANK_BY_CODE.get(parsed.senderBankCode)?.name ?? null
    : null;
  return { ...parsed, senderBankName };
}

export async function manualConfirmPagoMovilAction(input: {
  orderId: string;
  referenceDigits: string;
  paidBsCents?: number | null;
  notificationId?: string | null;
  note?: string;
}) {
  const adminUser = await requireAdminUser();
  const res = await adminManualConfirmPagoMovil({
    orderId: input.orderId,
    adminUser,
    referenceDigits: input.referenceDigits,
    paidBsCents: input.paidBsCents,
    notificationId: input.notificationId,
    note: input.note,
  });
  revalidatePath("/admin/pagomovil");
  revalidatePath("/admin/orders");
  revalidatePath(`/order/${input.orderId}`);
  return res;
}

export async function listBankNotificationsAdminAction() {
  await requireAdminUser();
  return listBankNotifications(100);
}

export async function fetchLiveVenezuelaRatesAction(): Promise<{
  officialBcv: number | null;
  paralelo: number | null;
  source: string;
  fetchedAt: string;
}> {
  await requireAdminUser();
  try {
    const res = await fetch("https://ve.dolarapi.com/v1/dolares", {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const items = (await res.json()) as Array<{
      fuente?: string;
      nombre?: string;
      promedio?: number;
    }>;
    let officialBcv: number | null = null;
    let paralelo: number | null = null;
    for (const item of items) {
      const f = (item.fuente ?? item.nombre ?? "").toLowerCase();
      if (f.includes("oficial") && typeof item.promedio === "number") {
        officialBcv = item.promedio;
      } else if (f.includes("paralelo") && typeof item.promedio === "number") {
        paralelo = item.promedio;
      }
    }
    return {
      officialBcv,
      paralelo,
      source: "ve.dolarapi.com",
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `No se pudo consultar ve.dolarapi.com (${err.message})`
        : "No se pudo consultar tasa en vivo."
    );
  }
}

export async function saveZenoBinanceReceiverAction(input: {
  label: string;
  binanceAccount: string;
  network: string;
  storeReference?: string;
  notes?: string;
}) {
  const adminUser = await requireAdminUser();
  const label = input.label.trim();
  const binanceAccount = input.binanceAccount.trim();
  if (label.length < 2) {
    throw new Error("Ingresa un nombre para identificar la receptora Binance.");
  }
  if (binanceAccount.length < 3) {
    throw new Error("Ingresa el correo, Binance Pay ID, UID o wallet de Binance receptora.");
  }

  const saved = await saveZenoBinanceReceiver(
    {
      label,
      binanceAccount,
      network: input.network.trim() || "USDT",
      storeReference: (input.storeReference ?? "").trim(),
      notes: (input.notes ?? "").trim(),
    },
    adminUser.id
  );

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "zeno_receiver.save",
    targetType: "store_settings",
    targetId: "zenobank_binance_receiver",
    metadata: {
      label: saved.label,
      binanceAccount: saved.binanceAccount,
      network: saved.network,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/treasury");
  revalidatePath("/admin/providers");
  revalidatePath("/admin/orders");
  return saved;
}

// ============================================================================
// TREASURY (LIBRO DE CAJA) & TEST ORDER RECONCILIATION ACTIONS
// ============================================================================

function revalidateFinanceViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/treasury");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/audit");
  revalidatePath("/admin/providers");
}

export async function setAdminIncludeTestsAction(includeTests: boolean) {
  await requireAdminUser();
  const store = await cookies();
  store.set(ADMIN_INCLUDE_TESTS_COOKIE, includeTests ? "1" : "0", {
    path: "/admin",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    httpOnly: true,
  });
  revalidateFinanceViews();
}

const createTreasuryMovementSchema = z.object({
  movementType: z.enum([
    "CAPITAL_IN",
    "SUPPLIER_TOPUP",
    "INTERNAL_TRANSFER",
    "PROFIT_WITHDRAWAL",
    "EXPENSE_FEE",
    "RECONCILIATION_ADJUSTMENT",
  ]),
  sourceAccount: z.string().trim().min(1).max(60),
  targetAccount: z.string().trim().min(1).max(60),
  amountUsdCents: z.number().int().min(0).max(500_000_000),
  amountBsCents: z.number().int().min(0).max(5_000_000_000).nullable().optional(),
  exchangeRateCents: z.number().int().min(1).max(50_000_000).nullable().optional(),
  partnerName: z.string().trim().max(80).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(400).optional(),
  occurredAt: z.string().datetime().optional(),
  relatedOrderId: z.string().uuid().nullable().optional(),
});

export async function createTreasuryMovementAction(input: {
  movementType: TreasuryMovementType;
  sourceAccount: string;
  targetAccount: string;
  amountUsdCents: number;
  amountBsCents?: number | null;
  exchangeRateCents?: number | null;
  partnerName?: string | null;
  reference?: string | null;
  notes?: string;
  occurredAt?: string;
  relatedOrderId?: string | null;
}): Promise<TreasuryMovementDTO> {
  const adminUser = await requireAdminUser();
  const parsed = createTreasuryMovementSchema.parse(input);
  if (parsed.amountUsdCents <= 0 && (!parsed.amountBsCents || parsed.amountBsCents <= 0)) {
    throw new Error("El monto debe ser mayor a $0.00.");
  }
  if (parsed.sourceAccount === parsed.targetAccount) {
    throw new Error("La cuenta de origen y destino no pueden ser iguales.");
  }

  const created = await createTreasuryMovementAdmin({
    movementType: parsed.movementType,
    sourceAccount: parsed.sourceAccount,
    targetAccount: parsed.targetAccount,
    amountUsdCents: parsed.amountUsdCents,
    amountBsCents: parsed.amountBsCents ?? null,
    exchangeRateCents: parsed.exchangeRateCents ?? null,
    partnerName: parsed.partnerName || null,
    reference: parsed.reference || null,
    notes: parsed.notes ?? "",
    occurredAt: parsed.occurredAt,
    relatedOrderId: parsed.relatedOrderId ?? null,
    createdBy: adminUser.id,
  });

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "treasury.movement_created",
    targetType: "treasury_movement",
    targetId: created.id,
    metadata: {
      movementType: created.movementType,
      sourceAccount: created.sourceAccount,
      targetAccount: created.targetAccount,
      amountUsdCents: created.amountUsdCents,
      amountBsCents: created.amountBsCents,
      partnerName: created.partnerName,
    },
  });

  revalidateFinanceViews();
  return created;
}

export async function voidTreasuryMovementAction(input: {
  movementId: string;
  reason: string;
}): Promise<TreasuryMovementDTO> {
  const adminUser = await requireAdminUser();
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new Error("Indica el motivo de la anulación (mínimo 3 caracteres).");
  }

  const voided = await voidTreasuryMovementAdmin(
    input.movementId,
    reason,
    adminUser.id
  );

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "treasury.movement_voided",
    targetType: "treasury_movement",
    targetId: voided.id,
    metadata: { reason },
  });

  revalidateFinanceViews();
  return voided;
}

export async function toggleOrderTestFlagAction(input: {
  orderId: string;
  isTest: boolean;
  testNote?: string | null;
}) {
  const adminUser = await requireAdminUser();
  const cleanNote = input.testNote?.trim() || null;

  const result = await setOrdersTestFlagAdmin(
    [input.orderId],
    input.isTest,
    cleanNote,
    adminUser.id
  );

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: input.isTest ? "order.marked_as_test" : "order.unmarked_as_test",
    targetType: "order",
    targetId: input.orderId,
    metadata: {
      isTest: input.isTest,
      testNote: cleanNote,
      usedCompatibilityStore: result.usedCompatibilityStore,
    },
  });

  revalidateFinanceViews();
  revalidatePath(`/admin/orders/${input.orderId}`);
  return result;
}

const settleHistoricalTestsSchema = z.object({
  orderIds: z.array(z.string().min(1)).max(200),
  testNote: z.string().trim().max(240).optional(),
  openingSupplierCapitalCents: z.record(z.string(), z.number().int().min(0).max(500_000_000)),
  openingReceiverUsdCents: z
    .object({
      zenobank: z.number().int().min(0).max(500_000_000).optional(),
      pagomovilUsdCents: z.number().int().min(0).max(500_000_000).optional(),
      pagomovilBsCents: z.number().int().min(0).max(5_000_000_000).optional(),
    })
    .optional(),
});

export async function settleHistoricalTestsAction(input: {
  orderIds: string[];
  testNote?: string;
  openingSupplierCapitalCents: Record<string, number>;
  openingReceiverUsdCents?: {
    zenobank?: number;
    pagomovilUsdCents?: number;
    pagomovilBsCents?: number;
  };
}) {
  const adminUser = await requireAdminUser();
  const parsed = settleHistoricalTestsSchema.parse(input);
  const note =
    parsed.testNote?.trim() ||
    "Orden de prueba inicial conciliada al cerrar etapa de pruebas";

  if (parsed.orderIds.length > 0) {
    await setOrdersTestFlagAdmin(parsed.orderIds, true, note, adminUser.id);
  }

  const createdIds: string[] = [];
  for (const [supplierId, amountCents] of Object.entries(
    parsed.openingSupplierCapitalCents
  )) {
    if (amountCents <= 0) continue;
    const m = await createTreasuryMovementAdmin({
      movementType: "CAPITAL_IN",
      sourceAccount: "external",
      targetAccount: supplierId,
      amountUsdCents: amountCents,
      notes: `Saldo vivo inicial tras cuadre de pruebas (${supplierId})`,
      createdBy: adminUser.id,
    });
    createdIds.push(m.id);
  }

  const zenoOpen = parsed.openingReceiverUsdCents?.zenobank ?? 0;
  if (zenoOpen > 0) {
    const m = await createTreasuryMovementAdmin({
      movementType: "CAPITAL_IN",
      sourceAccount: "external",
      targetAccount: "zenobank",
      amountUsdCents: zenoOpen,
      notes: "Saldo inicial auditado en Binance / ZenoBank",
      createdBy: adminUser.id,
    });
    createdIds.push(m.id);
  }

  const pmUsdOpen = parsed.openingReceiverUsdCents?.pagomovilUsdCents ?? 0;
  const pmBsOpen = parsed.openingReceiverUsdCents?.pagomovilBsCents ?? 0;
  if (pmUsdOpen > 0 || pmBsOpen > 0) {
    const m = await createTreasuryMovementAdmin({
      movementType: "CAPITAL_IN",
      sourceAccount: "external",
      targetAccount: "pagomovil",
      amountUsdCents: pmUsdOpen,
      amountBsCents: pmBsOpen > 0 ? pmBsOpen : null,
      notes: "Saldo inicial auditado en Bancamiga / Pago Móvil",
      createdBy: adminUser.id,
    });
    createdIds.push(m.id);
  }

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "treasury.settle_historical_tests",
    targetType: "treasury_movement",
    targetId: createdIds[0] ?? "batch",
    metadata: {
      flaggedOrdersCount: parsed.orderIds.length,
      createdMovementIds: createdIds,
      openingSupplierCapitalCents: parsed.openingSupplierCapitalCents,
    },
  });

  revalidateFinanceViews();
  return {
    flaggedOrdersCount: parsed.orderIds.length,
    createdMovementsCount: createdIds.length,
  };
}

export async function syncSupplierPricesAdminAction(): Promise<SupplierSyncState> {
  const adminUser = await requireAdminUser();
  invalidateSupplierQuoteCache();
  const state = await syncSupplierCatalogCosts({
    force: true,
    updatedBy: adminUser.id,
  });

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "catalog.sync_supplier_prices",
    targetType: "catalog",
    targetId: "all",
    metadata: {
      checkedCount: state.checkedCount,
      updatedCostCount: state.updatedCostCount,
      adjustedSaleCount: state.adjustedSaleCount,
      atRiskCount: state.atRiskCount,
      lastError: state.lastError,
    },
  });

  revalidatePath("/", "layout");
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  return state;
}

const supplierPricingPolicySchema = z.object({
  mode: z.enum(["protect_floor", "keep_margin_on_increase", "cost_only_block"]),
  minMarginPct: z.number().min(0).max(100),
  minMarginUsdCents: z.number().int().min(0).max(50_000),
  autoSyncIntervalMinutes: z.number().int().min(1).max(1440),
});

export async function updateSupplierPricingPolicyAdminAction(
  input: SupplierPricingPolicy
): Promise<SupplierPricingPolicy> {
  const adminUser = await requireAdminUser();
  const parsed = supplierPricingPolicySchema.parse(input);
  const saved = await saveSupplierPricingPolicy(parsed, adminUser.id);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "catalog.update_supplier_policy",
    targetType: "store_setting",
    targetId: "supplier_pricing_policy",
    metadata: { ...saved },
  });

  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
  return saved;
}

const supportSettingsSchema = z.object({
  supportEmail: z.string().trim().email("Correo público inválido"),
  adminNotifyEmail: z
    .union([z.string().trim().email("Correo de alertas inválido"), z.literal(""), z.null()])
    .optional(),
  whatsappEnabled: z.boolean(),
  whatsappNumber: z.string().trim().max(40),
  supportHours: z.string().trim().min(2).max(120),
  floatingWidgetEnabled: z.boolean(),
  welcomeMessage: z.string().trim().min(5).max(400),
});

export async function updateSupportSettingsAdminAction(
  input: Omit<SupportSettingsDTO, "updatedAt">
): Promise<SupportSettingsDTO> {
  const adminUser = await requireAdminUser();
  const parsed = supportSettingsSchema.parse(input);
  const saved = await saveSupportSettings(
    {
      ...parsed,
      adminNotifyEmail: parsed.adminNotifyEmail?.trim() || null,
    },
    adminUser.id
  );

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "support.update_settings",
    targetType: "store_setting",
    targetId: "support_settings",
    metadata: {
      whatsappEnabled: saved.whatsappEnabled,
      floatingWidgetEnabled: saved.floatingWidgetEnabled,
      supportEmail: saved.supportEmail,
    },
  });

  revalidatePath("/ayuda");
  revalidatePath("/admin/support");
  revalidatePath("/", "layout");
  return saved;
}

const replySupportTicketSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]),
  reply: z.string().trim().max(3000).nullable().optional(),
});

export async function replySupportTicketAdminAction(input: {
  ticketId: string;
  status: SupportTicketStatus;
  reply?: string | null;
}) {
  const adminUser = await requireAdminUser();
  const parsed = replySupportTicketSchema.parse(input);
  const updated = await replySupportTicketAdmin({
    ticketId: parsed.ticketId,
    status: parsed.status,
    reply: parsed.reply ?? null,
    actorId: adminUser.id,
    actorEmail: adminUser.email,
  });

  let emailSent = false;
  if (parsed.reply && parsed.reply.trim()) {
    const settings = await getSupportSettings();
    const mailRes = await sendSupportTicketReplyEmail({
      to: updated.customerEmail,
      replyTo: settings.supportEmail,
      customerName: updated.customerName,
      ticketNumber: updated.ticketNumber,
      subject: updated.subject,
      replyMessage: parsed.reply.trim(),
      orderNumber: updated.orderNumber,
    }).catch(() => ({ sent: false }));
    emailSent = Boolean(mailRes?.sent);
  }

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "support.reply_ticket",
    targetType: "support_ticket",
    targetId: updated.id,
    metadata: {
      ticketNumber: updated.ticketNumber,
      status: updated.status,
      hasReply: Boolean(parsed.reply?.trim()),
      emailSent,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/support");
  revalidatePath("/account");
  return { ticket: updated, emailSent };
}
