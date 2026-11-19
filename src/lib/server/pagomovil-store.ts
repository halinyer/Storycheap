import "server-only";
import crypto from "crypto";
import {
  clampFeePct,
  computeGrossUpBsRateCents,
  DEFAULT_BDV_FEE_PASS_THROUGH,
  DEFAULT_BDV_INCOMING_FEE_PCT,
  DEFAULT_BDV_OUTGOING_FEE_PCT,
  normalizeBdvFeePassThroughMode,
} from "@/lib/bdv-fees";
import type {
  BankPaymentNotificationDTO,
  PagoMovilSettingsDTO,
  ReceiverBankAccountDTO,
} from "@/types";
import { decryptCode, encryptCode, sha256CodeHash } from "./crypto";
import { isDemoSandboxEnabled } from "./env";
import { recordWebhookEventOnce } from "./repository";
import { getSandboxState } from "./sandbox-db";
import { getSupabaseAdmin } from "./supabase-admin";

// Preserve existing store_settings keys so production Supabase records stay 100% compatible
const SETTINGS_KEY = "pagomovil_bot_settings";
const ACCOUNTS_KEY = "pagomovil_receiver_accounts";
const NOTIFICATIONS_KEY = "pagomovil_notifications_ledger";
const REPORTS_KEY = "pagomovil_order_reports";
const WEBHOOK_SECRET_KEY = "pagomovil_webhook_secret";

// Disjoint row-per-entity prefixes eliminate concurrent read-modify-write lost updates in store_settings
const NOTIF_ROW_PREFIX = "pm_notif:";
const REPORT_ROW_PREFIX = "pm_report:";

interface StoredNotificationValue extends BankPaymentNotificationDTO {
  _rev?: number;
}

interface StoredOrderReportValue extends OrderPagoMovilReport {
  _rev?: number;
}

function stripNotifRev(raw: StoredNotificationValue): BankPaymentNotificationDTO {
  const { _rev: _omit, ...dto } = raw;
  void _omit;
  return dto;
}

function stripReportRev(raw: StoredOrderReportValue): OrderPagoMovilReport {
  const { _rev: _omit, ...dto } = raw;
  void _omit;
  return dto;
}

function isPgUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: string }).code === "23505";
}

const DEFAULT_PAGOMOVIL_SETTINGS: PagoMovilSettingsDTO = {
  rateExpirationMinutes: 20,
  orderExpirationMinutes: 25,
  amountToleranceBsCents: 5,
  minReferenceDigits: 6,
  incomingFeePct: DEFAULT_BDV_INCOMING_FEE_PCT,
  outgoingFeePct: DEFAULT_BDV_OUTGOING_FEE_PCT,
  feePassThroughMode: DEFAULT_BDV_FEE_PASS_THROUGH,
};

export interface OrderPagoMovilReport {
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

function assertStoreMode() {
  const admin = getSupabaseAdmin();
  if (admin) return { mode: "supabase" as const, admin };
  if (isDemoSandboxEnabled()) return { mode: "sandbox" as const, admin: null };
  throw new Error(
    "Supabase service credentials are missing and Demo Sandbox mode is disabled."
  );
}

async function readSettingValue<T>(key: string): Promise<T | null> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") return null;
  const { data, error } = await ctx.admin
    .from("store_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return (data.value as T) ?? null;
}

async function writeSettingValue(
  key: string,
  value: unknown,
  updatedBy?: string | null
): Promise<void> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") return;
  const { error } = await ctx.admin.from("store_settings").upsert({
    key,
    value,
    updated_by: updatedBy ?? null,
  });
  if (error) throw error;
}

export function normalizeReferenceDigits(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function referencesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = normalizeReferenceDigits(a);
  const nb = normalizeReferenceDigits(b);
  if (na.length < 4 || nb.length < 4) return false;
  if (na === nb) return true;
  const za = na.replace(/^0+/, "");
  const zb = nb.replace(/^0+/, "");
  if (za && zb && za === zb) return true;
  if (na.length >= 6 && nb.length > na.length && nb.endsWith(na)) return true;
  if (nb.length >= 6 && na.length > nb.length && na.endsWith(nb)) return true;
  return false;
}

// ============================================================================
// PAGO MOVIL BDV SETTINGS & INTERNAL WEBHOOK SECRET
// ============================================================================

