import "server-only";
import crypto from "crypto";
import type {
  BankPaymentNotificationDTO,
  BotDeviceDTO,
  OrderDTO,
  PagoMovilBotSettingsDTO,
  ReceiverBankAccountDTO,
} from "@/types";
import { decryptCode, encryptCode, sha256CodeHash } from "./crypto";
import { isDemoSandboxEnabled } from "./env";
import { DEFAULT_ANDROID_PACKAGES_BY_BANK } from "@/lib/catalog-banks";
import { recordWebhookEventOnce } from "./repository";
import { getSandboxState, type SandboxBotDeviceRow } from "./sandbox-db";
import { getSupabaseAdmin } from "./supabase-admin";

const SETTINGS_KEY = "pagomovil_bot_settings";
const DEVICES_KEY = "pagomovil_bot_devices";
const ACCOUNTS_KEY = "pagomovil_receiver_accounts";
const NOTIFICATIONS_KEY = "pagomovil_notifications_ledger";
const REPORTS_KEY = "pagomovil_order_reports";
const WEBHOOK_SECRET_KEY = "pagomovil_webhook_secret";

const DEFAULT_BOT_SETTINGS: PagoMovilBotSettingsDTO = {
  rateExpirationMinutes: 20,
  orderExpirationMinutes: 25,
  amountToleranceBsCents: 5,
  watchdogOfflineMinutes: 15,
  enforceWatchdog: false,
  requireSenderPhone: false,
  minReferenceDigits: 4,
};

export interface OrderPagoMovilReport {
  orderId: string;
  amountDueBsCents: number | null;
  rateExpiresAt: string | null;
  reportedReference: string | null;
  reportedSenderPhone: string | null;
  reportedSenderBank: string | null;
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

function stripDeviceSecret(row: SandboxBotDeviceRow): BotDeviceDTO {
  const { secretCiphertext: _omit, ...dto } = row;
  void _omit;
  return { ...dto };
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
  // Compare stripped leading zeros when numeric
  const za = na.replace(/^0+/, "");
  const zb = nb.replace(/^0+/, "");
  if (za && zb && za === zb) return true;
  // Suffix match (e.g. buyer submits last 6 digits of full 12-digit reference)
  if (na.length >= 4 && nb.length > na.length && nb.endsWith(na)) return true;
  if (nb.length >= 4 && na.length > nb.length && na.endsWith(nb)) return true;
  return false;
}

// ============================================================================
// BOT SETTINGS & WEBHOOK SECRET
// ============================================================================

export async function getPagoMovilBotSettings(): Promise<PagoMovilBotSettingsDTO> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return { ...getSandboxState().pagoMovil.settings };
  }
  const saved = await readSettingValue<Partial<PagoMovilBotSettingsDTO>>(SETTINGS_KEY);
  return {
    ...DEFAULT_BOT_SETTINGS,
    ...(saved ?? {}),
  };
}

export async function savePagoMovilBotSettings(
  patch: Partial<PagoMovilBotSettingsDTO>,
  updatedBy?: string | null
): Promise<PagoMovilBotSettingsDTO> {
  const current = await getPagoMovilBotSettings();
  const next: PagoMovilBotSettingsDTO = {
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
    watchdogOfflineMinutes: Math.min(
      120,
      Math.max(1, Number(patch.watchdogOfflineMinutes ?? current.watchdogOfflineMinutes))
    ),
    enforceWatchdog:
      patch.enforceWatchdog !== undefined ? Boolean(patch.enforceWatchdog) : current.enforceWatchdog,
    requireSenderPhone:
      patch.requireSenderPhone !== undefined
        ? Boolean(patch.requireSenderPhone)
        : current.requireSenderPhone,
    minReferenceDigits: Math.min(
      12,
      Math.max(4, Number(patch.minReferenceDigits ?? current.minReferenceDigits))
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
// SENSOR DEVICES & WATCHDOG
// ============================================================================

async function readDeviceRows(): Promise<SandboxBotDeviceRow[]> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return getSandboxState().pagoMovil.devices;
  }
  const saved = await readSettingValue<{ devices?: SandboxBotDeviceRow[] }>(DEVICES_KEY);
  return Array.isArray(saved?.devices) ? saved.devices : [];
}

async function writeDeviceRows(
  rows: SandboxBotDeviceRow[],
  updatedBy?: string | null
): Promise<void> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    getSandboxState().pagoMovil.devices = rows;
    return;
  }
  await writeSettingValue(DEVICES_KEY, { devices: rows }, updatedBy);
}

