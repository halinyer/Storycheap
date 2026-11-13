import "server-only";
import crypto from "crypto";
import type {
  AuditLogEntryDTO,
  CreditLedgerEntryDTO,
  CreditReason,
  CustomerSummaryDTO,
  FulfillmentSummaryDTO,
  InventoryItemAdminDTO,
  InventoryStatus,
  OrderDTO,
  OrderItemStatus,
  OrderStatus,
  PaymentGatewayId,
  ProductDTO,
  ProductVariantDTO,
  ProviderConfigDTO,
  RevealedCodeDTO,
  SourcePriority,
  WebhookEventDTO,
} from "@/types";
import { decryptCode, encryptCode, extractLast4, sha256CodeHash } from "./crypto";
import { CATALOG_SEED } from "@/lib/catalog-seed";
import { isDemoSandboxEnabled, isStorePreviewMode } from "./env";
import {
  buildSandboxCatalogSnapshot,
  computeSandboxCustomerSummaries,
  getSandboxState,
  hydrateSandboxOrder,
  type SandboxInventoryRow,
} from "./sandbox-db";
import { canTransitionOrder } from "./state-machine";
import { getSupabaseAdmin } from "./supabase-admin";

function assertDbOrSandbox() {
  const admin = getSupabaseAdmin();
  if (admin) return { mode: "supabase" as const, admin };
  if (isDemoSandboxEnabled()) {
    return { mode: "sandbox" as const, admin: null };
  }
  throw new Error(
    "Supabase service credentials are missing and Demo Sandbox mode is disabled."
  );
}

export function generateOrderNumber(): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `SC-${ym}-${rand}`;
}

// ============================================================================
// CATALOG & VARIANTS
// ============================================================================

export async function listCatalog(includeInactive = false): Promise<ProductDTO[]> {
  if (isStorePreviewMode()) {
    // Read-only preview: browsable catalog, nothing purchasable until the DB is connected.
    return CATALOG_SEED.filter((p) => includeInactive || p.active).map((p) => ({
      ...p,
      redemptionSteps: [...p.redemptionSteps],
      variants: p.variants
        .filter((v) => includeInactive || v.active)
        .map((v) => ({ ...v, availableStock: 0, inStock: false })),
    }));
  }
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    return buildSandboxCatalogSnapshot(includeInactive);
  }

  let prodQuery = ctx.admin
    .from("products")
    .select("*")
    .order("is_popular", { ascending: false })
    .order("name", { ascending: true });
  if (!includeInactive) {
    prodQuery = prodQuery.eq("active", true);
  }
  const { data: products, error: prodErr } = await prodQuery;
  if (prodErr) throw prodErr;

  let varQuery = ctx.admin
    .from("product_variants")
    .select("*")
    .order("face_value_cents", { ascending: true });
  if (!includeInactive) {
    varQuery = varQuery.eq("active", true);
  }
  const { data: variants, error: varErr } = await varQuery;
  if (varErr) throw varErr;

  const { data: stockRows, error: stockErr } = await ctx.admin
    .from("variant_available_stock")
    .select("*");
  if (stockErr) throw stockErr;

  const { data: providerRows } = await ctx.admin
    .from("provider_configs")
    .select("id, enabled");

  const providerMap = new Map<string, boolean>();
  for (const row of providerRows ?? []) {
    providerMap.set(row.id, Boolean(row.enabled));
  }
  const manualEnabled = providerMap.get("manual_inventory") ?? true;
  const reloadlyEnabled = providerMap.get("reloadly") ?? false;

  const stockMap = new Map<string, number>();
  for (const row of stockRows ?? []) {
    stockMap.set(row.variant_id, Number(row.manual_available_count ?? 0));
  }

  const variantsByProduct = new Map<string, ProductVariantDTO[]>();
  for (const v of variants ?? []) {
    const manualCount = manualEnabled ? stockMap.get(v.id) ?? 0 : 0;
    const reloadlyAvail =
      reloadlyEnabled &&
      v.source_priority !== "manual_only" &&
      Boolean(v.reloadly_product_id);

    const dto: ProductVariantDTO = {
      id: v.id,
      productId: v.product_id,
      denominationLabel: v.denomination_label,
      faceValueCents: v.face_value_cents,
      salePriceCents: v.sale_price_cents,
      unitCostCents: v.unit_cost_cents ?? null,
      currency: v.currency,
      sourcePriority: v.source_priority as SourcePriority,
      reloadlyProductId: v.reloadly_product_id ?? null,
      lowStockThreshold: v.low_stock_threshold,
      active: Boolean(v.active),
      availableStock: manualCount,
      inStock: manualCount > 0 || reloadlyAvail,
    };
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push(dto);
    variantsByProduct.set(v.product_id, arr);
  }

  return (products ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    category: p.category,
    region: p.region,
    regionWarning: p.region_warning ?? null,
    description: p.description,
    redemptionSteps: Array.isArray(p.redemption_steps) ? p.redemption_steps : [],
    terms: p.terms ?? "",
    imageUrl: p.image_url,
    accentColor: p.accent_color,
    gradient: p.gradient,
    active: Boolean(p.active),
    isPopular: Boolean(p.is_popular),
    variants: variantsByProduct.get(p.id) ?? [],
  }));
}

export async function getProductBySlug(slug: string): Promise<ProductDTO | null> {
  const catalog = await listCatalog(false);
  return catalog.find((p) => p.slug === slug) ?? null;
}

export async function getVariantsLookupByIds(
  variantIds: string[]
): Promise<Map<string, { product: ProductDTO; variant: ProductVariantDTO }>> {
  const catalog = await listCatalog(true);
  const idSet = new Set(variantIds);
  const map = new Map<string, { product: ProductDTO; variant: ProductVariantDTO }>();
  for (const product of catalog) {
    for (const variant of product.variants) {
      if (idSet.has(variant.id)) {
        map.set(variant.id, { product, variant });
      }
    }
  }
  return map;
}