export async function getPagoMovilSettings(): Promise<PagoMovilSettingsDTO> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return {
      ...DEFAULT_PAGOMOVIL_SETTINGS,
      ...getSandboxState().pagoMovil.settings,
    };
  }
  const saved = await readSettingValue<Partial<PagoMovilSettingsDTO>>(SETTINGS_KEY);
  return {
    rateExpirationMinutes:
      typeof saved?.rateExpirationMinutes === "number"
        ? saved.rateExpirationMinutes
        : DEFAULT_PAGOMOVIL_SETTINGS.rateExpirationMinutes,
    orderExpirationMinutes:
      typeof saved?.orderExpirationMinutes === "number"
        ? saved.orderExpirationMinutes
        : DEFAULT_PAGOMOVIL_SETTINGS.orderExpirationMinutes,
    amountToleranceBsCents:
      typeof saved?.amountToleranceBsCents === "number"
        ? saved.amountToleranceBsCents
        : DEFAULT_PAGOMOVIL_SETTINGS.amountToleranceBsCents,
    minReferenceDigits:
      typeof saved?.minReferenceDigits === "number"
        ? saved.minReferenceDigits
        : DEFAULT_PAGOMOVIL_SETTINGS.minReferenceDigits,
    incomingFeePct: clampFeePct(
      saved?.incomingFeePct,
      DEFAULT_PAGOMOVIL_SETTINGS.incomingFeePct
    ),
    outgoingFeePct: clampFeePct(
      saved?.outgoingFeePct,
      DEFAULT_PAGOMOVIL_SETTINGS.outgoingFeePct
    ),
    feePassThroughMode: normalizeBdvFeePassThroughMode(
      saved?.feePassThroughMode,
      DEFAULT_BDV_FEE_PASS_THROUGH
    ),
  };
}

/**
 * Returns the customer-facing Bs/USD rate after applying any configured BDV fee pass-through
 * (gross-up) on top of the merchant's target net Bs rate.
 */
export async function getEffectiveCustomerBsRateCents(
  baseBsRateCents: number | null
): Promise<number | null> {
  if (!baseBsRateCents || baseBsRateCents <= 0) return null;
  const settings = await getPagoMovilSettings();
  return computeGrossUpBsRateCents({
    baseBsRateCents,
    incomingFeePct: settings.incomingFeePct,
    outgoingFeePct: settings.outgoingFeePct,
    passThroughMode: settings.feePassThroughMode ?? DEFAULT_BDV_FEE_PASS_THROUGH,
  });
}

export async function savePagoMovilSettings(
  patch: Partial<PagoMovilSettingsDTO>,
  updatedBy?: string | null
): Promise<PagoMovilSettingsDTO> {
  const current = await getPagoMovilSettings();
  const next: PagoMovilSettingsDTO = {
    rateExpirationMinutes: Math.min(
      120,
      Math.max(5, Number(patch.rateExpirationMinutes ?? current.rateExpirationMinutes))
    ),
    orderExpirationMinutes: Math.min(
      180,
      Math.max(5, Number(patch.orderExpirationMinutes ?? current.orderExpirationMinutes))
    ),
    amountToleranceBsCents: Math.min(
      500,
      Math.max(0, Number(patch.amountToleranceBsCents ?? current.amountToleranceBsCents))
    ),
    minReferenceDigits: Math.min(
      12,
      Math.max(4, Number(patch.minReferenceDigits ?? current.minReferenceDigits))
    ),
    incomingFeePct: clampFeePct(
      patch.incomingFeePct ?? current.incomingFeePct,
      DEFAULT_PAGOMOVIL_SETTINGS.incomingFeePct
    ),
    outgoingFeePct: clampFeePct(
      patch.outgoingFeePct ?? current.outgoingFeePct,
      DEFAULT_PAGOMOVIL_SETTINGS.outgoingFeePct
    ),
    feePassThroughMode: normalizeBdvFeePassThroughMode(
      patch.feePassThroughMode ?? current.feePassThroughMode,
      DEFAULT_BDV_FEE_PASS_THROUGH
    ),
  };

  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    getSandboxState().pagoMovil.settings = next;
    return { ...next };
  }
  await writeSettingValue(SETTINGS_KEY, next, updatedBy);
  return next;
}

