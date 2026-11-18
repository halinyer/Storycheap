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

// Disjoint row-per-entity prefixes eliminate concurrent read-modify-write lost updates in store_settings
const NOTIF_ROW_PREFIX = "pm_notif:";
const REPORT_ROW_PREFIX = "pm_report:";
const HEARTBEAT_ROW_PREFIX = "pm_heartbeat:";

interface StoredNotificationValue extends BankPaymentNotificationDTO {
  _rev?: number;
}

interface StoredOrderReportValue extends OrderPagoMovilReport {
  _rev?: number;
}

interface StoredDeviceHeartbeatValue {
  deviceId: string;
  lastHeartbeatAt: string;
  batteryLevel?: number | null;
  networkType?: string | null;
  appVersion?: string | null;
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

function mergeHeartbeatOntoDevice(
  device: SandboxBotDeviceRow,
  hb: StoredDeviceHeartbeatValue | null | undefined
): SandboxBotDeviceRow {
  if (!hb?.lastHeartbeatAt) return device;
  const devMs = device.lastHeartbeatAt ? Date.parse(device.lastHeartbeatAt) : 0;
  const hbMs = Date.parse(hb.lastHeartbeatAt);
  if (!Number.isFinite(hbMs) || hbMs < devMs) return device;
  return {
    ...device,
    lastHeartbeatAt: hb.lastHeartbeatAt,
    batteryLevel:
      typeof hb.batteryLevel === "number" ? hb.batteryLevel : device.batteryLevel,
    networkType: hb.networkType ?? device.networkType,
    appVersion: hb.appVersion ?? device.appVersion,
  };
}

export async function listBotDevices(): Promise<BotDeviceDTO[]> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return getSandboxState().pagoMovil.devices.map(stripDeviceSecret);
  }
  const [rows, hbRes] = await Promise.all([
    readDeviceRows(),
    ctx.admin
      .from("store_settings")
      .select("value")
      .like("key", `${HEARTBEAT_ROW_PREFIX}%`),
  ]);
  const hbById = new Map<string, StoredDeviceHeartbeatValue>();
  for (const row of hbRes.data ?? []) {
    const val = row.value as StoredDeviceHeartbeatValue | null;
    if (val?.deviceId) hbById.set(val.deviceId, val);
  }
  return rows.map((d) =>
    stripDeviceSecret(mergeHeartbeatOntoDevice(d, hbById.get(d.id)))
  );
}

