"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  BANK_BY_CODE,
  DEFAULT_ANDROID_PACKAGES_BY_BANK,
  normalizeVePhone,
} from "@/lib/catalog-banks";
import { requireAdminUser } from "@/lib/server/auth";
import {
  adminRefundOrderToCredit,
  fulfillOrder,
} from "@/lib/server/fulfillment";
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
  createVariantAdmin,
  deleteProductAdmin,
  deleteVariantAdmin,
  insertInventoryBatch,
  listCatalog,
  markOrderAttentionFlag,
  previewCsvInventoryBatch,
  releaseExpiredReservations,
  saveMonthlyCapitalSnapshot,
  saveVariantPricingMeta,
  setBsRateCents,
  toggleProductActiveAdmin,
  toggleVariantActiveAdmin,
  updateProductAdmin,
  updateProviderConfig,
  updateVariantAdmin,
  voidInventoryCode,
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
import type {
  BotDeviceDTO,
  PagoMovilBotSettingsDTO,
  ProviderConfigDTO,
  SourcePriority,
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
  const updated = await fulfillOrder(orderId);

  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "order.admin_retry_fulfill",
    targetType: "order",
    targetId: orderId,
    metadata: { resultingStatus: updated.status },
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
  await appendAuditLog({
    actorId: adminUser.id,
    actorRole: adminUser.role,
    action: "system.manual_reconcile",
    targetType: "system",
    targetId: "reconcile",
    metadata: res,
  });
  revalidatePath("/admin");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/orders");
  return res;
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

const updateProductMetaSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  region: z.enum(["USA", "Global", "Latam", "Europa"]),
  category: z.enum(["gaming", "streaming", "shopping", "crypto"]),
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
  imageUrl: z.string().trim().max(240).optional(),
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