export async function getOrCreatePagoMovilWebhookSecret(): Promise<string> {
  const envSecret = process.env.PAGOMOVIL_WEBHOOK_SECRET?.trim();
  if (envSecret) return envSecret;

  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    const pm = getSandboxState().pagoMovil;
    if (!pm.webhookSecretCiphertext) {
      const plain = `whsec_pm_${crypto.randomBytes(24).toString("hex")}`;
      pm.webhookSecretCiphertext = encryptCode(plain);
      return plain;
    }
    return decryptCode(pm.webhookSecretCiphertext);
  }

  const saved = await readSettingValue<{ ciphertext?: string }>(WEBHOOK_SECRET_KEY);
  if (saved?.ciphertext) {
    try {
      return decryptCode(saved.ciphertext);
    } catch {
      // Regenerate if encryption key rotated
    }
  }
  const plain = `whsec_pm_${crypto.randomBytes(24).toString("hex")}`;
  await writeSettingValue(WEBHOOK_SECRET_KEY, { ciphertext: encryptCode(plain) });
  return plain;
}

// ============================================================================
// RECEIVER BANK ACCOUNTS (CUENTA JURÍDICA BDV)
// ============================================================================

export async function listReceiverBankAccounts(): Promise<ReceiverBankAccountDTO[]> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return getSandboxState().pagoMovil.receiverAccounts.map((a) => ({ ...a }));
  }
  const saved = await readSettingValue<{ accounts?: ReceiverBankAccountDTO[] }>(ACCOUNTS_KEY);
  return Array.isArray(saved?.accounts) ? saved.accounts : [];
}

export async function getActiveReceiverBankAccount(): Promise<ReceiverBankAccountDTO | null> {
  const all = await listReceiverBankAccounts();
  return all.find((a) => a.active) ?? null;
}

export async function saveReceiverBankAccount(
  input: {
    id?: string;
    bankCode: string;
    bankName: string;
    accountType: "natural" | "juridical";
    phone: string;
    dni: string;
    holderName: string;
    active: boolean;
  },
  updatedBy?: string | null
): Promise<ReceiverBankAccountDTO> {
  const all = await listReceiverBankAccounts();
  const now = new Date().toISOString();
  const id = input.id?.trim() || crypto.randomUUID();
  const existing = all.find((a) => a.id === id);

  const savedRow: ReceiverBankAccountDTO = {
    id,
    bankCode: input.bankCode.trim(),
    bankName: input.bankName.trim(),
    accountType: input.accountType,
    phone: input.phone.trim(),
    dni: input.dni.trim().toUpperCase(),
    holderName: input.holderName.trim(),
    active: input.active,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const next = [
    savedRow,
    ...all
      .filter((a) => a.id !== id)
      .map((a) => (savedRow.active ? { ...a, active: false } : a)),
  ];

  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    getSandboxState().pagoMovil.receiverAccounts = next;
    return savedRow;
  }
  await writeSettingValue(ACCOUNTS_KEY, { accounts: next }, updatedBy);
  return savedRow;
}

// ============================================================================
// VERIFIED MOVEMENTS LEDGER & ATOMIC CLAIM (ANTI-REPLAY)
// ============================================================================

async function getNotificationRecordById(notificationId: string): Promise<{
  dto: BankPaymentNotificationDTO;
  hasSeparateRow: boolean;
  rev: number;
} | null> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    const found = getSandboxState().pagoMovil.notifications.find(
      (n) => n.id === notificationId
    );
    return found ? { dto: found, hasSeparateRow: true, rev: 1 } : null;
  }

  const perRowRes = await ctx.admin
    .from("store_settings")
    .select("value")
    .like("key", `${NOTIF_ROW_PREFIX}%`)
    .contains("value", { id: notificationId })
    .maybeSingle();

  if (perRowRes.data?.value) {
    const raw = perRowRes.data.value as StoredNotificationValue;
    return {
      dto: stripNotifRev(raw),
      hasSeparateRow: true,
      rev: typeof raw._rev === "number" ? raw._rev : 1,
    };
  }

  const legacy = await readSettingValue<{
    notifications?: BankPaymentNotificationDTO[];
  }>(NOTIFICATIONS_KEY);
  const foundLegacy = (legacy?.notifications ?? []).find(
    (n) => n.id === notificationId
  );
  return foundLegacy
    ? { dto: foundLegacy, hasSeparateRow: false, rev: 0 }
    : null;
}