export async function updateVariantAdmin(
  variantId: string,
  patch: Partial<{
    salePriceCents: number;
    unitCostCents: number | null;
    faceValueCents: number;
    sourcePriority: SourcePriority;
    reloadlyProductId: number | null;
    lowStockThreshold: number;
    active: boolean;
  }>
) {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const state = getSandboxState();
    for (const prod of state.products) {
      const target = prod.variants.find((v) => v.id === variantId);
      if (target) {
        if (patch.salePriceCents !== undefined) target.salePriceCents = patch.salePriceCents;
        if (patch.unitCostCents !== undefined) target.unitCostCents = patch.unitCostCents;
        if (patch.faceValueCents !== undefined) target.faceValueCents = patch.faceValueCents;
        if (patch.sourcePriority !== undefined) target.sourcePriority = patch.sourcePriority;
        if (patch.reloadlyProductId !== undefined) target.reloadlyProductId = patch.reloadlyProductId;
        if (patch.lowStockThreshold !== undefined) target.lowStockThreshold = patch.lowStockThreshold;
        if (patch.active !== undefined) target.active = patch.active;
        return;
      }
    }
    throw new Error(`Variant not found: ${variantId}`);
  }

  const dbPatch: Record<string, unknown> = {};
  if (patch.salePriceCents !== undefined) dbPatch.sale_price_cents = patch.salePriceCents;
  if (patch.unitCostCents !== undefined) dbPatch.unit_cost_cents = patch.unitCostCents;
  if (patch.faceValueCents !== undefined) dbPatch.face_value_cents = patch.faceValueCents;
  if (patch.sourcePriority !== undefined) dbPatch.source_priority = patch.sourcePriority;
  if (patch.reloadlyProductId !== undefined) dbPatch.reloadly_product_id = patch.reloadlyProductId;
  if (patch.lowStockThreshold !== undefined) dbPatch.low_stock_threshold = patch.lowStockThreshold;
  if (patch.active !== undefined) dbPatch.active = patch.active;

  const { error } = await ctx.admin
    .from("product_variants")
    .update(dbPatch)
    .eq("id", variantId);
  if (error) throw error;
}

// ============================================================================
// PROVIDER CONFIGS (KILL SWITCHES)
// ============================================================================

export async function listProviderConfigs(): Promise<ProviderConfigDTO[]> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    return getSandboxState().providerConfigs.map((c) => ({ ...c }));
  }
  const { data, error } = await ctx.admin
    .from("provider_configs")
    .select("*")
    .order("id");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    label: (r.config?.label as string) || r.id,
    enabled: Boolean(r.enabled),
    sandboxMode: Boolean(r.sandbox_mode),
    minBalanceAlertCents: Number(r.min_balance_alert_cents ?? 0),
    updatedAt: r.updated_at,
  }));
}

export async function getProviderConfig(
  id: ProviderConfigDTO["id"]
): Promise<ProviderConfigDTO | null> {
  const all = await listProviderConfigs();
  return all.find((c) => c.id === id) ?? null;
}

export async function updateProviderConfig(
  id: ProviderConfigDTO["id"],
  patch: Partial<{ enabled: boolean; sandboxMode: boolean; minBalanceAlertCents: number }>,
  actorId: string | null
) {
  const ctx = assertDbOrSandbox();
  const now = new Date().toISOString();
  if (ctx.mode === "sandbox") {
    const state = getSandboxState();
    const row = state.providerConfigs.find((c) => c.id === id);
    if (!row) throw new Error(`Provider config not found: ${id}`);
    if (patch.enabled !== undefined) row.enabled = patch.enabled;
    if (patch.sandboxMode !== undefined) row.sandboxMode = patch.sandboxMode;
    if (patch.minBalanceAlertCents !== undefined)
      row.minBalanceAlertCents = patch.minBalanceAlertCents;
    row.updatedAt = now;
    return;
  }

  const dbPatch: Record<string, unknown> = {
    updated_at: now,
    updated_by: actorId,
  };
  if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
  if (patch.sandboxMode !== undefined) dbPatch.sandbox_mode = patch.sandboxMode;
  if (patch.minBalanceAlertCents !== undefined)
    dbPatch.min_balance_alert_cents = patch.minBalanceAlertCents;

  const { error } = await ctx.admin
    .from("provider_configs")
    .update(dbPatch)
    .eq("id", id);
  if (error) throw error;
}

// ============================================================================
// MANUAL CODE INVENTORY (ENCRYPTED AT REST, DUPLICATE HASH CHECKS, ATOMIC RESERVE)
// ============================================================================

export interface CsvPreviewRow {
  rowNumber: number;
  codeLast4: string;
  codeHash: string;
  codeNormalized: string;
  pinNormalized: string | null;
  expiresAt: string | null;
  status: "valid" | "duplicate_db" | "duplicate_batch" | "invalid";
  reason?: string;
}

export async function previewCsvInventoryBatch(
  rawRows: Array<{ code: string; pin?: string | null; expiresAt?: string | null }>
): Promise<CsvPreviewRow[]> {
  const ctx = assertDbOrSandbox();
  const seenBatchHashes = new Set<string>();
  const validHashes: string[] = [];

  for (const r of rawRows) {
    const clean = (r.code ?? "").trim();
    if (clean.length >= 4) {
      validHashes.push(sha256CodeHash(clean));
    }
  }

  const existingDbHashes = new Set<string>();
  if (validHashes.length > 0) {
    if (ctx.mode === "sandbox") {
      const state = getSandboxState();
      for (const inv of state.inventory) {
        if (validHashes.includes(inv.codeHash)) {
          existingDbHashes.add(inv.codeHash);
        }
      }
    } else {
      const { data, error } = await ctx.admin
        .from("code_inventory")
        .select("code_hash")
        .in("code_hash", validHashes);
      if (error) throw error;
      for (const row of data ?? []) {
        existingDbHashes.add(row.code_hash);
      }
    }
  }

  return rawRows.map((row, idx) => {
    const codeNormalized = (row.code ?? "").trim();
    const pinNormalized = row.pin?.trim() || null;
    const expiresAt = row.expiresAt?.trim() || null;

    if (codeNormalized.length < 4) {
      return {
        rowNumber: idx + 1,
        codeLast4: extractLast4(codeNormalized),
        codeHash: "",
        codeNormalized,
        pinNormalized,
        expiresAt,
        status: "invalid" as const,
        reason: "Código vacío o demasiado corto (< 4 caracteres)",
      };
    }

    const codeHash = sha256CodeHash(codeNormalized);
    const codeLast4 = extractLast4(codeNormalized);

    if (seenBatchHashes.has(codeHash)) {
      return {
        rowNumber: idx + 1,
        codeLast4,
        codeHash,
        codeNormalized,
        pinNormalized,
        expiresAt,
        status: "duplicate_batch" as const,
        reason: "Duplicado dentro del mismo lote CSV",
      };
    }
    seenBatchHashes.add(codeHash);

    if (existingDbHashes.has(codeHash)) {
      return {
        rowNumber: idx + 1,
        codeLast4,
        codeHash,
        codeNormalized,
        pinNormalized,
        expiresAt,
        status: "duplicate_db" as const,
        reason: "Este código ya existe en la bóveda de inventario",
      };
    }

    return {
      rowNumber: idx + 1,
      codeLast4,
      codeHash,
      codeNormalized,
      pinNormalized,
      expiresAt,
      status: "valid" as const,
    };
  });
}

