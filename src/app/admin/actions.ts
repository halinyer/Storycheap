"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminUser } from "@/lib/server/auth";
import {
  adminRefundOrderToCredit,
  fulfillOrder,
} from "@/lib/server/fulfillment";
import {
  appendAuditLog,
  appendCreditLedgerEntry,
  createProductWithVariantAdmin,
  createVariantAdmin,
  insertInventoryBatch,
  listCatalog,
  markOrderAttentionFlag,
  previewCsvInventoryBatch,
  releaseExpiredReservations,
  saveMonthlyCapitalSnapshot,
  saveVariantPricingMeta,
  setBsRateCents,
  toggleProductActiveAdmin,
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
import { getReloadlyBalance } from "@/lib/server/suppliers/reloadly";
import type { ProviderConfigDTO, SourcePriority } from "@/types";

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

  revalidatePath("/");
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

  revalidatePath("/");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
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

  revalidatePath("/");
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

  const [centralOne, reloadly, catalog] = await Promise.all([
    getCentralOneBalance(),
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
    manual: manualCostCents,
    reloadly: reloadly.balanceCents ?? 0,
  };
  const totalCents =
    byProvider.centralone + byProvider.manual + byProvider.reloadly;

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