async function readNotificationRows(): Promise<BankPaymentNotificationDTO[]> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return [...getSandboxState().pagoMovil.notifications];
  }
  const [perRowRes, legacy] = await Promise.all([
    ctx.admin
      .from("store_settings")
      .select("value, updated_at")
      .like("key", `${NOTIF_ROW_PREFIX}%`)
      .order("updated_at", { ascending: false })
      .limit(500),
    readSettingValue<{ notifications?: BankPaymentNotificationDTO[] }>(
      NOTIFICATIONS_KEY
    ),
  ]);

  const byHash = new Map<string, BankPaymentNotificationDTO>();
  for (const n of legacy?.notifications ?? []) {
    if (n?.rawContentHash) byHash.set(n.rawContentHash, n);
  }
  for (const row of perRowRes.data ?? []) {
    const raw = row.value as StoredNotificationValue | null;
    if (raw?.rawContentHash) {
      byHash.set(raw.rawContentHash, stripNotifRev(raw));
    }
  }

  return Array.from(byHash.values())
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 500);
}

export async function listBankNotifications(
  limit = 100
): Promise<BankPaymentNotificationDTO[]> {
  const rows = await readNotificationRows();
  return rows.slice(0, limit);
}

export async function getBankNotificationById(
  notificationId: string
): Promise<BankPaymentNotificationDTO | null> {
  const rec = await getNotificationRecordById(notificationId);
  return rec?.dto ?? null;
}

export async function getMatchedNotificationForOrder(
  orderId: string
): Promise<BankPaymentNotificationDTO | null> {
  const list = await getMatchedNotificationsForOrder(orderId);
  return list[0] ?? null;
}

/** All verified bank movements claimed by an order (supports multiple partial Pago Móvil transfers). */
export async function getMatchedNotificationsForOrder(
  orderId: string
): Promise<BankPaymentNotificationDTO[]> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return getSandboxState().pagoMovil.notifications.filter(
      (n) => n.matchedOrderId === orderId && n.status === "MATCHED"
    );
  }

  const [perRowRes, legacy] = await Promise.all([
    ctx.admin
      .from("store_settings")
      .select("value")
      .like("key", `${NOTIF_ROW_PREFIX}%`)
      .contains("value", { matchedOrderId: orderId, status: "MATCHED" }),
    readSettingValue<{ notifications?: BankPaymentNotificationDTO[] }>(
      NOTIFICATIONS_KEY
    ),
  ]);

  const byId = new Map<string, BankPaymentNotificationDTO>();
  for (const n of legacy?.notifications ?? []) {
    if (n.matchedOrderId === orderId && n.status === "MATCHED") {
      byId.set(n.id, n);
    }
  }
  for (const row of perRowRes.data ?? []) {
    const raw = row.value as StoredNotificationValue | null;
    if (raw && raw.matchedOrderId === orderId && raw.status === "MATCHED") {
      byId.set(raw.id, stripNotifRev(raw));
    }
  }
  return Array.from(byId.values());
}

/** Total Bs (cents) already received and claimed for an order across all partial payments. */
export async function getReceivedBsCentsForOrder(
  orderId: string
): Promise<number> {
  const matched = await getMatchedNotificationsForOrder(orderId);
  return matched.reduce((acc, n) => acc + (n.amountBsCents ?? 0), 0);
}

export function buildNotificationContentHash(args: {
  deviceId: string | null;
  sourceType: string;
  content: string;
  postedAt: string;
  explicitEventId?: string | null;
}): string {
  const key = args.explicitEventId?.trim()
    ? `${args.deviceId ?? "global"}:${args.explicitEventId.trim()}`
    : `${args.deviceId ?? "global"}:${args.sourceType}:${args.postedAt}:${args.content.trim()}`;
  return sha256CodeHash(key);
}