export async function insertInventoryBatch(params: {
  variantId: string;
  batchId: string;
  rows: Array<{ code: string; pin?: string | null; expiresAt?: string | null }>;
}): Promise<{ insertedCount: number; skippedDuplicates: number }> {
  const ctx = assertDbOrSandbox();
  const preview = await previewCsvInventoryBatch(params.rows);
  const validRows = preview.filter((r) => r.status === "valid");
  const skippedDuplicates = preview.length - validRows.length;

  if (validRows.length === 0) {
    return { insertedCount: 0, skippedDuplicates };
  }

  const now = new Date().toISOString();

  if (ctx.mode === "sandbox") {
    const state = getSandboxState();
    for (const r of validRows) {
      state.inventory.push({
        id: crypto.randomUUID(),
        variantId: params.variantId,
        codeCiphertext: encryptCode(r.codeNormalized),
        pinCiphertext: r.pinNormalized ? encryptCode(r.pinNormalized) : null,
        codeHash: r.codeHash,
        codeLast4: r.codeLast4,
        batchId: params.batchId,
        expiresAt: r.expiresAt,
        status: "AVAILABLE",
        reservedOrderId: null,
        reservedUntil: null,
        deliveredOrderId: null,
        createdAt: now,
        deliveredAt: null,
      });
    }
    return { insertedCount: validRows.length, skippedDuplicates };
  }

  const dbRows = validRows.map((r) => ({
    variant_id: params.variantId,
    code_ciphertext: encryptCode(r.codeNormalized),
    pin_ciphertext: r.pinNormalized ? encryptCode(r.pinNormalized) : null,
    code_hash: r.codeHash,
    code_last4: r.codeLast4,
    batch_id: params.batchId,
    expires_at: r.expiresAt,
    status: "AVAILABLE",
  }));

  const { error } = await ctx.admin.from("code_inventory").insert(dbRows);
  if (error) throw error;

  return { insertedCount: validRows.length, skippedDuplicates };
}

export async function listInventoryAdmin(filters?: {
  variantId?: string;
  status?: InventoryStatus;
}): Promise<InventoryItemAdminDTO[]> {
  const ctx = assertDbOrSandbox();
  const catalog = await listCatalog(true);
  const variantMeta = new Map<
    string,
    { productName: string; denominationLabel: string }
  >();
  for (const p of catalog) {
    for (const v of p.variants) {
      variantMeta.set(v.id, {
        productName: p.name,
        denominationLabel: v.denominationLabel,
      });
    }
  }

  if (ctx.mode === "sandbox") {
    return getSandboxState()
      .inventory.filter((r) => {
        if (filters?.variantId && r.variantId !== filters.variantId) return false;
        if (filters?.status && r.status !== filters.status) return false;
        return true;
      })
      .slice(-200)
      .reverse()
      .map((r) => {
        const meta = variantMeta.get(r.variantId);
        return {
          id: r.id,
          variantId: r.variantId,
          productName: meta?.productName ?? "Producto",
          denominationLabel: meta?.denominationLabel ?? "",
          codeLast4: r.codeLast4,
          batchId: r.batchId,
          expiresAt: r.expiresAt,
          status: r.status,
          reservedOrderId: r.reservedOrderId,
          deliveredOrderId: r.deliveredOrderId,
          createdAt: r.createdAt,
          deliveredAt: r.deliveredAt,
        };
      });
  }

  let q = ctx.admin
    .from("code_inventory")
    .select(
      "id, variant_id, code_last4, batch_id, expires_at, status, reserved_order_id, delivered_order_id, created_at, delivered_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters?.variantId) q = q.eq("variant_id", filters.variantId);
  if (filters?.status) q = q.eq("status", filters.status);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => {
    const meta = variantMeta.get(r.variant_id);
    return {
      id: r.id,
      variantId: r.variant_id,
      productName: meta?.productName ?? "Producto",
      denominationLabel: meta?.denominationLabel ?? "",
      codeLast4: r.code_last4,
      batchId: r.batch_id ?? null,
      expiresAt: r.expires_at ?? null,
      status: r.status as InventoryStatus,
      reservedOrderId: r.reserved_order_id ?? null,
      deliveredOrderId: r.delivered_order_id ?? null,
      createdAt: r.created_at,
      deliveredAt: r.delivered_at ?? null,
    };
  });
}

export async function voidInventoryCode(inventoryId: string): Promise<boolean> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const item = getSandboxState().inventory.find((i) => i.id === inventoryId);
    if (!item || item.status !== "AVAILABLE") return false;
    item.status = "VOID";
    return true;
  }

  const { data, error } = await ctx.admin
    .from("code_inventory")
    .update({ status: "VOID" })
    .eq("id", inventoryId)
    .eq("status", "AVAILABLE")
    .select("id");
  if (error) throw error;
  return Boolean(data && data.length === 1);
}

export interface ReservedCodePayload {
  id: string;
  variantId: string;
  codeCiphertext: string;
  pinCiphertext: string | null;
  codeLast4: string;
}