export async function listBotDevices(): Promise<BotDeviceDTO[]> {
  const rows = await readDeviceRows();
  return rows.map(stripDeviceSecret);
}

export async function getBotDeviceWithSecret(
  idOrIdentifier: string
): Promise<{ device: BotDeviceDTO; secret: string } | null> {
  const rows = await readDeviceRows();
  const found = rows.find(
    (d) => d.id === idOrIdentifier || d.deviceIdentifier === idOrIdentifier
  );
  if (!found) return null;
  return {
    device: stripDeviceSecret(found),
    secret: decryptCode(found.secretCiphertext),
  };
}

export async function registerBotDevice(
  input: {
    name: string;
    deviceIdentifier?: string;
    channelType: BotDeviceDTO["channelType"];
    allowPlainBearer?: boolean;
  },
  updatedBy?: string | null
): Promise<{ device: BotDeviceDTO; plainSecret: string }> {
  const rows = await readDeviceRows();
  const identifier =
    input.deviceIdentifier?.trim() ||
    `dev_${crypto.randomBytes(6).toString("hex")}`;
  const existingIdx = rows.findIndex((d) => d.deviceIdentifier === identifier);
  const now = new Date().toISOString();
  const plainSecret = `spbot_${crypto.randomBytes(24).toString("hex")}`;
  const secretCiphertext = encryptCode(plainSecret);

  if (existingIdx !== -1) {
    const updated: SandboxBotDeviceRow = {
      ...rows[existingIdx],
      name: input.name.trim(),
      channelType: input.channelType,
      allowPlainBearer: Boolean(input.allowPlainBearer),
      secretCiphertext,
      active: true,
      updatedAt: now,
    };
    const next = [...rows];
    next[existingIdx] = updated;
    await writeDeviceRows(next, updatedBy);
    return { device: stripDeviceSecret(updated), plainSecret };
  }

  const created: SandboxBotDeviceRow = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    deviceIdentifier: identifier,
    channelType: input.channelType,
    allowPlainBearer: Boolean(input.allowPlainBearer),
    secretCiphertext,
    lastHeartbeatAt: null,
    batteryLevel: null,
    networkType: null,
    appVersion: null,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await writeDeviceRows([created, ...rows], updatedBy);
  return { device: stripDeviceSecret(created), plainSecret };
}

export async function updateBotDeviceHeartbeat(
  idOrIdentifier: string,
  patch: {
    batteryLevel?: number | null;
    networkType?: string | null;
    appVersion?: string | null;
  }
): Promise<BotDeviceDTO | null> {
  const rows = await readDeviceRows();
  const idx = rows.findIndex(
    (d) => d.id === idOrIdentifier || d.deviceIdentifier === idOrIdentifier
  );
  if (idx === -1) return null;

  const now = new Date().toISOString();
  const updated: SandboxBotDeviceRow = {
    ...rows[idx],
    lastHeartbeatAt: now,
    batteryLevel:
      typeof patch.batteryLevel === "number"
        ? Math.min(100, Math.max(0, Math.round(patch.batteryLevel)))
        : rows[idx].batteryLevel,
    networkType: patch.networkType ?? rows[idx].networkType,
    appVersion: patch.appVersion ?? rows[idx].appVersion,
    updatedAt: now,
  };
  const next = [...rows];
  next[idx] = updated;
  await writeDeviceRows(next);
  return stripDeviceSecret(updated);
}

