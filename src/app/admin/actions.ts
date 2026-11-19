"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { ADMIN_INCLUDE_TESTS_COOKIE } from "@/lib/server/admin-preferences";
import {
  BANK_BY_CODE,
  normalizeVePhone,
} from "@/lib/catalog-banks";
import { requireAdminUser } from "@/lib/server/auth";
import { validateVolumeDiscountTiersForAdmin } from "@/lib/volume-discounts";
import type { VolumeDiscountTier } from "@/types";
import { sendSupportTicketReplyEmail } from "@/lib/server/email";
import {
  adminRecordManualZenoPayment,
  adminRefundOrderToCredit,
  applyVerifiedBinancePayTxToOrder,
  autoReconcileBinancePayForOrder,
  fulfillOrder,
  listRecentBinancePayCandidatesForOrder,
  reconcileGatewaySession,
  syncAllPendingSupplierOrders,
  syncSupplierOrdersForOrder,
} from "@/lib/server/fulfillment";
import { getPaymentGateway } from "@/lib/server/payments";
import {
  listBankNotifications,
  savePagoMovilSettings,
  saveReceiverBankAccount,
} from "@/lib/server/pagomovil-store";
import {
  adminManualConfirmPagoMovil,
  adminTestBdvConciliacion,
} from "@/lib/server/payments/pagomovil-bdv";
import { parseUserBsInputToCents } from "@/lib/server/payments/bdv-api";
import { buildTreasuryMovementWithFeePlan } from "@/lib/server/treasury-metrics";
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
  isFazerCardsProductId,
} from "@/lib/server/suppliers/fazercards";
import { getReloadlyBalance } from "@/lib/server/suppliers/reloadly";
import {
  fetchLiveVenezuelaRates,
  saveBsRateAutoSyncPolicy,
  syncBsExchangeRateIfNeeded,
} from "@/lib/server/exchange-rates";
import {
  fetchLiveQuoteForSku,
  invalidateSupplierQuoteCache,
  syncSupplierCatalogCosts,
} from "@/lib/server/supplier-sync";
import { isLoginModeTarget } from "@/lib/topup-targets";
import type {
  BsRateAutoSyncPolicy,
  LiveVenezuelaRatesSnapshot,
  PagoMovilSettingsDTO,
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
  let { reconciled, outcome } = await reconcileGatewaySession({
    order,
    session: liveSession,
    source: "admin_manual_sync",
  });
  let updated = (await getOrderById(order.id)) ?? order;

  if (updated.paidCents < updated.amountDueCents) {
    const autoBinance = await autoReconcileBinancePayForOrder({
      orderId: order.id,
      actorUser: adminUser,
      source: "admin_tx_verify",
      minAgeMs: 0,
    }).catch(() => null);
    if (autoBinance?.matched) {
      reconciled = true;
      outcome = autoBinance.mode;
      updated = autoBinance.order;
    }
  }

  const effectivePaidCents = Math.max(liveSession.paidCents, updated.paidCents);
  const missingCents = Math.max(0, updated.amountDueCents - effectivePaidCents);
  const surplusCents = Math.max(0, effectivePaidCents - updated.amountDueCents);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "order.sync_zenobank",
    targetType: "order",
    targetId: order.id,
    metadata: {
      checkoutId: order.gatewayCheckoutId,
      liveStatus: liveSession.status,
      livePaidCents: effectivePaidCents,
      expectedCents: updated.amountDueCents,
      missingCents,
      surplusCents,
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
    liveStatus:
      effectivePaidCents >= updated.amountDueCents
        ? "COMPLETED"
        : liveSession.status,
    livePaidCents: effectivePaidCents,
    expectedCents: updated.amountDueCents,
    missingCents,
    surplusCents,
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

export async function listBinancePayCandidatesAdminAction(orderId: string) {
  await requireAdminUser();
  const parsedOrderId = z.string().uuid().parse(orderId);
  return listRecentBinancePayCandidatesForOrder(parsedOrderId);
}

export async function applyBinancePayTxAdminAction(input: {
  orderId: string;
  transactionId: string;
}) {
  const adminUser = await requireAdminUser();
  const parsedOrderId = z.string().uuid().parse(input.orderId);
  const cleanTx = input.transactionId.trim();
  if (cleanTx.length < 6) {
    throw new Error("ID de transacción Binance Pay inválido.");
  }

  const res = await applyVerifiedBinancePayTxToOrder({
    orderId: parsedOrderId,
    transactionId: cleanTx,
    actorUser: adminUser,
    source: "admin_tx_verify",
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${parsedOrderId}`);
  revalidatePath(`/order/${parsedOrderId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/account");
  revalidatePath("/admin/treasury");

  return {
    mode: res.mode,
    receivedCents: res.receivedCents,
    missingCents: res.missingCents,
    surplusCents: res.surplusCents,
    nextStatus: res.nextStatus,
    transactionId: res.tx.transactionId,
  };
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
  volumeDiscounts?: VolumeDiscountTier[];
}) {
  const adminUser = await requireAdminUser();

  const trimmedLabel = input.denominationLabel?.trim();
  if (input.denominationLabel !== undefined && !trimmedLabel) {
    throw new Error("La etiqueta de denominación no puede estar vacía.");
  }

  let validatedVolumeDiscounts: VolumeDiscountTier[] | undefined;
  if (input.volumeDiscounts !== undefined) {
    const check = validateVolumeDiscountTiersForAdmin({
      tiers: input.volumeDiscounts,
      baseUnitPriceCents: input.salePriceCents,
      unitCostCents: input.unitCostCents,
    });
    if (!check.ok) {
      throw new Error(check.error);
    }
    validatedVolumeDiscounts = check.tiers;
  }

  let resolvedSourcePriority = input.sourcePriority;
  let targetMetaPatch: Partial<VariantPricingMeta> = {};

  if (input.centraloneProductId && !isFazerCardsProductId(input.centraloneProductId)) {
    const liveQuote = await fetchLiveQuoteForSku(input.centraloneProductId).catch(
      () => null
    );
    if (liveQuote?.requiresTarget) {
      if (
        isLoginModeTarget(
          liveQuote.targetFields,
          liveQuote.targetSchema,
          liveQuote.name
        )
      ) {
        throw new Error(
          "Este SKU de Central One es modo Login (correo/contraseña). Solo están habilitadas las recargas directas por ID/UID."
        );
      }
      resolvedSourcePriority = "centralone_only";
      targetMetaPatch = {
        requiresTarget: true,
        targetFields: liveQuote.targetFields ?? [],
        targetSchema: liveQuote.targetSchema ?? [],
        supportsPlayerValidate: Boolean(liveQuote.supportsPlayerValidate),
      };
    } else if (liveQuote) {
      targetMetaPatch = {
        requiresTarget: false,
        targetFields: [],
        targetSchema: [],
        supportsPlayerValidate: false,
      };
    }
  } else {
    targetMetaPatch = {
      requiresTarget: false,
      targetFields: [],
      targetSchema: [],
      supportsPlayerValidate: false,
    };
  }

  await updateVariantAdmin(input.variantId, {
    denominationLabel: trimmedLabel,
    salePriceCents: input.salePriceCents,
    unitCostCents: input.unitCostCents,
    sourcePriority: resolvedSourcePriority,
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
    ...targetMetaPatch,
    ...(validatedVolumeDiscounts !== undefined
      ? { volumeDiscounts: validatedVolumeDiscounts }
      : {}),
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
  let resolvedSourcePriority = parsed.sourcePriority;
  let targetMetaPatch: Partial<VariantPricingMeta> = {};
  if (parsed.centraloneProductId && !isFazerCardsProductId(parsed.centraloneProductId)) {
    const liveQuote = await fetchLiveQuoteForSku(parsed.centraloneProductId).catch(
      () => null
    );
    if (liveQuote?.requiresTarget) {
      if (
        isLoginModeTarget(
          liveQuote.targetFields,
          liveQuote.targetSchema,
          liveQuote.name
        )
      ) {
        throw new Error(
          "Este SKU de Central One es modo Login (correo/contraseña). Solo están habilitadas las recargas directas por ID/UID."
        );
      }
      resolvedSourcePriority = "centralone_only";
      targetMetaPatch = {
        requiresTarget: true,
        targetFields: liveQuote.targetFields ?? [],
        targetSchema: liveQuote.targetSchema ?? [],
        supportsPlayerValidate: Boolean(liveQuote.supportsPlayerValidate),
      };
    }
  }

  const created = await createProductWithVariantAdmin({
    ...parsed,
    sourcePriority: resolvedSourcePriority,
    centraloneProductId: parsed.centraloneProductId || null,
    reloadlyProductId: parsed.reloadlyProductId ?? null,
    active: true,
  });

  if (
    parsed.exactCostUsd ||
    parsed.centraloneProductName ||
    parsed.centraloneSku ||
    targetMetaPatch.requiresTarget
  ) {
    await saveVariantPricingMeta(
      created.variantId,
      {
        exactCostUsd: parsed.exactCostUsd ?? null,
        centraloneProductName: parsed.centraloneProductName ?? null,
        centraloneSku: parsed.centraloneSku ?? null,
        centraloneRegion: parsed.centraloneRegion ?? null,
        ...targetMetaPatch,
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
  let resolvedSourcePriority = parsed.sourcePriority;
  let targetMetaPatch: Partial<VariantPricingMeta> = {};
  if (parsed.centraloneProductId && !isFazerCardsProductId(parsed.centraloneProductId)) {
    const liveQuote = await fetchLiveQuoteForSku(parsed.centraloneProductId).catch(
      () => null
    );
    if (liveQuote?.requiresTarget) {
      if (
        isLoginModeTarget(
          liveQuote.targetFields,
          liveQuote.targetSchema,
          liveQuote.name
        )
      ) {
        throw new Error(
          "Este SKU de Central One es modo Login (correo/contraseña). Solo están habilitadas las recargas directas por ID/UID."
        );
      }
      resolvedSourcePriority = "centralone_only";
      targetMetaPatch = {
        requiresTarget: true,
        targetFields: liveQuote.targetFields ?? [],
        targetSchema: liveQuote.targetSchema ?? [],
        supportsPlayerValidate: Boolean(liveQuote.supportsPlayerValidate),
      };
    }
  }

  const variantId = await createVariantAdmin({
    ...parsed,
    sourcePriority: resolvedSourcePriority,
    centraloneProductId: parsed.centraloneProductId || null,
    active: true,
  });

  if (
    parsed.exactCostUsd ||
    parsed.centraloneProductName ||
    parsed.centraloneSku ||
    targetMetaPatch.requiresTarget
  ) {
    await saveVariantPricingMeta(
      variantId,
      {
        exactCostUsd: parsed.exactCostUsd ?? null,
        centraloneProductName: parsed.centraloneProductName ?? null,
        centraloneSku: parsed.centraloneSku ?? null,
        centraloneRegion: parsed.centraloneRegion ?? null,
        ...targetMetaPatch,
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
// PAGO MOVIL BDV API CONCILIACION ADMIN ACTIONS
// ============================================================================

export async function saveReceiverBankAccountAction(input: {
  id?: string;
  bankCode: string;
  accountType: "natural" | "juridical";
  phone: string;
  dni: string;
  holderName: string;
  active: boolean;
}) {
  const adminUser = await requireAdminUser();
  const bankInfo = BANK_BY_CODE.get(input.bankCode.trim());
  const normalizedPhone = normalizeVePhone(input.phone);
  if (!normalizedPhone || normalizedPhone.length < 10) {
    throw new Error(
      "Ingresa un teléfono Pago Móvil venezolano válido (ej. 04121234567)."
    );
  }
  const cleanDni = input.dni.trim().toUpperCase();
  if (cleanDni.length < 5) {
    throw new Error("Ingresa la cédula o RIF (ej. J-500123456).");
  }
  const cleanHolder = input.holderName.trim();
  if (cleanHolder.length < 3) {
    throw new Error("Ingresa el nombre del titular de la cuenta.");
  }

  const saved = await saveReceiverBankAccount(
    {
      id: input.id,
      bankCode: input.bankCode.trim(),
      bankName: bankInfo?.name ?? "Banco de Venezuela",
      accountType: input.accountType,
      phone: normalizedPhone,
      dni: cleanDni,
      holderName: cleanHolder,
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
  revalidatePath("/admin/treasury");
  revalidatePath("/checkout");
  return saved;
}

export async function savePagoMovilSettingsAction(
  input: Partial<PagoMovilSettingsDTO>
) {
  const adminUser = await requireAdminUser();
  const saved = await savePagoMovilSettings(input, adminUser.id);
  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "pagomovil.save_settings",
    targetType: "store_settings",
    targetId: "pagomovil_bot_settings",
    metadata: { ...saved },
  });
  revalidatePath("/admin/pagomovil");
  revalidatePath("/admin/banks");
  revalidatePath("/admin/treasury");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/checkout");
  return saved;
}

export async function testBdvConciliacionAction(input: {
  cedulaPagador: string;
  telefonoPagador: string;
  telefonoDestino?: string;
  referencia: string;
  fechaPago?: string;
  importeBs: string;
  bancoOrigen: string;
}) {
  await requireAdminUser();
  const amountBsCents = parseUserBsInputToCents(input.importeBs);
  if (!amountBsCents || amountBsCents <= 0) {
    throw new Error("Ingresa un monto en Bs válido (ej. 120.00).");
  }
  return adminTestBdvConciliacion({
    cedulaPagador: input.cedulaPagador,
    telefonoPagador: input.telefonoPagador,
    telefonoDestino: input.telefonoDestino,
    referencia: input.referencia,
    fechaPago: input.fechaPago,
    importeBsCents: amountBsCents,
    bancoOrigen: input.bancoOrigen,
  });
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

export async function fetchLiveVenezuelaRatesAction(): Promise<LiveVenezuelaRatesSnapshot> {
  await requireAdminUser();
  return fetchLiveVenezuelaRates({ force: true });
}

const bsRateAutoSyncPolicySchema = z.object({
  mode: z.enum(["manual", "auto"]),
  benchmark: z.enum([
    "binance_p2p",
    "euro_bcv",
    "paralelo",
    "official_bcv",
    "highest",
  ]),
  spreadPct: z.number().min(-10).max(35),
  onlyIncrease: z.boolean(),
  autoSyncIntervalMinutes: z.number().int().min(5).max(720),
});

export async function saveBsRateAutoSyncPolicyAction(input: {
  mode: BsRateAutoSyncPolicy["mode"];
  benchmark: BsRateAutoSyncPolicy["benchmark"];
  spreadPct: number;
  onlyIncrease: boolean;
  autoSyncIntervalMinutes: number;
  syncNow?: boolean;
}): Promise<{
  policy: BsRateAutoSyncPolicy;
  bsRateCents: number | null;
  rates: LiveVenezuelaRatesSnapshot | null;
}> {
  const adminUser = await requireAdminUser();
  const parsed = bsRateAutoSyncPolicySchema.parse(input);
  const savedPolicy = await saveBsRateAutoSyncPolicy(parsed, adminUser.id);

  let syncedRateCents: number | null = null;
  let liveRates: LiveVenezuelaRatesSnapshot | null = null;

  if (parsed.mode === "auto" || input.syncNow) {
    const syncResult = await syncBsExchangeRateIfNeeded({
      force: true,
      updatedBy: adminUser.id,
    });
    syncedRateCents = syncResult.bsRateCents;
    liveRates = syncResult.rates;
  }

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "pagomovil.save_bs_rate_policy",
    targetType: "store_settings",
    targetId: "bs_rate_auto_sync_policy",
    metadata: {
      ...savedPolicy,
      syncedRateCents,
    },
  });

  revalidatePath("/", "layout");
  revalidatePath("/admin");
  revalidatePath("/admin/pagomovil");
  revalidatePath("/admin/treasury");
  revalidatePath("/admin/products");
  revalidatePath("/checkout");

  return {
    policy: savedPolicy,
    bsRateCents: syncedRateCents,
    rates: liveRates,
  };
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
  networkFeeUsdCents: z.number().int().min(0).max(50_000_000).optional(),
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
  networkFeeUsdCents?: number;
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

  const feePlan = buildTreasuryMovementWithFeePlan({
    movementType: parsed.movementType,
    sourceAccount: parsed.sourceAccount,
    targetAccount: parsed.targetAccount,
    amountUsdCents: parsed.amountUsdCents,
    networkFeeUsdCents: parsed.networkFeeUsdCents,
  });

  const created = await createTreasuryMovementAdmin({
    movementType: parsed.movementType,
    sourceAccount: parsed.sourceAccount,
    targetAccount: parsed.targetAccount,
    amountUsdCents: feePlan.primaryAmountUsdCents,
    amountBsCents: parsed.amountBsCents ?? null,
    exchangeRateCents: parsed.exchangeRateCents ?? null,
    partnerName: parsed.partnerName || null,
    reference: parsed.reference || null,
    notes: parsed.notes ?? "",
    occurredAt: parsed.occurredAt,
    relatedOrderId: parsed.relatedOrderId ?? null,
    createdBy: adminUser.id,
  });

  let createdFeeId: string | null = null;
  if (feePlan.feeEntry) {
    const feeRow = await createTreasuryMovementAdmin({
      movementType: feePlan.feeEntry.movementType,
      sourceAccount: feePlan.feeEntry.sourceAccount,
      targetAccount: feePlan.feeEntry.targetAccount,
      amountUsdCents: feePlan.feeEntry.amountUsdCents,
      amountBsCents: null,
      exchangeRateCents: null,
      partnerName: parsed.partnerName || null,
      reference: parsed.reference || null,
      notes: `Comisión de red (${parsed.sourceAccount} → ${parsed.targetAccount})${
        parsed.notes ? ` · ${parsed.notes}` : ""
      }`,
      occurredAt: parsed.occurredAt,
      relatedOrderId: parsed.relatedOrderId ?? null,
      createdBy: adminUser.id,
    });
    createdFeeId = feeRow.id;
  }

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
      networkFeeUsdCents: feePlan.feeEntry?.amountUsdCents ?? 0,
      feeMovementId: createdFeeId,
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