export async function reserveManualCodes(params: {
  variantId: string;
  orderId: string;
  qty: number;
  holdMinutes?: number;
}): Promise<ReservedCodePayload[]> {
  const holdMinutes = params.holdMinutes ?? 20;
  const ctx = assertDbOrSandbox();

  if (ctx.mode === "sandbox") {
    // Synchronous block ensures atomic check-then-claim across concurrent Node promises
    const state = getSandboxState();
    const nowMs = Date.now();
    const reservedUntil = new Date(nowMs + holdMinutes * 60_000).toISOString();
    const candidates: SandboxInventoryRow[] = [];

    for (const row of state.inventory) {
      if (
        row.variantId === params.variantId &&
        row.status === "AVAILABLE" &&
        (!row.expiresAt || Date.parse(row.expiresAt) > nowMs)
      ) {
        candidates.push(row);
        if (candidates.length === params.qty) break;
      }
    }

    if (candidates.length < params.qty) {
      throw new Error(
        `INSUFFICIENT_MANUAL_STOCK: requested ${params.qty}, available ${candidates.length}`
      );
    }

    return candidates.map((row) => {
      row.status = "RESERVED";
      row.reservedOrderId = params.orderId;
      row.reservedUntil = reservedUntil;
      return {
        id: row.id,
        variantId: row.variantId,
        codeCiphertext: row.codeCiphertext,
        pinCiphertext: row.pinCiphertext,
        codeLast4: row.codeLast4,
      };
    });
  }

  const { data, error } = await ctx.admin.rpc("reserve_manual_codes", {
    p_variant_id: params.variantId,
    p_order_id: params.orderId,
    p_qty: params.qty,
    p_hold_minutes: holdMinutes,
  });
  if (error) throw error;
  return (data ?? []).map(
    (r: {
      id: string;
      code_ciphertext: string;
      pin_ciphertext: string | null;
      code_last4: string;
    }) => ({
      id: r.id,
      variantId: params.variantId,
      codeCiphertext: r.code_ciphertext,
      pinCiphertext: r.pin_ciphertext ?? null,
      codeLast4: r.code_last4,
    })
  );
}

export async function commitReservedCodesForOrder(
  orderId: string
): Promise<ReservedCodePayload[]> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const now = new Date().toISOString();
    const state = getSandboxState();
    const committed: ReservedCodePayload[] = [];
    for (const row of state.inventory) {
      if (row.reservedOrderId === orderId && row.status === "RESERVED") {
        row.status = "DELIVERED";
        row.deliveredOrderId = orderId;
        row.deliveredAt = now;
        row.reservedUntil = null;
        committed.push({
          id: row.id,
          variantId: row.variantId,
          codeCiphertext: row.codeCiphertext,
          pinCiphertext: row.pinCiphertext,
          codeLast4: row.codeLast4,
        });
      }
    }
    return committed;
  }

  const { data, error } = await ctx.admin.rpc("commit_reserved_codes_for_order", {
    p_order_id: orderId,
  });
  if (error) throw error;
  return (data ?? []).map(
    (r: {
      id: string;
      variant_id: string;
      code_ciphertext: string;
      pin_ciphertext: string | null;
      code_last4: string;
    }) => ({
      id: r.id,
      variantId: r.variant_id,
      codeCiphertext: r.code_ciphertext,
      pinCiphertext: r.pin_ciphertext ?? null,
      codeLast4: r.code_last4,
    })
  );
}

export async function releaseReservedCodesForOrder(orderId: string): Promise<number> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    let released = 0;
    for (const row of getSandboxState().inventory) {
      if (row.reservedOrderId === orderId && row.status === "RESERVED") {
        row.status = "AVAILABLE";
        row.reservedOrderId = null;
        row.reservedUntil = null;
        released += 1;
      }
    }
    return released;
  }

  const { data, error } = await ctx.admin
    .from("code_inventory")
    .update({
      status: "AVAILABLE",
      reserved_order_id: null,
      reserved_until: null,
    })
    .eq("reserved_order_id", orderId)
    .eq("status", "RESERVED")
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function releaseExpiredReservations(): Promise<{
  releasedCodes: number;
  expiredOrders: number;
}> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const state = getSandboxState();
    const nowMs = Date.now();
    let releasedCodes = 0;
    let expiredOrders = 0;
    for (const row of state.inventory) {
      if (
        row.status === "RESERVED" &&
        row.reservedUntil &&
        Date.parse(row.reservedUntil) < nowMs
      ) {
        row.status = "AVAILABLE";
        row.reservedOrderId = null;
        row.reservedUntil = null;
        releasedCodes += 1;
      }
    }
    for (const order of state.orders) {
      if (
        order.status === "PENDING_PAYMENT" &&
        order.expiresAt &&
        Date.parse(order.expiresAt) < nowMs
      ) {
        order.status = "EXPIRED";
        order.updatedAt = new Date().toISOString();
        expiredOrders += 1;
      }
    }
    return { releasedCodes, expiredOrders };
  }

  const { data, error } = await ctx.admin.rpc("release_expired_reservations");
  if (error) throw error;
  const first = Array.isArray(data) ? data[0] : data;
  return {
    releasedCodes: Number(first?.released_codes ?? 0),
    expiredOrders: Number(first?.expired_orders ?? 0),
  };
}

// ============================================================================
// ORDERS, ITEMS, FULFILLMENTS & CODE REVEAL
// ============================================================================

export async function ensureCustomerProfile(
  email: string,
  preferredUserId?: string
): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const state = getSandboxState();
    const byId = preferredUserId
      ? state.profiles.find((p) => p.id === preferredUserId)
      : undefined;
    if (byId) return byId.id;
    const byEmail = state.profiles.find(
      (p) => p.email.toLowerCase() === normalizedEmail
    );
    if (byEmail) return byEmail.id;
    const createdId = preferredUserId || crypto.randomUUID();
    state.profiles.push({
      id: createdId,
      email: normalizedEmail,
      role: "customer",
      createdAt: new Date().toISOString(),
    });
    return createdId;
  }

  if (preferredUserId) {
    await ctx.admin.from("profiles").upsert(
      { id: preferredUserId, email: normalizedEmail },
      { onConflict: "id" }
    );
    return preferredUserId;
  }

  const { data: existing } = await ctx.admin
    .from("profiles")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existing?.id) return existing.id;

  // Create passwordless Supabase Auth user if guest checkout provides an email
  const { data: created, error: authErr } =
    await ctx.admin.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: false,
      app_metadata: { role: "customer" },
    });
  if (authErr || !created.user) {
    throw authErr ?? new Error("Unable to create user profile for checkout email.");
  }
  return created.user.id;
}

export interface CreateOrderInput {
  orderId?: string;
  userId: string | null;
  email: string;
  subtotalCents: number;
  creditAppliedCents: number;
  amountDueCents: number;
  bsRateCents?: number | null;
  totalBsCents?: number | null;
  paymentGateway: PaymentGatewayId;
  ipAddress: string | null;
  items: Array<{
    variantId: string;
    productName: string;
    productSlug: string;
    denominationLabel: string;
    region: string;
    unitPriceCents: number;
    unitCostCents?: number | null;
    quantity: number;
  }>;
}