export async function setBotDeviceActive(
  deviceId: string,
  active: boolean,
  updatedBy?: string | null
): Promise<void> {
  const rows = await readDeviceRows();
  const next = rows.map((d) =>
    d.id === deviceId ? { ...d, active, updatedAt: new Date().toISOString() } : d
  );
  await writeDeviceRows(next, updatedBy);
}

export async function deleteBotDevice(
  deviceId: string,
  updatedBy?: string | null
): Promise<void> {
  const rows = await readDeviceRows();
  await writeDeviceRows(
    rows.filter((d) => d.id !== deviceId),
    updatedBy
  );
}

export async function isBotWatchdogHealthy(
  settings?: PagoMovilBotSettingsDTO
): Promise<{
  online: boolean;
  activeDevicesCount: number;
  onlineDevicesCount: number;
  latestHeartbeatAt: string | null;
}> {
  const cfg = settings ?? (await getPagoMovilBotSettings());
  const devices = (await listBotDevices()).filter((d) => d.active);
  const cutoffMs = Date.now() - cfg.watchdogOfflineMinutes * 60_000;

  let onlineCount = 0;
  let latestMs = 0;
  let latestHeartbeatAt: string | null = null;

  for (const d of devices) {
    if (!d.lastHeartbeatAt) continue;
    const ms = Date.parse(d.lastHeartbeatAt);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latestHeartbeatAt = d.lastHeartbeatAt;
    }
    if (ms >= cutoffMs) {
      onlineCount += 1;
    }
  }

  return {
    online: onlineCount > 0,
    activeDevicesCount: devices.length,
    onlineDevicesCount: onlineCount,
    latestHeartbeatAt,
  };
}

// ============================================================================
// RECEIVER BANK ACCOUNTS
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
    allowedPackages?: string[];
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
    allowedPackages: input.allowedPackages?.length
      ? input.allowedPackages.map((p) => p.trim()).filter(Boolean)
      : existing?.allowedPackages ??
        DEFAULT_ANDROID_PACKAGES_BY_BANK[input.bankCode.trim()] ?? [
          "SMS",
          "EMAIL",
        ],
    active: input.active,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  // Ensure only one primary active receiver account if saving this one active
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
// NOTIFICATIONS LEDGER & ATOMIC CLAIM
// ============================================================================

async function readNotificationRows(): Promise<BankPaymentNotificationDTO[]> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return getSandboxState().pagoMovil.notifications;
  }
  const saved = await readSettingValue<{ notifications?: BankPaymentNotificationDTO[] }>(
    NOTIFICATIONS_KEY
  );
  return Array.isArray(saved?.notifications) ? saved.notifications : [];
}

async function writeNotificationRows(
  rows: BankPaymentNotificationDTO[]
): Promise<void> {
  const capped = rows.slice(0, 500);
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    getSandboxState().pagoMovil.notifications = capped;
    return;
  }
  await writeSettingValue(NOTIFICATIONS_KEY, { notifications: capped });
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
  const rows = await readNotificationRows();
  return rows.find((n) => n.id === notificationId) ?? null;
}

export async function getMatchedNotificationForOrder(
  orderId: string
): Promise<BankPaymentNotificationDTO | null> {
  const rows = await readNotificationRows();
  return (
    rows.find((n) => n.matchedOrderId === orderId && n.status === "MATCHED") ?? null
  );
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
  const rows = await readNotificationRows();
  const existing = rows.find((n) => n.rawContentHash === input.rawContentHash);
  if (existing) {
    return { notification: existing, isDuplicate: true };
  }

  const created: BankPaymentNotificationDTO = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await writeNotificationRows([created, ...rows]);
  return { notification: created, isDuplicate: false };
}

