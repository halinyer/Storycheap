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
  insertInventoryBatch,
  markOrderAttentionFlag,
  previewCsvInventoryBatch,
  releaseExpiredReservations,
  updateProviderConfig,
  updateVariantAdmin,
  voidInventoryCode,
  type CsvPreviewRow,
} from "@/lib/server/repository";
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
  salePriceCents: number;
  sourcePriority: SourcePriority;
  reloadlyProductId: number | null;
  lowStockThreshold: number;
  active: boolean;
}) {
  const adminUser = await requireAdminUser();

  await updateVariantAdmin(input.variantId, {
    salePriceCents: input.salePriceCents,
    sourcePriority: input.sourcePriority,
    reloadlyProductId: input.reloadlyProductId,
    lowStockThreshold: input.lowStockThreshold,
    active: input.active,
  });

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