export async function getBsRateCents(): Promise<number | null> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    return getSandboxState().bsRateCents;
  }
  const { data, error } = await ctx.admin
    .from("store_settings")
    .select("value")
    .eq("key", "bs_exchange_rate")
    .maybeSingle();
  if (error) return null;
  const raw = (data?.value as { bsRateCents?: unknown } | null)?.bsRateCents;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
}

export async function setBsRateCents(
  bsRateCents: number | null,
  updatedBy?: string | null
): Promise<void> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    getSandboxState().bsRateCents = bsRateCents;
    return;
  }
  const { error } = await ctx.admin
    .from("store_settings")
    .upsert({
      key: "bs_exchange_rate",
      value: { bsRateCents },
      updated_by: updatedBy ?? null,
    });
  if (error) throw error;
}

export async function createOrderWithItems(
  input: CreateOrderInput
): Promise<OrderDTO> {
  const ctx = assertDbOrSandbox();
  const orderId = input.orderId ?? crypto.randomUUID();
  const orderNumber = generateOrderNumber();
  const now = new Date().toISOString();

  if (ctx.mode === "sandbox") {
    const items = input.items.map((it) => ({
      id: crypto.randomUUID(),
      orderId,
      variantId: it.variantId,
      productName: it.productName,
      productSlug: it.productSlug,
      denominationLabel: it.denominationLabel,
      region: it.region,
      unitPriceCents: it.unitPriceCents,
      unitCostCents: it.unitCostCents ?? null,
      quantity: it.quantity,
      deliveredCount: 0,
      status: "PENDING" as const,
    }));

    const order: OrderDTO = {
      id: orderId,
      orderNumber,
      userId: input.userId,
      email: input.email.toLowerCase(),
      status: "CREATED",
      subtotalCents: input.subtotalCents,
      creditAppliedCents: input.creditAppliedCents,
      amountDueCents: input.amountDueCents,
      paidCents: 0,
      bsRateCents: input.bsRateCents ?? null,
      totalBsCents: input.totalBsCents ?? null,
      paymentGateway: input.paymentGateway,
      gatewayCheckoutId: null,
      gatewayCheckoutUrl: null,
      expiresAt: null,
      needsAttention: false,
      attentionReason: null,
      createdAt: now,
      updatedAt: now,
      items,
      fulfillments: [],
    };
    getSandboxState().orders.unshift(order);
    return hydrateSandboxOrder(order);
  }

  const { data: orderRow, error: orderErr } = await ctx.admin
    .from("orders")
    .insert({
      id: orderId,
      order_number: orderNumber,
      user_id: input.userId,
      email: input.email.toLowerCase(),
      status: "CREATED",
      subtotal_cents: input.subtotalCents,
      credit_applied_cents: input.creditAppliedCents,
      amount_due_cents: input.amountDueCents,
      paid_cents: 0,
      bs_rate_cents: input.bsRateCents ?? null,
      total_bs_cents: input.totalBsCents ?? null,
      payment_gateway: input.paymentGateway,
      ip_address: input.ipAddress,
    })
    .select("*")
    .single();
  if (orderErr || !orderRow) throw orderErr;

  const { error: itemsErr } = await ctx.admin.from("order_items").insert(
    input.items.map((it) => ({
      order_id: orderId,
      variant_id: it.variantId,
      product_name: it.productName,
      product_slug: it.productSlug,
      denomination_label: it.denominationLabel,
      region: it.region,
      unit_price_cents: it.unitPriceCents,
      unit_cost_cents: it.unitCostCents ?? null,
      quantity: it.quantity,
      status: "PENDING",
    }))
  );
  if (itemsErr) throw itemsErr;

  const loaded = await getOrderById(orderId);
  if (!loaded) throw new Error("Failed to read created order.");
  return loaded;
}

export async function setOrderGatewaySession(
  orderId: string,
  params: {
    checkoutId: string;
    checkoutUrl: string;
    expiresAt: string | null;
    nextStatus: OrderStatus;
  }
) {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const order = getSandboxState().orders.find((o) => o.id === orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);
    order.gatewayCheckoutId = params.checkoutId;
    order.gatewayCheckoutUrl = params.checkoutUrl;
    order.expiresAt = params.expiresAt;
    order.status = params.nextStatus;
    order.updatedAt = new Date().toISOString();
    return;
  }

  const { error } = await ctx.admin
    .from("orders")
    .update({
      gateway_checkout_id: params.checkoutId,
      gateway_checkout_url: params.checkoutUrl,
      expires_at: params.expiresAt,
      status: params.nextStatus,
    })
    .eq("id", orderId);
  if (error) throw error;
}

export async function getOrderById(orderId: string): Promise<OrderDTO | null> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const order = getSandboxState().orders.find((o) => o.id === orderId);
    return order ? hydrateSandboxOrder(order) : null;
  }

  const { data: o, error } = await ctx.admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!o) return null;

  const { data: items } = await ctx.admin
    .from("order_items")
    .select("*")
    .eq("order_id", o.id)
    .order("created_at", { ascending: true });

  const { data: fulfillments } = await ctx.admin
    .from("fulfillments")
    .select(
      "id, order_item_id, order_id, source, code_last4, revealed_at, created_at"
    )
    .eq("order_id", o.id)
    .order("created_at", { ascending: true });

  const itemMap = new Map<string, { productName: string; denominationLabel: string; region: string }>();
  for (const it of items ?? []) {
    itemMap.set(it.id, {
      productName: it.product_name,
      denominationLabel: it.denomination_label,
      region: it.region,
    });
  }

  return {
    id: o.id,
    orderNumber: o.order_number,
    userId: o.user_id,
    email: o.email,
    status: o.status,
    subtotalCents: o.subtotal_cents,
    creditAppliedCents: o.credit_applied_cents,
    amountDueCents: o.amount_due_cents,
    paidCents: o.paid_cents,
    bsRateCents: o.bs_rate_cents ?? null,
    totalBsCents: o.total_bs_cents ?? null,
    paymentGateway: o.payment_gateway,
    gatewayCheckoutId: o.gateway_checkout_id,
    gatewayCheckoutUrl: o.gateway_checkout_url,
    expiresAt: o.expires_at,
    needsAttention: Boolean(o.needs_attention),
    attentionReason: o.attention_reason ?? null,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    items: (items ?? []).map((it) => ({
      id: it.id,
      orderId: it.order_id,
      variantId: it.variant_id,
      productName: it.product_name,
      productSlug: it.product_slug,
      denominationLabel: it.denomination_label,
      region: it.region,
      unitPriceCents: it.unit_price_cents,
      unitCostCents: it.unit_cost_cents ?? null,
      quantity: it.quantity,
      deliveredCount: it.delivered_count,
      status: it.status,
    })),
    fulfillments: (fulfillments ?? []).map((f) => {
      const meta = itemMap.get(f.order_item_id);
      return {
        id: f.id,
        orderItemId: f.order_item_id,
        orderId: f.order_id,
        productName: meta?.productName ?? "Gift Card",
        denominationLabel: meta?.denominationLabel ?? "",
        region: meta?.region ?? "USA",
        source: f.source,
        codeLast4: f.code_last4,
        revealedAt: f.revealed_at,
        createdAt: f.created_at,
      };
    }),
  };
}