export async function claimNotificationForOrder(params: {
  notificationId: string;
  orderId: string;
  receiverAccountId: string | null;
  referenceFull: string;
  amountBsCents: number;
}): Promise<
  | { ok: true; notification: BankPaymentNotificationDTO }
  | { ok: false; reason: "DUPLICATE_REFERENCE" | "ALREADY_CLAIMED" | "NOT_FOUND" }
> {
  const rows = await readNotificationRows();
  const idx = rows.findIndex((n) => n.id === params.notificationId);
  if (idx === -1) return { ok: false, reason: "NOT_FOUND" };

  const target = rows[idx];
  if (target.status === "MATCHED") {
    if (target.matchedOrderId === params.orderId) {
      return { ok: true, notification: target };
    }
    return { ok: false, reason: "ALREADY_CLAIMED" };
  }
  if (target.status !== "UNMATCHED" && target.status !== "UNPARSED") {
    return { ok: false, reason: "ALREADY_CLAIMED" };
  }

  // Postgres unique lock (`unique (gateway, event_id)` on `webhook_events`) prevents reusing any reference across orders
  const refNorm = normalizeReferenceDigits(params.referenceFull);
  const claimEventId = `${params.receiverAccountId ?? "default"}:${refNorm}:${params.amountBsCents}`;
  const lock = await recordWebhookEventOnce({
    gateway: "pagomovil_ref_claim",
    eventId: claimEventId,
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

  if (lock.isDuplicate) {
    // Allow idempotent re-entry if already claimed by this exact same order
    if (target.matchedOrderId === params.orderId) {
      return { ok: true, notification: target };
    }
    const existingClaim = rows.find(
      (n) =>
        n.matchedOrderId === params.orderId &&
        n.status === "MATCHED" &&
        referencesMatch(n.referenceFull, refNorm)
    );
    if (existingClaim) {
      return { ok: true, notification: existingClaim };
    }
    return { ok: false, reason: "DUPLICATE_REFERENCE" };
  }

  const now = new Date().toISOString();
  const updated: BankPaymentNotificationDTO = {
    ...target,
    status: "MATCHED",
    matchedOrderId: params.orderId,
    matchedAt: now,
  };
  const next = [...rows];
  next[idx] = updated;
  await writeNotificationRows(next);
  return { ok: true, notification: updated };
}

export async function markNotificationStatus(
  notificationId: string,
  status: BankPaymentNotificationDTO["status"],
  matchedOrderId?: string | null
): Promise<void> {
  const rows = await readNotificationRows();
  const now = new Date().toISOString();
  const next = rows.map((n) =>
    n.id === notificationId
      ? {
          ...n,
          status,
          matchedOrderId: matchedOrderId ?? n.matchedOrderId,
          matchedAt: status === "MATCHED" ? now : n.matchedAt,
        }
      : n
  );
  await writeNotificationRows(next);
}

export interface CandidateMatchResult {
  kind:
    | "matched"
    | "ambiguous"
    | "underpaid"
    | "duplicate_used"
    | "none";
  notification: BankPaymentNotificationDTO | null;
  candidates: BankPaymentNotificationDTO[];
  paidBsCents: number;
}

export async function findCandidateNotificationsForOrder(params: {
  orderId: string;
  referenceDigits: string;
  amountDueBsCents: number;
  toleranceBsCents: number;
  senderBankCode?: string | null;
  senderPhone?: string | null;
  windowStartMs: number;
  windowEndMs: number;
}): Promise<CandidateMatchResult> {
  const rows = await readNotificationRows();
  const refInput = normalizeReferenceDigits(params.referenceDigits);

  // 1) Check if this reference was already used to pay another order (or this same order!)
  const alreadyMatched = rows.filter(
    (n) =>
      n.status === "MATCHED" &&
      referencesMatch(n.referenceFull, refInput)
  );
  const matchedOwn = alreadyMatched.find((n) => n.matchedOrderId === params.orderId);
  if (matchedOwn) {
    return {
      kind: "matched",
      notification: matchedOwn,
      candidates: [matchedOwn],
      paidBsCents: matchedOwn.amountBsCents ?? params.amountDueBsCents,
    };
  }

  const matchedOther = alreadyMatched.find(
    (n) =>
      n.matchedOrderId &&
      n.matchedOrderId !== params.orderId &&
      n.amountBsCents !== null &&
      Math.abs(n.amountBsCents - params.amountDueBsCents) <= params.toleranceBsCents
  );
  if (matchedOther) {
    return {
      kind: "duplicate_used",
      notification: matchedOther,
      candidates: [matchedOther],
      paidBsCents: matchedOther.amountBsCents ?? 0,
    };
  }

  // 2) Filter UNMATCHED incoming VES notifications inside order window matching reference
  const unmatchedMatchingRef = rows.filter((n) => {
    if (n.status !== "UNMATCHED") return false;
    if (n.currency !== "VES" || n.amountBsCents === null) return false;
    const postedMs = Date.parse(n.postedAt);
    if (Number.isFinite(postedMs)) {
      if (postedMs < params.windowStartMs || postedMs > params.windowEndMs) {
        return false;
      }
    }
    if (!referencesMatch(n.referenceFull, refInput)) return false;
    if (
      params.senderBankCode &&
      n.senderBankCode &&
      n.senderBankCode !== params.senderBankCode
    ) {
      return false;
    }
    if (
      params.senderPhone &&
      n.senderPhone &&
      n.senderPhone !== params.senderPhone
    ) {
      return false;
    }
    return true;
  });

  if (unmatchedMatchingRef.length === 0) {
    return { kind: "none", notification: null, candidates: [], paidBsCents: 0 };
  }

  // 3) Partition by exact/sufficient amount vs underpaid amount
  const minAcceptedBs = Math.max(0, params.amountDueBsCents - params.toleranceBsCents);
  const sufficient = unmatchedMatchingRef.filter(
    (n) => (n.amountBsCents ?? 0) >= minAcceptedBs
  );

  if (sufficient.length === 1) {
    return {
      kind: "matched",
      notification: sufficient[0],
      candidates: sufficient,
      paidBsCents: sufficient[0].amountBsCents ?? params.amountDueBsCents,
    };
  }

  if (sufficient.length > 1) {
    // Disambiguate if one is an exact full reference match while others are merely suffix collisions
    const exactFullMatches = sufficient.filter(
      (n) => normalizeReferenceDigits(n.referenceFull ?? "") === refInput
    );
    if (exactFullMatches.length === 1) {
      return {
        kind: "matched",
        notification: exactFullMatches[0],
        candidates: exactFullMatches,
        paidBsCents: exactFullMatches[0].amountBsCents ?? params.amountDueBsCents,
      };
    }
    return {
      kind: "ambiguous",
      notification: null,
      candidates: sufficient,
      paidBsCents: 0,
    };
  }

  // Only underpaid notification(s) found matching reference! Never auto-deliver
  const underpaid = unmatchedMatchingRef[0];
  return {
    kind: "underpaid",
    notification: underpaid,
    candidates: unmatchedMatchingRef,
    paidBsCents: underpaid.amountBsCents ?? 0,
  };
}

// ============================================================================
// PER-ORDER PAGO MOVIL REPORT STATE
// ============================================================================

async function readAllOrderReports(): Promise<Record<string, OrderPagoMovilReport>> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return getSandboxState().pagoMovil.orderReports;
  }
  const saved = await readSettingValue<{
    reports?: Record<string, OrderPagoMovilReport>;
  }>(REPORTS_KEY);
  return saved?.reports && typeof saved.reports === "object" ? saved.reports : {};
}