export async function insertBankNotification(
  input: Omit<BankPaymentNotificationDTO, "id" | "createdAt">
): Promise<{ notification: BankPaymentNotificationDTO; isDuplicate: boolean }> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    const list = getSandboxState().pagoMovil.notifications;
    const existing = list.find((n) => n.rawContentHash === input.rawContentHash);
    if (existing) {
      return { notification: existing, isDuplicate: true };
    }
    const created: BankPaymentNotificationDTO = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    list.unshift(created);
    if (list.length > 500) list.length = 500;
    return { notification: created, isDuplicate: false };
  }

  const rowKey = `${NOTIF_ROW_PREFIX}${input.rawContentHash}`;
  const created: StoredNotificationValue = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    _rev: 1,
  };

  const { error } = await ctx.admin.from("store_settings").insert({
    key: rowKey,
    value: created,
  });

  if (!error) {
    return { notification: stripNotifRev(created), isDuplicate: false };
  }

  if (isPgUniqueViolation(error)) {
    const existing = await readSettingValue<StoredNotificationValue>(rowKey);
    if (existing) {
      return { notification: stripNotifRev(existing), isDuplicate: true };
    }
  }

  throw error;
}

async function getWebhookLockOwnerOrderId(
  gateway: string,
  eventId: string
): Promise<{ orderId: string | null; notificationId: string | null } | null> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    const found = getSandboxState().webhookEvents.find(
      (w) => w.gateway === gateway && w.eventId === eventId
    );
    if (!found) return null;
    const notifId =
      typeof (found.payload as { notificationId?: unknown })?.notificationId ===
      "string"
        ? String((found.payload as { notificationId: string }).notificationId)
        : null;
    return { orderId: found.orderId ?? null, notificationId: notifId };
  }

  const { data } = await ctx.admin
    .from("webhook_events")
    .select("order_id, payload")
    .eq("gateway", gateway)
    .eq("event_id", eventId)
    .maybeSingle();

  if (!data) return null;
  const payload = (data.payload as { notificationId?: unknown } | null) ?? null;
  return {
    orderId: data.order_id ? String(data.order_id) : null,
    notificationId:
      typeof payload?.notificationId === "string" ? payload.notificationId : null,
  };
}

/**
 * Checks whether a BDV movement lock key (`bdv:{fechaPago}:{ref}:{receiverPhone}`)
 * has already been consumed by any order. Prevents unnecessary BDV API calls and replay attacks.
 */
export async function findClaimedBdvLockOwner(
  dedupKey: string
): Promise<{ orderId: string | null; notificationId: string | null } | null> {
  return getWebhookLockOwnerOrderId("pagomovil_ref_claim", dedupKey);
}

export async function claimNotificationForOrder(params: {
  notificationId: string;
  orderId: string;
  receiverAccountId: string | null;
  referenceFull: string;
  amountBsCents: number;
  /** Optional deterministic lock key (e.g. `bdv:YYYY-MM-DD:REF:DEST_PHONE`) */
  dedupKey?: string;
}): Promise<
  | { ok: true; notification: BankPaymentNotificationDTO }
  | { ok: false; reason: "DUPLICATE_REFERENCE" | "ALREADY_CLAIMED" | "NOT_FOUND" }