export async function getOrderByGatewayCheckoutId(
  checkoutId: string
): Promise<OrderDTO | null> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const order = getSandboxState().orders.find(
      (o) => o.gatewayCheckoutId === checkoutId
    );
    return order ? hydrateSandboxOrder(order) : null;
  }

  const { data, error } = await ctx.admin
    .from("orders")
    .select("id")
    .eq("gateway_checkout_id", checkoutId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return getOrderById(data.id);
}

export async function listOrdersForUser(
  userId: string,
  email?: string
): Promise<OrderDTO[]> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const normEmail = email?.toLowerCase();
    return getSandboxState()
      .orders.filter(
        (o) =>
          o.userId === userId ||
          (normEmail ? o.email.toLowerCase() === normEmail : false)
      )
      .map(hydrateSandboxOrder);
  }

  const { data: rows, error } = await ctx.admin
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const results = await Promise.all((rows ?? []).map((r) => getOrderById(r.id)));
  return results.filter((o): o is OrderDTO => Boolean(o));
}

export async function listOrdersAdmin(filter?: {
  needsAttentionOnly?: boolean;
  status?: OrderStatus;
}): Promise<OrderDTO[]> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    return getSandboxState()
      .orders.filter((o) => {
        if (filter?.needsAttentionOnly && !o.needsAttention) return false;
        if (filter?.status && o.status !== filter.status) return false;
        return true;
      })
      .map(hydrateSandboxOrder);
  }

  let q = ctx.admin
    .from("orders")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(150);
  if (filter?.needsAttentionOnly) q = q.eq("needs_attention", true);
  if (filter?.status) q = q.eq("status", filter.status);

  const { data, error } = await q;
  if (error) throw error;
  const results = await Promise.all((data ?? []).map((r) => getOrderById(r.id)));
  return results.filter((o): o is OrderDTO => Boolean(o));
}

export async function transitionOrderStatus(params: {
  orderId: string;
  expectedStatuses: OrderStatus[];
  nextStatus: OrderStatus;
  paidCents?: number;
  needsAttention?: boolean;
  attentionReason?: string | null;
}): Promise<boolean> {
  const invalidTarget = params.expectedStatuses.some(
    (s) => !canTransitionOrder(s, params.nextStatus)
  );
  if (invalidTarget) {
    throw new Error(
      `Invalid order state transition to ${params.nextStatus} from [${params.expectedStatuses.join(", ")}]`
    );
  }

  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const order = getSandboxState().orders.find((o) => o.id === params.orderId);
    if (!order || !params.expectedStatuses.includes(order.status)) {
      return false;
    }
    order.status = params.nextStatus;
    if (params.paidCents !== undefined) order.paidCents = params.paidCents;
    if (params.needsAttention !== undefined)
      order.needsAttention = params.needsAttention;
    if (params.attentionReason !== undefined)
      order.attentionReason = params.attentionReason;
    order.updatedAt = new Date().toISOString();
    return true;
  }

  const { data, error } = await ctx.admin.rpc("transition_order_status", {
    p_order_id: params.orderId,
    p_expected_statuses: params.expectedStatuses,
    p_next_status: params.nextStatus,
    p_paid_cents: params.paidCents ?? null,
    p_needs_attention: params.needsAttention ?? null,
    p_attention_reason: params.attentionReason ?? null,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function markOrderAttentionFlag(
  orderId: string,
  needsAttention: boolean,
  attentionReason: string | null
) {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const order = getSandboxState().orders.find((o) => o.id === orderId);
    if (order) {
      order.needsAttention = needsAttention;
      order.attentionReason = attentionReason;
      order.updatedAt = new Date().toISOString();
    }
    return;
  }
  const { error } = await ctx.admin
    .from("orders")
    .update({ needs_attention: needsAttention, attention_reason: attentionReason })
    .eq("id", orderId);
  if (error) throw error;
}

export async function markOrderItemProgress(
  orderItemId: string,
  patch: { deliveredCount: number; status: OrderItemStatus }
) {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    for (const order of getSandboxState().orders) {
      const item = order.items.find((i) => i.id === orderItemId);
      if (item) {
        item.deliveredCount = patch.deliveredCount;
        item.status = patch.status;
        return;
      }
    }
    return;
  }

  const { error } = await ctx.admin
    .from("order_items")
    .update({
      delivered_count: patch.deliveredCount,
      status: patch.status,
    })
    .eq("id", orderItemId);
  if (error) throw error;
}