export async function getOrderPagoMovilReport(
  orderId: string
): Promise<OrderPagoMovilReport | null> {
  const all = await readAllOrderReports();
  return all[orderId] ?? null;
}

export async function saveOrderPagoMovilReport(
  orderId: string,
  patch: Partial<OrderPagoMovilReport>
): Promise<OrderPagoMovilReport> {
  const all = await readAllOrderReports();
  const prev = all[orderId] ?? {
    orderId,
    amountDueBsCents: null,
    rateExpiresAt: null,
    reportedReference: null,
    reportedSenderPhone: null,
    reportedSenderBank: null,
    reportedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };

  const nextReport: OrderPagoMovilReport = {
    ...prev,
    ...patch,
    orderId,
  };

  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    getSandboxState().pagoMovil.orderReports[orderId] = nextReport;
    return nextReport;
  }

  // Prune reports older than 30 days to keep store_settings lean
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60_000;
  const pruned: Record<string, OrderPagoMovilReport> = {};
  for (const [k, v] of Object.entries(all)) {
    const ts = v.reportedAt ? Date.parse(v.reportedAt) : Date.now();
    if (k === orderId || !Number.isFinite(ts) || ts >= thirtyDaysAgoMs) {
      pruned[k] = v;
    }
  }
  pruned[orderId] = nextReport;
  await writeSettingValue(REPORTS_KEY, { reports: pruned });
  return nextReport;
}