export async function getBotDeviceWithSecret(
  idOrIdentifier: string
): Promise<{ device: BotDeviceDTO; secret: string } | null> {
  const rows = await readDeviceRows();
  const found = rows.find(
    (d) => d.id === idOrIdentifier || d.deviceIdentifier === idOrIdentifier
  );
  if (!found) return null;
  const ctx = assertStoreMode();
  let merged = found;
  if (ctx.mode === "supabase") {
    const hb = await readSettingValue<StoredDeviceHeartbeatValue>(
      `${HEARTBEAT_ROW_PREFIX}${found.id}`
    );
    merged = mergeHeartbeatOntoDevice(found, hb);
  }
  return {
    device: stripDeviceSecret(merged),
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
  const ctx = assertStoreMode();
  const rows = await readDeviceRows();
  const idx = rows.findIndex(
    (d) => d.id === idOrIdentifier || d.deviceIdentifier === idOrIdentifier
  );
  if (idx === -1) return null;

  const base = rows[idx];
  const now = new Date().toISOString();
  const nextBattery =
    typeof patch.batteryLevel === "number"
      ? Math.min(100, Math.max(0, Math.round(patch.batteryLevel)))
      : base.batteryLevel;

  if (ctx.mode === "sandbox") {
    const liveIdx = getSandboxState().pagoMovil.devices.findIndex(
      (d) => d.id === base.id
    );
    if (liveIdx === -1) return null;
    const live = getSandboxState().pagoMovil.devices[liveIdx];
    const updated: SandboxBotDeviceRow = {
      ...live,
      lastHeartbeatAt: now,
      batteryLevel:
        typeof patch.batteryLevel === "number" ? nextBattery : live.batteryLevel,
      networkType: patch.networkType ?? live.networkType,
      appVersion: patch.appVersion ?? live.appVersion,
      updatedAt: now,
    };
    getSandboxState().pagoMovil.devices[liveIdx] = updated;
    return stripDeviceSecret(updated);
  }

  // Isolate frequent device heartbeats in a disjoint row so sensor phones never overwrite device configs or each other
  const hbKey = `${HEARTBEAT_ROW_PREFIX}${base.id}`;
  const existingHb = await readSettingValue<StoredDeviceHeartbeatValue>(hbKey);
  const hbPayload: StoredDeviceHeartbeatValue = {
    deviceId: base.id,
    lastHeartbeatAt: now,
    batteryLevel:
      typeof patch.batteryLevel === "number"
        ? nextBattery
        : existingHb?.batteryLevel ?? base.batteryLevel,
    networkType:
      patch.networkType ?? existingHb?.networkType ?? base.networkType,
    appVersion: patch.appVersion ?? existingHb?.appVersion ?? base.appVersion,
  };
  await writeSettingValue(hbKey, hbPayload);
  return stripDeviceSecret(mergeHeartbeatOntoDevice(base, hbPayload));
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
  // Legacy rows first, then disjoint per-row entries override with newer state
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

/** All bank notifications claimed by an order (supports multiple partial Pago Móvil payments). */
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

function sumMatchedBsForOrderRows(
  rows: BankPaymentNotificationDTO[],
  orderId: string
): number {
  return rows
    .filter((n) => n.matchedOrderId === orderId && n.status === "MATCHED")
    .reduce((acc, n) => acc + (n.amountBsCents ?? 0), 0);
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
    // Synchronously check & prepend so concurrent Promise.all inserts never overwrite each other
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

  // Atomic INSERT against unique PK `pm_notif:<rawContentHash>`: disjoint across different notifications & deduplicated across identical concurrent webhooks
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

  // Lock 1: unique Postgres lock (`unique (gateway, event_id)`) prevents reusing a bank reference+amount across orders
  const refNorm = normalizeReferenceDigits(params.referenceFull);
  const refEventId = `${params.receiverAccountId ?? "default"}:${refNorm}:${params.amountBsCents}`;
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

  // Lock 2: unique Postgres lock per notification ID prevents two concurrent orders from ever claiming the same push
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
    // Re-read live index after async webhook lock calls so concurrent claims never overwrite other notifications
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

function defaultEmptyOrderReport(orderId: string): OrderPagoMovilReport {
  return {
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
}

async function readAllOrderReports(): Promise<Record<string, OrderPagoMovilReport>> {
  const ctx = assertStoreMode();
  if (ctx.mode === "sandbox") {
    return getSandboxState().pagoMovil.orderReports;
  }
  const [perRowRes, legacy] = await Promise.all([
    ctx.admin
      .from("store_settings")
      .select("key, value, updated_at")
      .like("key", `${REPORT_ROW_PREFIX}%`)
      .order("updated_at", { ascending: false })
      .limit(500),
    readSettingValue<{ reports?: Record<string, OrderPagoMovilReport> }>(
      REPORTS_KEY
    ),
  ]);

  const merged: Record<string, OrderPagoMovilReport> = {
    ...(legacy?.reports && typeof legacy.reports === "object"
      ? legacy.reports
      : {}),
  };
  for (const row of perRowRes.data ?? []) {
    const raw = row.value as StoredOrderReportValue | null;
    if (raw?.orderId) {
      merged[raw.orderId] = stripReportRev(raw);
    }
  }
  return merged;
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

  // Disjoint row `pm_report:<orderId>` eliminates cross-order contention; CAS retries serialize same-order updates safely
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

export async function findOrdersWaitingForBankNotification(params: {
  referenceFull: string;
  amountBsCents: number;
  toleranceBsCents: number;
  senderBankCode?: string | null;
  orders: OrderDTO[];
}): Promise<Array<{ order: OrderDTO; report: OrderPagoMovilReport }>> {
  const allReports = await readAllOrderReports();
  const notificationRows = await readNotificationRows();
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
    const expectedBs = Math.max(
      0,
      (report.amountDueBsCents ?? order.totalBsCents ?? 0) -
        sumMatchedBsForOrderRows(notificationRows, order.id)
    );
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
  Array<{
    order: OrderDTO;
    report: OrderPagoMovilReport;
    /** Full order amount in Bs. */
    expectedBsCents: number;
    /** Bs still missing (full amount minus already-claimed partial payments). */
    remainingBsCents: number;
  }>
> {
  const allReports = await readAllOrderReports();
  const notificationRows = await readNotificationRows();
  const results: Array<{
    order: OrderDTO;
    report: OrderPagoMovilReport;
    expectedBsCents: number;
    remainingBsCents: number;
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
    const remainingBsCents = Math.max(
      0,
      expectedBsCents - sumMatchedBsForOrderRows(notificationRows, order.id)
    );
    if (remainingBsCents <= 0) continue;
    if (params.amountBsCents + params.toleranceBsCents < remainingBsCents) {
      results.push({ order, report, expectedBsCents, remainingBsCents });
    }
  }

  return results;
}