export async function insertFulfillmentRecord(params: {
  orderItemId: string;
  orderId: string;
  userId: string | null;
  source: "manual" | "reloadly";
  codeInventoryId: string | null;
  codeCiphertext: string;
  codeLast4: string;
  pinCiphertext?: string | null;
  supplierTxId?: string | null;
  attempts?: number;
}) {
  const ctx = assertDbOrSandbox();
  const now = new Date().toISOString();

  if (ctx.mode === "sandbox") {
    const id = crypto.randomUUID();
    getSandboxState().fulfillments.push({
      id,
      orderItemId: params.orderItemId,
      orderId: params.orderId,
      userId: params.userId,
      source: params.source,
      codeInventoryId: params.codeInventoryId,
      codeCiphertext: params.codeCiphertext,
      codeLast4: params.codeLast4,
      pinCiphertext: params.pinCiphertext ?? null,
      supplierTxId: params.supplierTxId ?? null,
      attempts: params.attempts ?? 1,
      revealedAt: null,
      createdAt: now,
    });
    return id;
  }

  const { data, error } = await ctx.admin
    .from("fulfillments")
    .insert({
      order_item_id: params.orderItemId,
      order_id: params.orderId,
      user_id: params.userId,
      source: params.source,
      code_inventory_id: params.codeInventoryId,
      code_ciphertext: params.codeCiphertext,
      code_last4: params.codeLast4,
      pin_ciphertext: params.pinCiphertext ?? null,
      supplier_tx_id: params.supplierTxId ?? null,
      attempts: params.attempts ?? 1,
    })
    .select("id")
    .single();
  if (error || !data) throw error;
  return data.id as string;
}

export async function listFulfillmentsForUser(
  userId: string
): Promise<FulfillmentSummaryDTO[]> {
  const orders = await listOrdersForUser(userId);
  return orders.flatMap((o) => o.fulfillments);
}

/**
 * Verifies ownership, decrypts fulfillment codes strictly server-side,
 * stamps `revealed_at`, and appends an audit event. Admins cannot reveal user PINs.
 */
export async function revealOrderCodes(params: {
  orderId: string;
  actorUserId: string;
}): Promise<RevealedCodeDTO[]> {
  const order = await getOrderById(params.orderId);
  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }
  if (order.userId !== params.actorUserId) {
    throw new Error("FORBIDDEN_ORDER_OWNER");
  }

  const now = new Date().toISOString();
  const ctx = assertDbOrSandbox();
  const itemMeta = new Map(order.items.map((it) => [it.id, it]));

  if (ctx.mode === "sandbox") {
    const rows = getSandboxState().fulfillments.filter(
      (f) => f.orderId === params.orderId
    );
    const revealed: RevealedCodeDTO[] = rows.map((f) => {
      if (!f.revealedAt) f.revealedAt = now;
      const it = itemMeta.get(f.orderItemId);
      return {
        fulfillmentId: f.id,
        productName: it?.productName ?? "Gift Card",
        denominationLabel: it?.denominationLabel ?? "",
        region: it?.region ?? "USA",
        code: decryptCode(f.codeCiphertext),
        pin: f.pinCiphertext ? decryptCode(f.pinCiphertext) : null,
        revealedAt: f.revealedAt,
      };
    });

    await appendAuditLog({
      actorId: params.actorUserId,
      actorRole: "customer",
      action: "order.reveal_codes",
      targetType: "order",
      targetId: params.orderId,
      metadata: { count: revealed.length },
    });
    return revealed;
  }

  const { data: rows, error } = await ctx.admin
    .from("fulfillments")
    .select("*")
    .eq("order_id", params.orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const unrevealedIds = (rows ?? [])
    .filter((r) => !r.revealed_at)
    .map((r) => r.id);
  if (unrevealedIds.length > 0) {
    await ctx.admin
      .from("fulfillments")
      .update({ revealed_at: now })
      .in("id", unrevealedIds);
  }

  const revealed: RevealedCodeDTO[] = (rows ?? []).map((r) => {
    const it = itemMeta.get(r.order_item_id);
    return {
      fulfillmentId: r.id,
      productName: it?.productName ?? "Gift Card",
      denominationLabel: it?.denominationLabel ?? "",
      region: it?.region ?? "USA",
      code: decryptCode(r.code_ciphertext),
      pin: r.pin_ciphertext ? decryptCode(r.pin_ciphertext) : null,
      revealedAt: r.revealed_at ?? now,
    };
  });

  await appendAuditLog({
    actorId: params.actorUserId,
    actorRole: "customer",
    action: "order.reveal_codes",
    targetType: "order",
    targetId: params.orderId,
    metadata: { count: revealed.length },
  });

  return revealed;
}

// ============================================================================
// CREDIT LEDGER (APPEND-ONLY & NON-NEGATIVE INVARIANT)
// ============================================================================

export async function getUserCreditBalanceCents(userId: string): Promise<number> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    return getSandboxState()
      .creditLedger.filter((e) => e.userId === userId)
      .reduce((acc, e) => acc + e.deltaCents, 0);
  }

  const { data, error } = await ctx.admin
    .from("credit_ledger")
    .select("delta_cents")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).reduce((acc, r) => acc + Number(r.delta_cents ?? 0), 0);
}

export async function listCreditLedgerForUser(
  userId: string
): Promise<CreditLedgerEntryDTO[]> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    return getSandboxState()
      .creditLedger.filter((e) => e.userId === userId)
      .slice()
      .reverse();
  }

  const { data, error } = await ctx.admin
    .from("credit_ledger")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    orderId: r.order_id,
    deltaCents: r.delta_cents,
    reason: r.reason,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