> {
  const initial = await getNotificationRecordById(params.notificationId);
  if (!initial) return { ok: false, reason: "NOT_FOUND" };

  const target = initial.dto;
  if (target.status === "MATCHED") {
    if (target.matchedOrderId === params.orderId) {
      return { ok: true, notification: target };
    }
    return { ok: false, reason: "ALREADY_CLAIMED" };
  }
  if (target.status !== "UNMATCHED" && target.status !== "UNPARSED") {
    return { ok: false, reason: "ALREADY_CLAIMED" };
  }

  // Lock 1: unique Postgres lock (`unique (gateway, event_id)`) prevents reusing a bank reference across orders
  const refNorm = normalizeReferenceDigits(params.referenceFull);
  const refEventId =
    params.dedupKey?.trim() ||
    `${params.receiverAccountId ?? "default"}:${refNorm}:${params.amountBsCents}`;
  const refLock = await recordWebhookEventOnce({
    gateway: "pagomovil_ref_claim",
    eventId: refEventId,
    eventType: "reference.claimed",
    orderId: params.orderId,
    gatewayCheckoutId: `pm_${params.orderId}`,
    signatureValid: true,
    payload: {
      notificationId: params.notificationId,
      referenceFull: refNorm,
      amountBsCents: params.amountBsCents,
    },
    status: "processed",
  });

  if (refLock.isDuplicate) {
    const owner = await getWebhookLockOwnerOrderId(
      "pagomovil_ref_claim",
      refEventId
    );
    if (owner?.orderId !== params.orderId) {
      return { ok: false, reason: "DUPLICATE_REFERENCE" };
    }
    if (
      owner.notificationId &&
      owner.notificationId !== params.notificationId
    ) {
      return { ok: false, reason: "DUPLICATE_REFERENCE" };
    }
    const ownMatched = (await getMatchedNotificationsForOrder(params.orderId)).find(
      (n) => referencesMatch(n.referenceFull, refNorm)
    );
    if (ownMatched && ownMatched.id === params.notificationId) {
      return { ok: true, notification: ownMatched };
    }
  }

  // Lock 2: unique Postgres lock per notification ID prevents concurrent double-claim
  const notifLock = await recordWebhookEventOnce({
    gateway: "pagomovil_notif_claim",
    eventId: params.notificationId,
    eventType: "notification.claimed",
    orderId: params.orderId,
    gatewayCheckoutId: `pm_${params.orderId}`,
    signatureValid: true,
    payload: {
      notificationId: params.notificationId,
      referenceFull: refNorm,
      amountBsCents: params.amountBsCents,
    },
    status: "processed",
  });

  if (notifLock.isDuplicate) {
    const owner = await getWebhookLockOwnerOrderId(
      "pagomovil_notif_claim",
      params.notificationId
    );
    if (owner?.orderId !== params.orderId) {
      return { ok: false, reason: "ALREADY_CLAIMED" };
    }
  }

  const now = new Date().toISOString();
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    const list = getSandboxState().pagoMovil.notifications;
    const liveIdx = list.findIndex((n) => n.id === params.notificationId);
    if (liveIdx === -1) return { ok: false, reason: "NOT_FOUND" };
    const live = list[liveIdx];
    if (live.status === "MATCHED") {
      return live.matchedOrderId === params.orderId
        ? { ok: true, notification: live }
        : { ok: false, reason: "ALREADY_CLAIMED" };
    }
    if (live.status !== "UNMATCHED" && live.status !== "UNPARSED") {
      return { ok: false, reason: "ALREADY_CLAIMED" };
    }
    const updated: BankPaymentNotificationDTO = {
      ...live,
      status: "MATCHED",
      matchedOrderId: params.orderId,
      matchedAt: now,
    };
    list[liveIdx] = updated;
    return { ok: true, notification: updated };
  }

  const rowKey = `${NOTIF_ROW_PREFIX}${target.rawContentHash}`;
  const updated: StoredNotificationValue = {
    ...target,
    status: "MATCHED",
    matchedOrderId: params.orderId,
    matchedAt: now,
    _rev: initial.rev + 1,
  };

  if (!initial.hasSeparateRow) {
    const { error } = await ctx.admin.from("store_settings").insert({
      key: rowKey,
      value: updated,
    });
    if (!error) {
      return { ok: true, notification: stripNotifRev(updated) };
    }
    if (!isPgUniqueViolation(error)) throw error;
  }

  const { data: casData, error: casErr } = await ctx.admin
    .from("store_settings")
    .update({ value: updated })
    .eq("key", rowKey)
    .contains("value", { status: target.status })
    .select("value")
    .maybeSingle();

  if (casErr) throw casErr;
  if (casData?.value) {
    return {
      ok: true,
      notification: stripNotifRev(casData.value as StoredNotificationValue),
    };
  }

  const reread = await readSettingValue<StoredNotificationValue>(rowKey);
  if (
    reread &&
    reread.status === "MATCHED" &&
    reread.matchedOrderId === params.orderId
  ) {
    return { ok: true, notification: stripNotifRev(reread) };
  }
  return { ok: false, reason: "ALREADY_CLAIMED" };
}