export async function findOrdersWaitingForBankNotification(params: {
  referenceFull: string;
  amountBsCents: number;
  toleranceBsCents: number;
  senderBankCode?: string | null;
  orders: OrderDTO[];
}): Promise<Array<{ order: OrderDTO; report: OrderPagoMovilReport }>> {
  const allReports = await readAllOrderReports();
  const results: Array<{ order: OrderDTO; report: OrderPagoMovilReport }> = [];

  for (const order of params.orders) {
    if (
      order.paymentGateway !== "pagomovil" &&
      order.paymentGateway !== "pablito"
    ) {
      continue;
    }
    const report = allReports[order.id];
    if (!report?.reportedReference) continue;
    if (!referencesMatch(report.reportedReference, params.referenceFull)) {
      continue;
    }
    if (
      report.reportedSenderBank &&
      params.senderBankCode &&
      report.reportedSenderBank !== params.senderBankCode
    ) {
      continue;
    }
    const expectedBs =
      report.amountDueBsCents ?? order.totalBsCents ?? 0;
    if (expectedBs <= 0) continue;
    if (params.amountBsCents + params.toleranceBsCents < expectedBs) {
      continue;
    }
    results.push({ order, report });
  }

  return results;
}

export async function findOrdersWaitingWithInsufficientAmount(params: {
  referenceFull: string;
  amountBsCents: number;
  toleranceBsCents: number;
  senderBankCode?: string | null;
  orders: OrderDTO[];
}): Promise<
  Array<{ order: OrderDTO; report: OrderPagoMovilReport; expectedBsCents: number }>
> {
  const allReports = await readAllOrderReports();
  const results: Array<{
    order: OrderDTO;
    report: OrderPagoMovilReport;
    expectedBsCents: number;
  }> = [];

  for (const order of params.orders) {
    if (
      order.paymentGateway !== "pagomovil" &&
      order.paymentGateway !== "pablito"
    ) {
      continue;
    }
    const report = allReports[order.id];
    if (!report?.reportedReference) continue;
    if (!referencesMatch(report.reportedReference, params.referenceFull)) {
      continue;
    }
    if (
      report.reportedSenderBank &&
      params.senderBankCode &&
      report.reportedSenderBank !== params.senderBankCode
    ) {
      continue;
    }
    const expectedBsCents =
      report.amountDueBsCents ??
      (order.bsRateCents
        ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
        : order.totalBsCents ?? 0);
    if (expectedBsCents <= 0) continue;
    if (params.amountBsCents + params.toleranceBsCents < expectedBsCents) {
      results.push({ order, report, expectedBsCents });
    }
  }

  return results;
}