export async function appendCreditLedgerEntry(params: {
  userId: string;
  orderId?: string | null;
  deltaCents: number;
  reason: CreditReason;
  note?: string | null;
  createdBy?: string | null;
}): Promise<CreditLedgerEntryDTO> {
  if (!Number.isInteger(params.deltaCents) || params.deltaCents === 0) {
    throw new Error("Credit ledger delta must be a non-zero integer in cents.");
  }

  const ctx = assertDbOrSandbox();
  const now = new Date().toISOString();

  if (ctx.mode === "sandbox") {
    const state = getSandboxState();
    const current = state.creditLedger
      .filter((e) => e.userId === params.userId)
      .reduce((acc, e) => acc + e.deltaCents, 0);
    if (current + params.deltaCents < 0) {
      throw new Error(
        `INSUFFICIENT_CREDIT_BALANCE: current=${current}, delta=${params.deltaCents}`
      );
    }
    const entry: CreditLedgerEntryDTO = {
      id: crypto.randomUUID(),
      userId: params.userId,
      orderId: params.orderId ?? null,
      deltaCents: params.deltaCents,
      reason: params.reason,
      note: params.note ?? null,
      createdBy: params.createdBy ?? null,
      createdAt: now,
    };
    state.creditLedger.push(entry);
    return entry;
  }

  const { data, error } = await ctx.admin
    .from("credit_ledger")
    .insert({
      user_id: params.userId,
      order_id: params.orderId ?? null,
      delta_cents: params.deltaCents,
      reason: params.reason,
      note: params.note ?? null,
      created_by: params.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw error;
  return {
    id: data.id,
    userId: data.user_id,
    orderId: data.order_id,
    deltaCents: data.delta_cents,
    reason: data.reason,
    note: data.note,
    createdBy: data.created_by,
    createdAt: data.created_at,
  };
}

export async function listCustomersAdmin(): Promise<CustomerSummaryDTO[]> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    return computeSandboxCustomerSummaries();
  }

  const [{ data: profiles }, { data: ledger }, { data: orders }] =
    await Promise.all([
      ctx.admin.from("profiles").select("*").order("created_at", { ascending: false }),
      ctx.admin.from("credit_ledger").select("user_id, delta_cents"),
      ctx.admin.from("orders").select("user_id, subtotal_cents, paid_cents, status"),
    ]);

  const balanceMap = new Map<string, number>();
  for (const l of ledger ?? []) {
    balanceMap.set(l.user_id, (balanceMap.get(l.user_id) ?? 0) + l.delta_cents);
  }

  const statsMap = new Map<string, { count: number; spent: number }>();
  for (const o of orders ?? []) {
    if (!o.user_id) continue;
    const prev = statsMap.get(o.user_id) ?? { count: 0, spent: 0 };
    prev.count += 1;
    if (o.paid_cents > 0 || o.status === "DELIVERED") {
      prev.spent += o.subtotal_cents;
    }
    statsMap.set(o.user_id, prev);
  }

  return (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    role: p.role,
    creditBalanceCents: balanceMap.get(p.id) ?? 0,
    ordersCount: statsMap.get(p.id)?.count ?? 0,
    totalSpentCents: statsMap.get(p.id)?.spent ?? 0,
    createdAt: p.created_at,
  }));
}

// ============================================================================
// WEBHOOK EVENTS & AUDIT LOG
// ============================================================================

export async function recordWebhookEventOnce(params: {
  gateway: string;
  eventId: string;
  eventType: string;
  orderId: string | null;
  gatewayCheckoutId: string | null;
  signatureValid: boolean;
  payload: Record<string, unknown>;
  status?: "processed" | "ignored" | "failed";
  errorMessage?: string | null;
}): Promise<{ isDuplicate: boolean; recordId: string }> {
  const ctx = assertDbOrSandbox();
  const now = new Date().toISOString();

  if (ctx.mode === "sandbox") {
    const state = getSandboxState();
    const existing = state.webhookEvents.find(
      (w) => w.gateway === params.gateway && w.eventId === params.eventId
    );
    if (existing) {
      return { isDuplicate: true, recordId: existing.id };
    }
    const id = crypto.randomUUID();
    state.webhookEvents.unshift({
      id,
      gateway: params.gateway,
      eventId: params.eventId,
      eventType: params.eventType,
      orderId: params.orderId,
      gatewayCheckoutId: params.gatewayCheckoutId,
      signatureValid: params.signatureValid,
      status: params.status ?? "processed",
      errorMessage: params.errorMessage ?? null,
      processedAt: now,
      payload: params.payload,
    });
    return { isDuplicate: false, recordId: id };
  }

  const { data, error } = await ctx.admin
    .from("webhook_events")
    .insert({
      gateway: params.gateway,
      event_id: params.eventId,
      event_type: params.eventType,
      order_id: params.orderId,
      gateway_checkout_id: params.gatewayCheckoutId,
      signature_valid: params.signatureValid,
      payload: params.payload,
      status: params.status ?? "processed",
      error_message: params.errorMessage ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // Postgres unique violation 23505 -> idempotent duplicate webhook delivery
    if (error.code === "23505") {
      return { isDuplicate: true, recordId: "" };
    }
    throw error;
  }
  return { isDuplicate: false, recordId: data.id };
}

export async function updateWebhookEventStatus(
  recordId: string,
  status: "processed" | "ignored" | "failed",
  errorMessage?: string | null
) {
  if (!recordId) return;
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    const row = getSandboxState().webhookEvents.find((w) => w.id === recordId);
    if (row) {
      row.status = status;
      row.errorMessage = errorMessage ?? null;
    }
    return;
  }
  await ctx.admin
    .from("webhook_events")
    .update({ status, error_message: errorMessage ?? null })
    .eq("id", recordId);
}

export async function listWebhookEventsAdmin(): Promise<WebhookEventDTO[]> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    return getSandboxState().webhookEvents.slice(0, 100).map((w) => ({
      id: w.id,
      gateway: w.gateway,
      eventId: w.eventId,
      eventType: w.eventType,
      orderId: w.orderId,
      gatewayCheckoutId: w.gatewayCheckoutId,
      signatureValid: w.signatureValid,
      status: w.status,
      errorMessage: w.errorMessage,
      processedAt: w.processedAt,
    }));
  }

  const { data, error } = await ctx.admin
    .from("webhook_events")
    .select(
      "id, gateway, event_id, event_type, order_id, gateway_checkout_id, signature_valid, status, error_message, processed_at"
    )
    .order("processed_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    gateway: r.gateway,
    eventId: r.event_id,
    eventType: r.event_type,
    orderId: r.order_id,
    gatewayCheckoutId: r.gateway_checkout_id,
    signatureValid: Boolean(r.signature_valid),
    status: r.status,
    errorMessage: r.error_message,
    processedAt: r.processed_at,
  }));
}

export async function appendAuditLog(params: {
  actorId: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  const ctx = assertDbOrSandbox();
  const entry: AuditLogEntryDTO = {
    id: crypto.randomUUID(),
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    metadata: params.metadata ?? {},
    createdAt: new Date().toISOString(),
  };

  if (ctx.mode === "sandbox") {
    getSandboxState().auditLog.unshift(entry);
    return;
  }

  const { error } = await ctx.admin.from("audit_log").insert({
    actor_id: params.actorId,
    actor_role: params.actorRole,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId,
    metadata: params.metadata ?? {},
  });
  if (error) throw error;
}

export async function listAuditLogsAdmin(limit = 100): Promise<AuditLogEntryDTO[]> {
  const ctx = assertDbOrSandbox();
  if (ctx.mode === "sandbox") {
    return getSandboxState().auditLog.slice(0, limit);
  }
  const { data, error } = await ctx.admin
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdAt: r.created_at,
  }));
}