export async function markNotificationStatus(
  notificationId: string,
  status: BankPaymentNotificationDTO["status"],
  matchedOrderId?: string | null
): Promise<void> {
  const ctx = assertStoreMode();
  const now = new Date().toISOString();
  if (ctx.mode === "sandbox") {
    const list = getSandboxState().pagoMovil.notifications;
    const idx = list.findIndex((n) => n.id === notificationId);
    if (idx === -1) return;
    const cur = list[idx];
    list[idx] = {
      ...cur,
      status,
      matchedOrderId: matchedOrderId ?? cur.matchedOrderId,
      matchedAt: status === "MATCHED" ? now : cur.matchedAt,
    };
    return;
  }

  const rec = await getNotificationRecordById(notificationId);
  if (!rec) return;

  const rowKey = `${NOTIF_ROW_PREFIX}${rec.dto.rawContentHash}`;
  const nextVal: StoredNotificationValue = {
    ...rec.dto,
    status,
    matchedOrderId: matchedOrderId ?? rec.dto.matchedOrderId,
    matchedAt: status === "MATCHED" ? now : rec.dto.matchedAt,
    _rev: rec.rev + 1,
  };
  await writeSettingValue(rowKey, nextVal);
}

// ============================================================================
// PER-ORDER PAGO MOVIL REPORT STATE
// ============================================================================

function defaultEmptyOrderReport(orderId: string): OrderPagoMovilReport {
  return {
    orderId,
    amountDueBsCents: null,
    rateExpiresAt: null,
    reportedReference: null,
    reportedSenderPhone: null,
    reportedSenderBank: null,
    reportedSenderDni: null,
    reportedAmountBsCents: null,
    reportedPaymentDate: null,
    reportedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
}

export async function getOrderPagoMovilReport(
  orderId: string
): Promise<OrderPagoMovilReport | null> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return getSandboxState().pagoMovil.orderReports[orderId] ?? null;
  }
  const raw = await readSettingValue<StoredOrderReportValue>(
    `${REPORT_ROW_PREFIX}${orderId}`
  );
  if (raw?.orderId) {
    return stripReportRev(raw);
  }
  const legacy = await readSettingValue<{
    reports?: Record<string, OrderPagoMovilReport>;
  }>(REPORTS_KEY);
  return legacy?.reports?.[orderId] ?? null;
}

export async function saveOrderPagoMovilReport(
  orderId: string,
  patch: Partial<OrderPagoMovilReport>
): Promise<OrderPagoMovilReport> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    const map = getSandboxState().pagoMovil.orderReports;
    const nextReport: OrderPagoMovilReport = {
      ...(map[orderId] ?? defaultEmptyOrderReport(orderId)),
      ...patch,
      orderId,
    };
    map[orderId] = nextReport;
    return nextReport;
  }

  const rowKey = `${REPORT_ROW_PREFIX}${orderId}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: existingRow } = await ctx.admin
      .from("store_settings")
      .select("value, updated_at")
      .eq("key", rowKey)
      .maybeSingle();

    const existingVal = existingRow?.value as StoredOrderReportValue | null;
    const base =
      existingVal ??
      (
        await readSettingValue<{
          reports?: Record<string, OrderPagoMovilReport>;
        }>(REPORTS_KEY)
      )?.reports?.[orderId] ??
      defaultEmptyOrderReport(orderId);

    const prevRev = typeof existingVal?._rev === "number" ? existingVal._rev : 0;
    const mergedDto: OrderPagoMovilReport = {
      ...stripReportRev(base),
      ...patch,
      orderId,
    };
    const nextStored: StoredOrderReportValue = {
      ...mergedDto,
      _rev: prevRev + 1,
    };

    if (!existingRow) {
      const { error: insErr } = await ctx.admin.from("store_settings").insert({
        key: rowKey,
        value: nextStored,
      });
      if (!insErr) return mergedDto;
      if (isPgUniqueViolation(insErr)) continue;
      throw insErr;
    }

    let query = ctx.admin
      .from("store_settings")
      .update({ value: nextStored })
      .eq("key", rowKey);

    query =
      typeof existingVal?._rev === "number"
        ? query.contains("value", { _rev: prevRev })
        : query.eq("updated_at", String(existingRow.updated_at));

    const { data: updData, error: updErr } = await query
      .select("key")
      .maybeSingle();
    if (updErr) throw updErr;
    if (updData) return mergedDto;
  }

  throw new Error(
    `Concurrent update conflict saving Pago Móvil report for order ${orderId}`
  );
}
