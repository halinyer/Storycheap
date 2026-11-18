import "server-only";
import crypto from "crypto";
import { findBankCodeInText, normalizeVePhone } from "@/lib/catalog-banks";
import type {
  BankPaymentNotificationDTO,
  OrderDTO,
  SessionUser,
} from "@/types";
import { getSiteUrl } from "../env";
import { syncBsExchangeRateIfNeeded } from "../exchange-rates";
import {
  buildNotificationContentHash,
  claimNotificationForOrder,
  findCandidateNotificationsForOrder,
  findOrdersWaitingForBankNotification,
  findOrdersWaitingWithInsufficientAmount,
  getActiveReceiverBankAccount,
  getBankNotificationById,
  getBotDeviceWithSecret,
  getMatchedNotificationsForOrder,
  getOrCreatePagoMovilWebhookSecret,
  getOrderPagoMovilReport,
  getPagoMovilBotSettings,
  getReceivedBsCentsForOrder,
  insertBankNotification,
  isBotWatchdogHealthy,
  markNotificationStatus,
  normalizeReferenceDigits,
  saveOrderPagoMovilReport,
  updateBotDeviceHeartbeat,
} from "../pagomovil-store";
import { CheckoutValidationError } from "../pricing";
import {
  appendAuditLog,
  appendCreditLedgerEntry,
  getBsRateCents,
  getOrderById,
  getProviderConfig,
  listOrdersAdmin,
  markOrderAttentionFlag,
  setOrderPaidCentsForManualReview,
  transitionOrderStatus,
  updateOrderBsSnapshot,
} from "../repository";
import { parseBankNotification } from "./parsers";
import type {
  CreateCheckoutInput,
  GatewayCheckoutSession,
  NormalizedPaymentWebhookEvent,
  PaymentGatewayAdapter,
} from "./types";

const MAX_TIMESTAMP_SKEW_SECONDS = 300;

export class PagoMovilAuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export function computeHmacSha256Hex(
  secret: string,
  timestamp: string,
  rawBody: string
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
}

function constantTimeEqualStrings(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

function getHeaderCaseInsensitive(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== lower) continue;
    if (Array.isArray(v)) return v[0]?.trim() ?? null;
    return v?.trim() ?? null;
  }
  return null;
}

export function verifyHmacSignatureEnvelope(args: {
  secret: string;
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
}): void {
  const sigRaw = args.signatureHeader?.trim();
  const tsRaw = args.timestampHeader?.trim();
  if (!sigRaw || !tsRaw) {
    throw new PagoMovilAuthError("Cabeceras de firma HMAC faltantes.", 401);
  }

  const tsSec = Number.parseInt(tsRaw, 10);
  if (!Number.isFinite(tsSec)) {
    throw new PagoMovilAuthError("Timestamp inválido.", 401);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > MAX_TIMESTAMP_SKEW_SECONDS) {
    throw new PagoMovilAuthError("Timestamp expirado (fuera de ventana anti-replay).", 401);
  }

  const cleanSig = sigRaw.replace(/^sha256=/i, "").toLowerCase();
  const expectedHex = computeHmacSha256Hex(args.secret, tsRaw, args.rawBody);
  const sigBuf = Buffer.from(cleanSig, "hex");
  const expBuf = Buffer.from(expectedHex, "hex");

  if (
    sigBuf.length !== expBuf.length ||
    sigBuf.length === 0 ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    throw new PagoMovilAuthError("Firma HMAC-SHA256 inválida.", 401);
  }
}

export async function verifyBotDeviceAuthentication(args: {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
}): Promise<{ deviceId: string; deviceName: string; channelType: string }> {
  const deviceIdHeader = getHeaderCaseInsensitive(args.headers, "x-bot-device-id");
  if (!deviceIdHeader) {
    throw new PagoMovilAuthError("Falta cabecera X-Bot-Device-Id.", 401);
  }

  const found = await getBotDeviceWithSecret(deviceIdHeader);
  if (!found || !found.device.active) {
    throw new PagoMovilAuthError("Dispositivo bot no autorizado o pausado.", 401);
  }

  const sig = getHeaderCaseInsensitive(args.headers, "x-bot-signature");
  const ts = getHeaderCaseInsensitive(args.headers, "x-bot-timestamp");

  if (sig && ts) {
    verifyHmacSignatureEnvelope({
      secret: found.secret,
      rawBody: args.rawBody,
      signatureHeader: sig,
      timestampHeader: ts,
    });
    return {
      deviceId: found.device.id,
      deviceName: found.device.name,
      channelType: found.device.channelType,
    };
  }

  // Optional TLS-only token mode when explicitly enabled for no-code MacroDroid devices
  if (found.device.allowPlainBearer) {
    const bearer =
      getHeaderCaseInsensitive(args.headers, "x-bot-token") ??
      getHeaderCaseInsensitive(args.headers, "authorization")?.replace(/^Bearer\s+/i, "") ??
      null;
    if (bearer && constantTimeEqualStrings(bearer, found.secret)) {
      return {
        deviceId: found.device.id,
        deviceName: found.device.name,
        channelType: found.device.channelType,
      };
    }
  }

  throw new PagoMovilAuthError("Credenciales o firma del dispositivo inválidas.", 401);
}

function mapMatchedBsToAuthoritativeUsdCents(args: {
  order: OrderDTO;
  expectedBsCents: number;
  paidBsCents: number;
  toleranceBsCents: number;
}): {
  status: "COMPLETED" | "PARTIALLY_PAID";
  paidUsdCents: number;
} {
  const { order, expectedBsCents, paidBsCents, toleranceBsCents } = args;
  if (paidBsCents + toleranceBsCents < expectedBsCents) {
    const rate = order.bsRateCents && order.bsRateCents > 0 ? order.bsRateCents : 100;
    const partialUsdCents = Math.max(0, Math.floor((paidBsCents * 100) / rate));
    return { status: "PARTIALLY_PAID", paidUsdCents: partialUsdCents };
  }

  // Within rounding tolerance -> treat as exact full payment
  if (Math.abs(paidBsCents - expectedBsCents) <= toleranceBsCents) {
    return { status: "COMPLETED", paidUsdCents: order.amountDueCents };
  }

  // Genuine overpayment above tolerance -> convert extra Bs surplus into USD store credit
  const rate = order.bsRateCents && order.bsRateCents > 0 ? order.bsRateCents : 100;
  const surplusBs = paidBsCents - expectedBsCents;
  const surplusUsdCents = Math.floor((surplusBs * 100) / rate);
  return {
    status: "COMPLETED",
    paidUsdCents: order.amountDueCents + Math.max(0, surplusUsdCents),
  };
}

export async function assertPagoMovilCheckoutReady(
  bsRateCents: number | null
) {
  const [receiver, settings] = await Promise.all([
    getActiveReceiverBankAccount(),
    getPagoMovilBotSettings(),
  ]);

  if (!receiver) {
    throw new CheckoutValidationError(
      "PAGOMOVIL_NOT_CONFIGURED",
      "No hay una cuenta receptora de Pago Móvil configurada.",
      503
    );
  }

  if (!bsRateCents || bsRateCents <= 0) {
    throw new CheckoutValidationError(
      "BS_RATE_UNAVAILABLE",
      "La tasa Bs/USD no está configurada aún. Usa ZenoBank o configura la tasa en Admin.",
      503
    );
  }

  if (settings.enforceWatchdog) {
    const health = await isBotWatchdogHealthy(settings);
    if (!health.online) {
      throw new CheckoutValidationError(
        "PAGOMOVIL_BOT_OFFLINE",
        "Pago Móvil está temporalmente fuera de línea. Usa ZenoBank mientras se restablece.",
        503
      );
    }
  }

  return { receiver, settings };
}

export class PagoMovilBotAdapter implements PaymentGatewayAdapter {
  readonly id = "pagomovil" as const;

  async createCheckout(input: CreateCheckoutInput): Promise<GatewayCheckoutSession> {
    await syncBsExchangeRateIfNeeded().catch(() => null);
    const bsRateCents = await getBsRateCents();
    const { settings } = await assertPagoMovilCheckoutReady(bsRateCents);
    const effectiveBsRate = bsRateCents!;

    const amountDueBsCents = Math.round((input.amountCents * effectiveBsRate) / 100);
    const now = Date.now();
    const rateExpiresAt = new Date(
      now + settings.rateExpirationMinutes * 60_000
    ).toISOString();
    const expiresAt = new Date(
      now + settings.orderExpirationMinutes * 60_000
    ).toISOString();

    await saveOrderPagoMovilReport(input.orderId, {
      amountDueBsCents,
      rateExpiresAt,
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    const checkoutId = `pm_${input.orderId}`;
    const checkoutUrl = `${getSiteUrl()}/pay/pagomovil/${input.orderId}`;

    return {
      gateway: "pagomovil",
      checkoutId,
      checkoutUrl,
      expiresAt,
      status: "OPEN",
      priceCents: input.amountCents,
      paidCents: 0,
      isSandbox: false,
    };
  }

  async getCheckout(checkoutId: string): Promise<GatewayCheckoutSession> {
    const orderId = checkoutId.startsWith("pm_") ? checkoutId.slice(3) : checkoutId;
    const [order, report, matchedNotifs, settings] = await Promise.all([
      getOrderById(orderId),
      getOrderPagoMovilReport(orderId),
      getMatchedNotificationsForOrder(orderId),
      getPagoMovilBotSettings(),
    ]);

    if (!order) {
      throw new Error(`Pago Móvil checkout not found: ${checkoutId}`);
    }

    const totalMatchedBsCents = matchedNotifs.reduce(
      (acc, n) => acc + (n.amountBsCents ?? 0),
      0
    );
    if (matchedNotifs.length > 0 && totalMatchedBsCents > 0) {
      const expectedBs =
        report?.amountDueBsCents ??
        (order.bsRateCents
          ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
          : order.totalBsCents ?? 0);

      const mapped = mapMatchedBsToAuthoritativeUsdCents({
        order,
        expectedBsCents: expectedBs,
        paidBsCents: totalMatchedBsCents,
        toleranceBsCents: settings.amountToleranceBsCents,
      });

      return {
        gateway: "pagomovil",
        checkoutId,
        checkoutUrl: order.gatewayCheckoutUrl ?? `${getSiteUrl()}/pay/pagomovil/${order.id}`,
        expiresAt: order.expiresAt,
        status: mapped.status,
        priceCents: order.amountDueCents,
        paidCents: mapped.paidUsdCents,
        isSandbox: false,
      };
    }

    const isExpired = Boolean(
      order.status === "EXPIRED" ||
        (order.expiresAt && Date.now() >= Date.parse(order.expiresAt))
    );

    return {
      gateway: "pagomovil",
      checkoutId,
      checkoutUrl: order.gatewayCheckoutUrl ?? `${getSiteUrl()}/pay/pagomovil/${order.id}`,
      expiresAt: order.expiresAt,
      status:
        order.status === "CANCELLED"
          ? "CANCELLED"
          : isExpired
            ? "EXPIRED"
            : order.paidCents >= order.amountDueCents && order.amountDueCents > 0
              ? "COMPLETED"
              : order.paidCents > 0
                ? "PARTIALLY_PAID"
                : "OPEN",
      priceCents: order.amountDueCents,
      paidCents: order.paidCents,
      isSandbox: false,
    };
  }

  async verifyWebhook(args: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<NormalizedPaymentWebhookEvent> {
    const secret = await getOrCreatePagoMovilWebhookSecret();
    verifyHmacSignatureEnvelope({
      secret,
      rawBody: args.rawBody,
      signatureHeader: getHeaderCaseInsensitive(args.headers, "x-storypay-signature"),
      timestampHeader: getHeaderCaseInsensitive(args.headers, "x-storypay-timestamp"),
    });

    const parsed = JSON.parse(args.rawBody) as {
      eventId: string;
      eventType: NormalizedPaymentWebhookEvent["eventType"];
      orderId: string;
      checkoutId: string;
      priceCents: number;
      paidCents: number;
      status: NormalizedPaymentWebhookEvent["status"];
      expiresAt?: string | null;
    };

    if (!parsed.eventId || !parsed.orderId || !parsed.checkoutId) {
      throw new PagoMovilAuthError("Payload webhook Pago Móvil incompleto.", 400);
    }

    return {
      gateway: "pagomovil",
      eventId: parsed.eventId,
      eventType: parsed.eventType ?? "checkout.completed",
      orderId: parsed.orderId,
      checkoutId: parsed.checkoutId,
      priceCents: Number(parsed.priceCents ?? 0),
      paidCents: Number(parsed.paidCents ?? 0),
      status: parsed.status ?? "COMPLETED",
      expiresAt: parsed.expiresAt ?? null,
      rawPayload: parsed as unknown as Record<string, unknown>,
    };
  }
}

function formatBsAmount(bsCents: number): string {
  return (bsCents / 100).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export async function dispatchPagoMovilConfirmedWebhook(params: {
  order: OrderDTO;
  notification: BankPaymentNotificationDTO;
  confirmationSource: "bot_auto" | "owner_manual";
}) {
  const settings = await getPagoMovilBotSettings();
  const report = await getOrderPagoMovilReport(params.order.id);
  const expectedBs =
    report?.amountDueBsCents ??
    (params.order.bsRateCents
      ? Math.round((params.order.amountDueCents * params.order.bsRateCents) / 100)
      : params.order.totalBsCents ?? 0);

  // Sum every claimed bank notification so multiple partial payments accumulate correctly
  const matchedRows = await getMatchedNotificationsForOrder(params.order.id);
  const matchedIds = new Set(matchedRows.map((n) => n.id));
  const matchedTotalBs = matchedRows.reduce(
    (acc, n) => acc + (n.amountBsCents ?? 0),
    0
  );
  const totalBsCents =
    matchedTotalBs +
    (matchedIds.has(params.notification.id)
      ? 0
      : params.notification.amountBsCents ?? 0);
  const paidBsCents = totalBsCents > 0 ? totalBsCents : expectedBs;

  const mapped = mapMatchedBsToAuthoritativeUsdCents({
    order: params.order,
    expectedBsCents: expectedBs,
    paidBsCents,
    toleranceBsCents: settings.amountToleranceBsCents,
  });

  const payloadObj = {
    eventId: `pm_evt_${params.notification.id}_${params.order.id}`,
    eventType:
      mapped.status === "COMPLETED"
        ? ("checkout.completed" as const)
        : ("checkout.partially_paid" as const),
    orderId: params.order.id,
    checkoutId: params.order.gatewayCheckoutId ?? `pm_${params.order.id}`,
    priceCents: params.order.amountDueCents,
    paidCents: mapped.paidUsdCents,
    status: mapped.status,
    expiresAt: params.order.expiresAt,
    paidBsCents,
    expectedBsCents: expectedBs,
    bankReference: params.notification.referenceFull,
    confirmationSource: params.confirmationSource,
    notificationId: params.notification.id,
  };

  // Sign & verify through the exact same Layer-2 HMAC adapter contract
  const rawBody = JSON.stringify(payloadObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = await getOrCreatePagoMovilWebhookSecret();
  const signature = computeHmacSha256Hex(secret, timestamp, rawBody);

  const adapter = new PagoMovilBotAdapter();
  const verifiedEvent = await adapter.verifyWebhook({
    rawBody,
    headers: {
      "x-storypay-timestamp": timestamp,
      "x-storypay-signature": signature,
    },
  });

  const { processVerifiedWebhookEvent } = await import("../fulfillment");
  const result = await processVerifiedWebhookEvent(verifiedEvent, {
    skipRemoteDoubleCheck: false,
  });

  if (mapped.status === "PARTIALLY_PAID") {
    // Underpayment: abono recorded, codes stay locked, operator is alerted with exact Bs amounts
    const remainingBs = Math.max(0, expectedBs - paidBsCents);
    await markOrderAttentionFlag(
      params.order.id,
      true,
      `Pago Móvil PARCIAL (Ref ${params.notification.referenceFull ?? "—"}): recibido Bs ${formatBsAmount(paidBsCents)} de Bs ${formatBsAmount(expectedBs)} · faltan Bs ${formatBsAmount(remainingBs)}. Abono ≈ $${(mapped.paidUsdCents / 100).toFixed(2)} USD registrado.`
    ).catch(() => {});
    await appendAuditLog({
      actorId: null,
      actorRole: "system",
      action: "pagomovil.partial_payment_recorded",
      targetType: "order",
      targetId: params.order.id,
      metadata: {
        notificationId: params.notification.id,
        reference: params.notification.referenceFull,
        receivedBsCents: paidBsCents,
        expectedBsCents: expectedBs,
        remainingBsCents: remainingBs,
        creditedUsdCents: mapped.paidUsdCents,
      },
    }).catch(() => {});
  } else {
    const surplusUsdCents = Math.max(
      0,
      mapped.paidUsdCents - params.order.amountDueCents
    );
    if (surplusUsdCents > 0) {
      const surplusBs = Math.max(0, paidBsCents - expectedBs);
      await markOrderAttentionFlag(
        params.order.id,
        true,
        `Sobrepago Pago Móvil (Ref ${params.notification.referenceFull ?? "—"}): recibido Bs ${formatBsAmount(paidBsCents)} vs Bs ${formatBsAmount(expectedBs)} · excedente Bs ${formatBsAmount(surplusBs)} = +$${(surplusUsdCents / 100).toFixed(2)} USD acreditados al saldo del cliente.`
      ).catch(() => {});
      await appendAuditLog({
        actorId: null,
        actorRole: "system",
        action: "pagomovil.overpayment_credited",
        targetType: "order",
        targetId: params.order.id,
        metadata: {
          notificationId: params.notification.id,
          reference: params.notification.referenceFull,
          receivedBsCents: paidBsCents,
          expectedBsCents: expectedBs,
          surplusBsCents: surplusBs,
          creditedUsdCents: surplusUsdCents,
        },
      }).catch(() => {});
    } else {
      // Fully paid within tolerance: clear stale partial-payment alert
      await markOrderAttentionFlag(params.order.id, false, null).catch(() => {});
    }
  }

  return result;
}

/**
 * Claims a bank notification that is smaller than the amount still due, records it as an
 * abono (partial payment, never releases codes) and tells the customer exactly what is missing.
 */
async function recordPagoMovilPartialPayment(params: {
  order: OrderDTO;
  notification: BankPaymentNotificationDTO;
  expectedBsCents: number;
}): Promise<
  | {
      ok: true;
      notification: BankPaymentNotificationDTO;
      receivedBsCents: number;
      remainingBsCents: number;
      message: string;
    }
  | { ok: false; reason: "DUPLICATE_REFERENCE" | "ALREADY_CLAIMED" | "NOT_FOUND" }
> {
  const claimed = await claimNotificationForOrder({
    notificationId: params.notification.id,
    orderId: params.order.id,
    receiverAccountId: params.notification.receiverAccountId,
    referenceFull:
      params.notification.referenceFull ?? params.notification.referenceLast6 ?? "",
    amountBsCents: params.notification.amountBsCents ?? 0,
  });
  if (!claimed.ok) return claimed;

  await dispatchPagoMovilConfirmedWebhook({
    order: params.order,
    notification: claimed.notification,
    confirmationSource: "bot_auto",
  });

  const receivedBsCents = await getReceivedBsCentsForOrder(params.order.id);
  const remainingBsCents = Math.max(0, params.expectedBsCents - receivedBsCents);
  const message = `Recibimos Bs ${formatBsAmount(claimed.notification.amountBsCents ?? 0)} (abono registrado, total Bs ${formatBsAmount(receivedBsCents)} de Bs ${formatBsAmount(params.expectedBsCents)}). Faltan Bs ${formatBsAmount(remainingBsCents)} para liberar tus códigos: envía la diferencia por Pago Móvil o convierte tu abono en saldo a favor. No se liberaron códigos.`;
  await saveOrderPagoMovilReport(params.order.id, {
    lastErrorCode: "AMOUNT_MISMATCH",
    lastErrorMessage: message,
  });
  return {
    ok: true,
    notification: claimed.notification,
    receivedBsCents,
    remainingBsCents,
    message,
  };
}

export interface ParsedBotPayload {
  title?: string;
  content?: string;
  app_package?: string;
  source_type?: "APP_PUSH" | "SMS" | "EMAIL" | "MANUAL";
  posted_at?: string;
  event_id?: string;
  battery_level?: number | string | null;
  network_type?: string;
  app_version?: string;
}

export function sanitizeBotBatteryLevel(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const rounded = Math.round(raw);
    return rounded >= 0 && rounded <= 100 ? rounded : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || /^[\{\[].*[\}\]]$/.test(trimmed)) return null;
    const match = trimmed.match(/^(\d{1,3})\s*%?$/);
    if (!match) return null;
    const val = Number.parseInt(match[1], 10);
    return val >= 0 && val <= 100 ? val : null;
  }
  return null;
}

export function isUnresolvedMacroPlaceholder(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return /^[\{\[](not_title|notification|not_text_big|not_app_package|battery|sms_number|sms_message)[\}\]]$/.test(
    v
  );
}

/**
 * Escapes raw control characters and unescaped double quotes inside JSON string values
 * so multi-line or quoted notifications from MacroDroid parse without rejecting structural whitespace.
 */
function repairMacroDroidJson(raw: string): string {
  let out = "";
  let inString = false;
  let expectingKey = false;
  let isCurrentStringKey = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (!inString) {
      if (ch === "{" || ch === ",") expectingKey = true;
      else if (ch === ":") expectingKey = false;
      else if (ch === '"') {
        inString = true;
        isCurrentStringKey = expectingKey;
        expectingKey = false;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "\\") {
      const next = raw[i + 1];
      if (next !== undefined && '"\\/bfnrtu'.includes(next)) {
        out += ch + next;
        i += 2;
      } else {
        out += "\\\\";
        i += 1;
      }
      continue;
    }

    if (ch === "\r") {
      if (raw[i + 1] === "\n") i += 1;
      out += "\\n";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      out += "\\n";
      i += 1;
      continue;
    }
    if (ch === "\t") {
      out += "\\t";
      i += 1;
      continue;
    }
    if (ch.charCodeAt(0) < 0x20) {
      out += " ";
      i += 1;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j += 1;
      const afterWs = raw[j];

      let closesString = false;
      if (isCurrentStringKey) {
        closesString = afterWs === ":";
      } else if (afterWs === "}" || afterWs === undefined) {
        closesString = true;
      } else if (afterWs === ",") {
        let k = j + 1;
        while (k < raw.length && /\s/.test(raw[k])) k += 1;
        const tail = raw.slice(k);
        closesString = tail.startsWith("}") || /^"[a-zA-Z0-9_.-]+"\s*:/.test(tail);
      }

      if (closesString) {
        inString = false;
        isCurrentStringKey = false;
        out += '"';
      } else {
        out += '\\"';
      }
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Parses strict JSON, malformed MacroDroid JSON (raw newlines or unescaped quotes in strings),
 * or `application/x-www-form-urlencoded` form payloads.
 */
export function parseBotPayloadRaw(
  rawBody: string,
  contentType?: string | null
): ParsedBotPayload {
  const trimmed = rawBody.trim();
  if (!trimmed) return {};

  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded") || (!trimmed.startsWith("{") && trimmed.includes("="))) {
    const sp = new URLSearchParams(trimmed);
    const out: Record<string, string> = {};
    sp.forEach((value, key) => {
      out[key] = value;
    });
    return out as unknown as ParsedBotPayload;
  }

  try {
    return JSON.parse(trimmed) as ParsedBotPayload;
  } catch {
    return JSON.parse(repairMacroDroidJson(trimmed)) as ParsedBotPayload;
  }
}

export async function ingestBotNotification(args: {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  contentType?: string | null;
}): Promise<{
  ok: true;
  duplicate: boolean;
  notification: BankPaymentNotificationDTO;
  autoMatchedOrderId: string | null;
  warning?: string;
  ignoredPackage?: string | null;
}> {
  const auth = await verifyBotDeviceAuthentication({
    rawBody: args.rawBody,
    headers: args.headers,
  });

  const payload = parseBotPayloadRaw(args.rawBody, args.contentType);

  const content = String(payload.content ?? "").trim();
  if (!content) {
    throw new PagoMovilAuthError("El campo 'content' es obligatorio.", 400);
  }

  await updateBotDeviceHeartbeat(auth.deviceId, {
    batteryLevel: sanitizeBotBatteryLevel(payload.battery_level),
    networkType:
      typeof payload.network_type === "string" ? payload.network_type : null,
    appVersion:
      typeof payload.app_version === "string" ? payload.app_version : null,
  });

  const receiver = await getActiveReceiverBankAccount();
  const sourceType =
    payload.source_type ??
    (auth.channelType === "EMAIL_SCRIPT"
      ? "EMAIL"
      : auth.channelType === "ANDROID_SMS"
        ? "SMS"
        : "APP_PUSH");
  const appPackage = payload.app_package?.trim() || null;
  const postedAt =
    payload.posted_at && Number.isFinite(Date.parse(payload.posted_at))
      ? new Date(payload.posted_at).toISOString()
      : new Date().toISOString();

  if (
    isUnresolvedMacroPlaceholder(content) ||
    isUnresolvedMacroPlaceholder(appPackage)
  ) {
    const hash = buildNotificationContentHash({
      deviceId: auth.deviceId,
      sourceType,
      content,
      postedAt,
      explicitEventId: payload.event_id,
    });
    const ignored = await insertBankNotification({
      deviceId: auth.deviceId,
      receiverAccountId: receiver?.id ?? null,
      sourceType,
      appPackage,
      rawContentHash: hash,
      rawContentPreview: `[MACRODROID_LITERAL pkg=${appPackage ?? "none"}] ${content.slice(0, 140)}`,
      amountBsCents: null,
      currency: "VES",
      referenceFull: null,
      referenceLast6: null,
      referenceLast4: null,
      senderPhone: null,
      senderDni: null,
      senderBankCode: null,
      parserUsed: "unresolved_macro_var",
      postedAt,
      status: "IGNORED",
      matchedOrderId: null,
      matchedAt: null,
    });
    return {
      ok: true,
      duplicate: ignored.isDuplicate,
      notification: ignored.notification,
      autoMatchedOrderId: null,
      warning:
        "MacroDroid envió el nombre de la variable literal sin reemplazar (usa corchetes [not_title], [notification], [not_app_package] desde el botón '...' Magic Text).",
      ignoredPackage: appPackage,
    };
  }

  // Origin package allowlist guard (prevents WhatsApp / spoofed notification injection)
  if (sourceType === "APP_PUSH" && receiver && receiver.allowedPackages.length > 0) {
    const allowedLower = receiver.allowedPackages.map((p) => p.toLowerCase());
    if (!appPackage || !allowedLower.includes(appPackage.toLowerCase())) {
      const hash = buildNotificationContentHash({
        deviceId: auth.deviceId,
        sourceType,
        content,
        postedAt,
        explicitEventId: payload.event_id,
      });
      const ignored = await insertBankNotification({
        deviceId: auth.deviceId,
        receiverAccountId: receiver.id,
        sourceType,
        appPackage,
        rawContentHash: hash,
        rawContentPreview: `[IGNORED package=${appPackage ?? "none"}] ${content.slice(0, 140)}`,
        amountBsCents: null,
        currency: "VES",
        referenceFull: null,
        referenceLast6: null,
        referenceLast4: null,
        senderPhone: null,
        senderDni: null,
        senderBankCode: null,
        parserUsed: "package_guard",
        postedAt,
        status: "IGNORED",
        matchedOrderId: null,
        matchedAt: null,
      });
      return {
        ok: true,
        duplicate: ignored.isDuplicate,
        notification: ignored.notification,
        autoMatchedOrderId: null,
        warning: `Paquete Android '${appPackage ?? "vacío"}' no está autorizado en la cuenta receptora.`,
        ignoredPackage: appPackage,
      };
    }
  }

  const parsed = parseBankNotification({
    title: payload.title ?? null,
    content,
    appPackage,
    sourceType,
    preferredBankCode: receiver?.bankCode ?? "0172",
  });

  const status: BankPaymentNotificationDTO["status"] = !parsed.isIncomingPayment
    ? "IGNORED"
    : !parsed.matched
      ? "UNPARSED"
      : "UNMATCHED";

  const rawContentHash = buildNotificationContentHash({
    deviceId: auth.deviceId,
    sourceType,
    content,
    postedAt,
    explicitEventId: payload.event_id,
  });

  const inserted = await insertBankNotification({
    deviceId: auth.deviceId,
    receiverAccountId: receiver?.id ?? null,
    sourceType,
    appPackage,
    rawContentHash,
    rawContentPreview: [payload.title, content]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 220),
    amountBsCents: parsed.amountBsCents,
    currency: parsed.currency,
    referenceFull: parsed.referenceFull,
    referenceLast6: parsed.referenceLast6,
    referenceLast4: parsed.referenceLast4,
    senderPhone: parsed.senderPhone,
    senderDni: parsed.senderDni,
    senderBankCode: parsed.senderBankCode,
    parserUsed: parsed.parserUsed,
    postedAt,
    status,
    matchedOrderId: null,
    matchedAt: null,
  });

  if (inserted.isDuplicate || inserted.notification.status !== "UNMATCHED") {
    return {
      ok: true,
      duplicate: inserted.isDuplicate,
      notification: inserted.notification,
      autoMatchedOrderId: null,
    };
  }

  // Check Case B: pending order already submitted its reference and is waiting for bank push
  const settings = await getPagoMovilBotSettings();
  const [pendingOrders, expiredRecent] = await Promise.all([
    listOrdersAdmin({ status: "PENDING_PAYMENT" }),
    listOrdersAdmin({ status: "EXPIRED" }),
  ]);

  const matchingPending = await findOrdersWaitingForBankNotification({
    referenceFull: inserted.notification.referenceFull!,
    amountBsCents: inserted.notification.amountBsCents!,
    toleranceBsCents: settings.amountToleranceBsCents,
    senderBankCode: inserted.notification.senderBankCode,
    orders: pendingOrders,
  });

  if (matchingPending.length === 1) {
    const target = matchingPending[0];
    const claimed = await claimNotificationForOrder({
      notificationId: inserted.notification.id,
      orderId: target.order.id,
      receiverAccountId: inserted.notification.receiverAccountId,
      referenceFull: inserted.notification.referenceFull!,
      amountBsCents: inserted.notification.amountBsCents!,
    });

    if (claimed.ok) {
      await dispatchPagoMovilConfirmedWebhook({
        order: target.order,
        notification: claimed.notification,
        confirmationSource: "bot_auto",
      });
      return {
        ok: true,
        duplicate: false,
        notification: claimed.notification,
        autoMatchedOrderId: target.order.id,
      };
    }
    if (claimed.reason === "DUPLICATE_REFERENCE") {
      await markNotificationStatus(inserted.notification.id, "DUPLICATE");
    }
  } else if (matchingPending.length > 1) {
    for (const m of matchingPending) {
      await markOrderAttentionFlag(
        m.order.id,
        true,
        `Colisión de Pago Móvil en espera (Ref ${inserted.notification.referenceFull}). Revisar manualmente.`
      );
    }
  } else {
    const underpaidWaiting = await findOrdersWaitingWithInsufficientAmount({
      referenceFull: inserted.notification.referenceFull!,
      amountBsCents: inserted.notification.amountBsCents!,
      toleranceBsCents: settings.amountToleranceBsCents,
      senderBankCode: inserted.notification.senderBankCode,
      orders: pendingOrders,
    });

    if (underpaidWaiting.length === 1) {
      // Exactly one order is waiting for this reference: record it as an abono and alert both sides
      const u = underpaidWaiting[0];
      const partial = await recordPagoMovilPartialPayment({
        order: u.order,
        notification: inserted.notification,
        expectedBsCents: u.expectedBsCents,
      });
      if (!partial.ok && partial.reason === "DUPLICATE_REFERENCE") {
        await markNotificationStatus(inserted.notification.id, "DUPLICATE");
      }
    } else {
      for (const u of underpaidWaiting) {
        const msg = `Recibimos Bs ${(inserted.notification.amountBsCents! / 100).toFixed(2)}, pero esta orden requiere Bs ${(u.remainingBsCents / 100).toFixed(2)}. No se liberaron códigos.`;
        await saveOrderPagoMovilReport(u.order.id, {
          lastErrorCode: "AMOUNT_MISMATCH",
          lastErrorMessage: msg,
        });
        await markOrderAttentionFlag(
          u.order.id,
          true,
          `Pago Móvil insuficiente detectado (Ref ${inserted.notification.referenceFull}): recibido Bs ${(inserted.notification.amountBsCents! / 100).toFixed(2)} vs esperado Bs ${(u.remainingBsCents / 100).toFixed(2)}.`
        );
      }
    }

    if (underpaidWaiting.length === 0) {
      // Late notification arriving after order expired -> alert admin so money is never lost
      const dayAgoMs = Date.now() - 24 * 60 * 60_000;
      const recentExpired = expiredRecent.filter(
        (o) => Date.parse(o.createdAt) >= dayAgoMs
      );
      const matchingExpired = await findOrdersWaitingForBankNotification({
        referenceFull: inserted.notification.referenceFull!,
        amountBsCents: inserted.notification.amountBsCents!,
        toleranceBsCents: settings.amountToleranceBsCents,
        senderBankCode: inserted.notification.senderBankCode,
        orders: recentExpired,
      });
      for (const m of matchingExpired) {
        await markOrderAttentionFlag(
          m.order.id,
          true,
          `Pago Móvil tardío recibido tras expiración (Ref ${inserted.notification.referenceFull}, Bs ${(inserted.notification.amountBsCents! / 100).toFixed(2)}). Aprobar manual o acreditar saldo.`
        );
      }
    }
  }

  return {
    ok: true,
    duplicate: false,
    notification: inserted.notification,
    autoMatchedOrderId: null,
  };
}

type PagoMovilClaimResolutionCode =
  | "COMPLETED"
  | "ALREADY_PAID"
  | "WAITING_BANK_CONFIRMATION"
  | "DUPLICATE_REFERENCE"
  | "AMBIGUOUS_REFERENCE"
  | "AMOUNT_MISMATCH"
  | "RATE_EXPIRED"
  | "ORDER_EXPIRED"
  | "INVALID_INPUT";

interface PagoMovilClaimResolution {
  ok: boolean;
  code: PagoMovilClaimResolutionCode;
  message: string;
  order?: OrderDTO;
  paidBsCents?: number;
  expectedBsCents?: number;
  receivedBsCents?: number;
  remainingBsCents?: number;
}

/**
 * Shared matching & atomic claiming path used by both `verifyOrderPagoMovilClaim`
 * and opportunistic status-poll reconciliation (eliminates Case A vs Case B TOCTOU races).
 */
async function resolveSubmittedPagoMovilReference(params: {
  order: OrderDTO;
  cleanRef: string;
  senderBank: string | null;
  normalizedPhone: string | null;
  expectedBsCents: number;
  remainingBsCents: number;
  toleranceBsCents: number;
  actorUser: SessionUser | null;
}): Promise<PagoMovilClaimResolution> {
  const { order, cleanRef, expectedBsCents, remainingBsCents } = params;
  const orderCreatedMs = Date.parse(order.createdAt);
  const windowStartMs = Number.isFinite(orderCreatedMs)
    ? orderCreatedMs - 10 * 60_000
    : Date.now() - 60 * 60_000;
  const windowEndMs = Date.now() + 5 * 60_000;

  const match = await findCandidateNotificationsForOrder({
    orderId: order.id,
    referenceDigits: cleanRef,
    amountDueBsCents: remainingBsCents,
    toleranceBsCents: params.toleranceBsCents,
    senderBankCode: params.senderBank,
    senderPhone: params.normalizedPhone,
    windowStartMs,
    windowEndMs,
  });

  if (match.kind === "duplicate_used") {
    const msg = "Esta referencia bancaria ya fue utilizada en otra orden.";
    await saveOrderPagoMovilReport(order.id, {
      lastErrorCode: "DUPLICATE_REFERENCE",
      lastErrorMessage: msg,
    });
    await appendAuditLog({
      actorId: params.actorUser?.id ?? null,
      actorRole: params.actorUser?.role ?? "customer",
      action: "pagomovil.duplicate_reference_attempt",
      targetType: "order",
      targetId: order.id,
      metadata: {
        reportedRef: cleanRef,
        existingOrderId: match.notification?.matchedOrderId,
      },
    }).catch(() => {});
    return { ok: false, code: "DUPLICATE_REFERENCE", message: msg };
  }

  if (match.kind === "ambiguous") {
    const msg =
      "Detectamos más de un pago reciente con terminación similar. Ingresa el número de referencia completo (todos los dígitos) y el banco emisor.";
    await saveOrderPagoMovilReport(order.id, {
      lastErrorCode: "AMBIGUOUS_REFERENCE",
      lastErrorMessage: msg,
    });
    return { ok: false, code: "AMBIGUOUS_REFERENCE", message: msg };
  }

  if (match.kind === "underpaid" && match.notification) {
    const partial = await recordPagoMovilPartialPayment({
      order,
      notification: match.notification,
      expectedBsCents,
    });

    if (!partial.ok) {
      const msg =
        partial.reason === "DUPLICATE_REFERENCE"
          ? "Esta referencia bancaria ya fue utilizada en otra orden."
          : "Esta referencia bancaria ya fue reclamada por otra operación.";
      await saveOrderPagoMovilReport(order.id, {
        lastErrorCode: "DUPLICATE_REFERENCE",
        lastErrorMessage: msg,
      });
      return { ok: false, code: "DUPLICATE_REFERENCE", message: msg };
    }

    return {
      ok: false,
      code: "AMOUNT_MISMATCH",
      message: partial.message,
      order: (await getOrderById(order.id)) ?? order,
      paidBsCents: match.paidBsCents,
      expectedBsCents,
      receivedBsCents: partial.receivedBsCents,
      remainingBsCents: partial.remainingBsCents,
    };
  }

  if (match.kind === "matched" && match.notification) {
    const claimed = await claimNotificationForOrder({
      notificationId: match.notification.id,
      orderId: order.id,
      receiverAccountId: match.notification.receiverAccountId,
      referenceFull: match.notification.referenceFull ?? cleanRef,
      amountBsCents: match.notification.amountBsCents ?? expectedBsCents,
    });

    if (!claimed.ok) {
      const msg = "Esta referencia bancaria ya fue reclamada por otra operación.";
      await saveOrderPagoMovilReport(order.id, {
        lastErrorCode: "DUPLICATE_REFERENCE",
        lastErrorMessage: msg,
      });
      return { ok: false, code: "DUPLICATE_REFERENCE", message: msg };
    }

    await dispatchPagoMovilConfirmedWebhook({
      order,
      notification: claimed.notification,
      confirmationSource: "bot_auto",
    });

    const refreshed = (await getOrderById(order.id)) ?? order;
    const stillPending =
      refreshed.status === "PENDING_PAYMENT" || refreshed.status === "CREATED";
    if (stillPending) {
      const receivedNow = await getReceivedBsCentsForOrder(order.id);
      const remainingNow = Math.max(0, expectedBsCents - receivedNow);
      return {
        ok: false,
        code: "AMOUNT_MISMATCH",
        message: `Ya registramos tu abono (Bs ${formatBsAmount(receivedNow)} de Bs ${formatBsAmount(expectedBsCents)}). Faltan Bs ${formatBsAmount(remainingNow)} para liberar tus códigos.`,
        order: refreshed,
        expectedBsCents,
        receivedBsCents: receivedNow,
        remainingBsCents: remainingNow,
      };
    }

    return {
      ok: true,
      code: "COMPLETED",
      message: "¡Pago Móvil verificado! Liberando tus códigos...",
      order: refreshed,
      paidBsCents: match.paidBsCents,
      expectedBsCents,
    };
  }

  return {
    ok: true,
    code: "WAITING_BANK_CONFIRMATION",
    message:
      "Referencia registrada. Esperando confirmación bancaria automática (tarda unos segundos)...",
    order,
    expectedBsCents,
  };
}

/**
 * Re-checks a waiting Pago Móvil order against newly arrived bank notifications.
 * Guarantees zero lost matches if customer verification and bank ingest raced in parallel.
 */
export async function reconcileWaitingPagoMovilOrder(
  orderId: string,
  actorUser: SessionUser | null = null
): Promise<{ reconciled: boolean; code?: PagoMovilClaimResolutionCode }> {
  const [order, report, receivedBsCents, settings] = await Promise.all([
    getOrderById(orderId),
    getOrderPagoMovilReport(orderId),
    getReceivedBsCentsForOrder(orderId),
    getPagoMovilBotSettings(),
  ]);

  if (!order) return { reconciled: false };
  if (order.paymentGateway !== "pagomovil" && order.paymentGateway !== "pablito") {
    return { reconciled: false };
  }
  if (order.status !== "PENDING_PAYMENT" && order.status !== "CREATED") {
    return { reconciled: false };
  }
  if (!report?.reportedReference || report.lastErrorCode) {
    return { reconciled: false };
  }

  const nowMs = Date.now();
  if (order.expiresAt && nowMs >= Date.parse(order.expiresAt)) {
    return { reconciled: false };
  }
  if (
    receivedBsCents <= 0 &&
    report.rateExpiresAt &&
    nowMs >= Date.parse(report.rateExpiresAt)
  ) {
    return { reconciled: false };
  }

  const expectedBsCents =
    report.amountDueBsCents ??
    (order.bsRateCents
      ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
      : order.totalBsCents ?? 0);
  const remainingBsCents = Math.max(0, expectedBsCents - receivedBsCents);
  if (expectedBsCents <= 0 || remainingBsCents <= 0) {
    return { reconciled: false };
  }

  const resolution = await resolveSubmittedPagoMovilReference({
    order,
    cleanRef: report.reportedReference,
    senderBank: report.reportedSenderBank ?? null,
    normalizedPhone: report.reportedSenderPhone ?? null,
    expectedBsCents,
    remainingBsCents,
    toleranceBsCents: settings.amountToleranceBsCents,
    actorUser,
  });

  return {
    reconciled: resolution.code !== "WAITING_BANK_CONFIRMATION",
    code: resolution.code,
  };
}

export async function verifyOrderPagoMovilClaim(params: {
  orderId: string;
  actorUser: SessionUser | null;
  hasOrderCookie: boolean;
  referenceDigits: string;
  senderBankCode?: string | null;
  senderPhone?: string | null;
}): Promise<PagoMovilClaimResolution> {
  const order = await getOrderById(params.orderId);
  if (!order) {
    return { ok: false, code: "INVALID_INPUT", message: "Orden no encontrada." };
  }

  const isOwner = Boolean(params.actorUser && order.userId === params.actorUser.id);
  const isAdmin = Boolean(params.actorUser?.role === "admin");
  if (!isOwner && !isAdmin && !params.hasOrderCookie) {
    throw new PagoMovilAuthError("No autorizado para verificar esta orden.", 403);
  }

  if (
    order.status === "PAID" ||
    order.status === "FULFILLING" ||
    order.status === "DELIVERED"
  ) {
    return {
      ok: true,
      code: "ALREADY_PAID",
      message: "Tu pago ya fue confirmado.",
      order,
    };
  }

  if (order.status === "CANCELLED") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Esta orden fue cancelada. Genera una nueva orden desde el checkout.",
      order,
    };
  }

  if (
    order.status === "EXPIRED" ||
    (order.expiresAt && Date.now() >= Date.parse(order.expiresAt))
  ) {
    return {
      ok: false,
      code: "ORDER_EXPIRED",
      message: "Esta orden ya expiró. Genera una nueva orden desde tu carrito.",
      order,
    };
  }

  const [settings, report, alreadyReceivedBsCents] = await Promise.all([
    getPagoMovilBotSettings(),
    getOrderPagoMovilReport(order.id),
    getReceivedBsCentsForOrder(order.id),
  ]);

  // Once an abono is registered the rate stays frozen so the remaining Bs never drifts
  if (
    alreadyReceivedBsCents <= 0 &&
    report?.rateExpiresAt &&
    Date.now() >= Date.parse(report.rateExpiresAt)
  ) {
    return {
      ok: false,
      code: "RATE_EXPIRED",
      message: "La ventana de tasa congelada venció. Actualiza la tasa en Bs antes de verificar.",
      order,
    };
  }

  const cleanRef = normalizeReferenceDigits(params.referenceDigits);
  if (cleanRef.length < settings.minReferenceDigits) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: `Ingresa al menos ${settings.minReferenceDigits} dígitos de tu referencia bancaria.`,
    };
  }

  const normalizedPhone = params.senderPhone?.trim()
    ? normalizeVePhone(params.senderPhone)
    : null;
  if (settings.requireSenderPhone && !normalizedPhone) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Ingresa un número de teléfono válido (ej. 04121234567).",
    };
  }

  const senderBank = params.senderBankCode?.trim()
    ? findBankCodeInText(params.senderBankCode) ?? params.senderBankCode.trim()
    : null;

  const expectedBsCents =
    report?.amountDueBsCents ??
    (order.bsRateCents
      ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
      : order.totalBsCents ?? 0);

  if (expectedBsCents <= 0) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "La orden no tiene monto válido en Bs.",
    };
  }

  const remainingBsCents = Math.max(0, expectedBsCents - alreadyReceivedBsCents);
  if (remainingBsCents <= 0) {
    return {
      ok: true,
      code: "ALREADY_PAID",
      message: "Ya recibimos el monto completo de esta orden.",
      order,
    };
  }

  await saveOrderPagoMovilReport(order.id, {
    reportedReference: cleanRef,
    reportedSenderBank: senderBank,
    reportedSenderPhone: normalizedPhone,
    reportedAt: new Date().toISOString(),
    lastErrorCode: null,
    lastErrorMessage: null,
  });

  return resolveSubmittedPagoMovilReference({
    order,
    cleanRef,
    senderBank,
    normalizedPhone,
    expectedBsCents,
    remainingBsCents,
    toleranceBsCents: settings.amountToleranceBsCents,
    actorUser: params.actorUser,
  });
}

export async function refreshPagoMovilOrderRate(params: {
  orderId: string;
  actorUser: SessionUser | null;
  hasOrderCookie: boolean;
}) {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Orden no encontrada.");

  const isOwner = Boolean(params.actorUser && order.userId === params.actorUser.id);
  const isAdmin = Boolean(params.actorUser?.role === "admin");
  if (!isOwner && !isAdmin && !params.hasOrderCookie) {
    throw new PagoMovilAuthError("No autorizado.", 403);
  }

  if (order.status !== "PENDING_PAYMENT" && order.status !== "CREATED") {
    throw new Error("Solo se puede actualizar la tasa de órdenes pendientes.");
  }

  if ((await getReceivedBsCentsForOrder(order.id)) > 0) {
    throw new Error(
      "Ya registraste un abono: la tasa queda congelada para completar la diferencia en Bs."
    );
  }

  await syncBsExchangeRateIfNeeded().catch(() => null);
  const [bsRateCents, settings] = await Promise.all([
    getBsRateCents(),
    getPagoMovilBotSettings(),
  ]);
  if (!bsRateCents || bsRateCents <= 0) {
    throw new Error("No hay una tasa Bs/USD configurada en este momento.");
  }

  const totalBsCents = Math.round((order.subtotalCents * bsRateCents) / 100);
  const amountDueBsCents = Math.round((order.amountDueCents * bsRateCents) / 100);
  const rateExpiresAt = new Date(
    Date.now() + settings.rateExpirationMinutes * 60_000
  ).toISOString();

  await updateOrderBsSnapshot(order.id, { bsRateCents, totalBsCents });
  await saveOrderPagoMovilReport(order.id, {
    amountDueBsCents,
    rateExpiresAt,
    lastErrorCode: null,
    lastErrorMessage: null,
  });

  return { bsRateCents, totalBsCents, amountDueBsCents, rateExpiresAt };
}

export interface PagoMovilOrderStatusDTO {
  orderId: string;
  orderNumber: string;
  status: OrderDTO["status"];
  amountDueCents: number;
  bsRateCents: number | null;
  amountDueBsCents: number;
  rateExpiresAt: string | null;
  rateExpired: boolean;
  expiresAt: string | null;
  orderExpired: boolean;
  reportedReference: string | null;
  reportedSenderBank: string | null;
  reportedSenderPhone: string | null;
  reportedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  waitingBankConfirmation: boolean;
  matchedReference: string | null;
  paidBsCents: number | null;
  /** Total Bs received across all claimed bank notifications (abonos included). */
  receivedBsCents: number;
  /** Bs still missing to release the order (0 when fully paid). */
  remainingBsCents: number;
  /** Bs received above the amount due. */
  surplusBsCents: number;
  receiver: {
    bankCode: string;
    bankName: string;
    accountType: "natural" | "juridical";
    phone: string;
    dni: string;
    holderName: string;
  } | null;
  settings: {
    minReferenceDigits: number;
    requireSenderPhone: boolean;
    rateExpirationMinutes: number;
    orderExpirationMinutes: number;
  };
  watchdog: {
    online: boolean;
    activeDevices: number;
    lastHeartbeatAt: string | null;
  };
}

export async function getPagoMovilOrderPublicStatus(params: {
  orderId: string;
  actorUser: SessionUser | null;
  hasOrderCookie: boolean;
}): Promise<PagoMovilOrderStatusDTO> {
  let order = await getOrderById(params.orderId);
  if (!order) {
    throw new PagoMovilAuthError("Orden no encontrada.", 404);
  }

  const isOwner = Boolean(params.actorUser && order.userId === params.actorUser.id);
  const isAdmin = Boolean(params.actorUser?.role === "admin");
  if (!isOwner && !isAdmin && !params.hasOrderCookie) {
    throw new PagoMovilAuthError("No autorizado para consultar esta orden.", 403);
  }

  const rec = await reconcileWaitingPagoMovilOrder(
    order.id,
    params.actorUser
  ).catch(() => ({ reconciled: false }));
  if (rec.reconciled) {
    order = (await getOrderById(order.id)) ?? order;
  }

  const [receiver, report, matchedNotifs, settings] = await Promise.all([
    getActiveReceiverBankAccount(),
    getOrderPagoMovilReport(order.id),
    getMatchedNotificationsForOrder(order.id),
    getPagoMovilBotSettings(),
  ]);
  const matchedNotif = matchedNotifs[0] ?? null;
  const receivedBsCents = matchedNotifs.reduce(
    (acc, n) => acc + (n.amountBsCents ?? 0),
    0
  );
  const watchdog = await isBotWatchdogHealthy(settings);

  const amountDueBsCents =
    report?.amountDueBsCents ??
    (order.bsRateCents
      ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
      : order.totalBsCents ?? 0);
  const remainingBsCents = Math.max(0, amountDueBsCents - receivedBsCents);
  const surplusBsCents = Math.max(0, receivedBsCents - amountDueBsCents);

  const nowMs = Date.now();
  const rateExpired = Boolean(
    receivedBsCents <= 0 &&
      report?.rateExpiresAt &&
      nowMs >= Date.parse(report.rateExpiresAt)
  );
  const orderExpired = Boolean(
    order.status === "EXPIRED" ||
      (order.expiresAt && nowMs >= Date.parse(order.expiresAt))
  );
  const waitingBankConfirmation = Boolean(
    order.status === "PENDING_PAYMENT" &&
      !orderExpired &&
      report?.reportedReference &&
      !report?.lastErrorCode
  );

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    amountDueCents: order.amountDueCents,
    bsRateCents: order.bsRateCents ?? null,
    amountDueBsCents,
    rateExpiresAt: report?.rateExpiresAt ?? null,
    rateExpired,
    expiresAt: order.expiresAt,
    orderExpired,
    reportedReference: report?.reportedReference ?? null,
    reportedSenderBank: report?.reportedSenderBank ?? null,
    reportedSenderPhone: report?.reportedSenderPhone ?? null,
    reportedAt: report?.reportedAt ?? null,
    lastErrorCode: report?.lastErrorCode ?? null,
    lastErrorMessage: report?.lastErrorMessage ?? null,
    waitingBankConfirmation,
    matchedReference: matchedNotif?.referenceFull ?? null,
    paidBsCents: matchedNotif?.amountBsCents ?? null,
    receivedBsCents,
    remainingBsCents,
    surplusBsCents,
    receiver: receiver
      ? {
          bankCode: receiver.bankCode,
          bankName: receiver.bankName,
          accountType: receiver.accountType,
          phone: receiver.phone,
          dni: receiver.dni,
          holderName: receiver.holderName,
        }
      : null,
    settings: {
      minReferenceDigits: settings.minReferenceDigits,
      requireSenderPhone: settings.requireSenderPhone,
      rateExpirationMinutes: settings.rateExpirationMinutes,
      orderExpirationMinutes: settings.orderExpirationMinutes,
    },
    watchdog: {
      online: watchdog.online,
      activeDevices: watchdog.activeDevicesCount,
      lastHeartbeatAt: watchdog.latestHeartbeatAt,
    },
  };
}

export async function getPagoMovilAvailabilitySnapshot() {
  await syncBsExchangeRateIfNeeded().catch(() => null);
  const [providerCfg, receiver, bsRateCents, settings] = await Promise.all([
    getProviderConfig("pagomovil"),
    getActiveReceiverBankAccount(),
    getBsRateCents(),
    getPagoMovilBotSettings(),
  ]);
  const watchdog = await isBotWatchdogHealthy(settings);
  const enabled = Boolean(providerCfg?.enabled);
  const configured = Boolean(receiver && bsRateCents && bsRateCents > 0);
  const available =
    enabled && configured && (!settings.enforceWatchdog || watchdog.online);

  return {
    enabled,
    configured,
    available,
    bsRateCents,
    watchdogOnline: watchdog.online,
    watchdogRequired: settings.enforceWatchdog,
    activeDevices: watchdog.activeDevicesCount,
    lastHeartbeatAt: watchdog.latestHeartbeatAt,
    receiverBankName: receiver?.bankName ?? null,
    receiverAccountType: receiver?.accountType ?? null,
  };
}

export async function adminManualConfirmPagoMovil(params: {
  orderId: string;
  adminUser: SessionUser;
  referenceDigits: string;
  paidBsCents?: number | null;
  notificationId?: string | null;
  note?: string;
}) {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Orden no encontrada.");
  if (
    order.status !== "PENDING_PAYMENT" &&
    order.status !== "CREATED" &&
    order.status !== "EXPIRED" &&
    order.status !== "MANUAL_REVIEW"
  ) {
    throw new Error(`La orden ya se encuentra en estado ${order.status}.`);
  }

  const [receiver, report, settings] = await Promise.all([
    getActiveReceiverBankAccount(),
    getOrderPagoMovilReport(order.id),
    getPagoMovilBotSettings(),
  ]);
  const expectedBsCents =
    report?.amountDueBsCents ??
    (order.bsRateCents
      ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
      : order.totalBsCents ?? 0);

  let targetNotif: BankPaymentNotificationDTO | null = null;
  if (params.notificationId) {
    targetNotif = await getBankNotificationById(params.notificationId);
    if (!targetNotif) throw new Error("Notificación bancaria no encontrada.");
  } else {
    const cleanRef = normalizeReferenceDigits(params.referenceDigits);
    if (cleanRef.length < 4) {
      throw new Error("Ingresa al menos 4 dígitos de referencia para aprobar manual.");
    }
    const effectiveBs =
      typeof params.paidBsCents === "number" && params.paidBsCents > 0
        ? params.paidBsCents
        : expectedBsCents;
    if (effectiveBs <= 0) {
      throw new Error("El monto en Bs debe ser mayor que cero.");
    }

    const nowIso = new Date().toISOString();
    const inserted = await insertBankNotification({
      deviceId: null,
      receiverAccountId: receiver?.id ?? null,
      sourceType: "MANUAL",
      appPackage: "admin_manual",
      rawContentHash: buildNotificationContentHash({
        deviceId: "admin_manual",
        sourceType: "MANUAL",
        content: `order=${order.id}:ref=${cleanRef}:bs=${effectiveBs}`,
        postedAt: nowIso,
        explicitEventId: `manual_${order.id}_${cleanRef}_${effectiveBs}`,
      }),
      rawContentPreview: `Aprobación manual Admin (${params.note || "owner_manual"}) Ref: ${cleanRef}`,
      amountBsCents: effectiveBs,
      currency: "VES",
      referenceFull: cleanRef,
      referenceLast6: cleanRef.slice(-6),
      referenceLast4: cleanRef.slice(-4),
      senderPhone: report?.reportedSenderPhone ?? null,
      senderDni: null,
      senderBankCode: report?.reportedSenderBank ?? null,
      parserUsed: "owner_manual",
      postedAt: nowIso,
      status: "UNMATCHED",
      matchedOrderId: null,
      matchedAt: null,
    });
    targetNotif = inserted.notification;
  }

  const finalRef =
    targetNotif.referenceFull ??
    normalizeReferenceDigits(params.referenceDigits || order.orderNumber);
  const finalBs =
    targetNotif.amountBsCents ??
    (typeof params.paidBsCents === "number" && params.paidBsCents > 0
      ? params.paidBsCents
      : expectedBsCents);

  const mapped = mapMatchedBsToAuthoritativeUsdCents({
    order,
    expectedBsCents,
    paidBsCents: finalBs,
    toleranceBsCents: settings.amountToleranceBsCents,
  });

  if (
    (order.status === "EXPIRED" || order.status === "MANUAL_REVIEW") &&
    mapped.status !== "COMPLETED"
  ) {
    throw new Error(
      `El monto confirmado (Bs ${(finalBs / 100).toFixed(2)}) no cubre el total de la orden (Bs ${(expectedBsCents / 100).toFixed(2)}).`
    );
  }

  const claimed = await claimNotificationForOrder({
    notificationId: targetNotif.id,
    orderId: order.id,
    receiverAccountId: targetNotif.receiverAccountId ?? receiver?.id ?? null,
    referenceFull: finalRef,
    amountBsCents: finalBs,
  });

  if (!claimed.ok) {
    throw new Error(
      claimed.reason === "DUPLICATE_REFERENCE"
        ? "Esa referencia bancaria ya fue acreditada a otra orden."
        : "No se pudo reclamar esa notificación bancaria."
    );
  }

  await appendAuditLog({
    actorId: params.adminUser.id,
    actorRole: params.adminUser.role,
    action: "pagomovil.owner_manual_confirm",
    targetType: "order",
    targetId: order.id,
    metadata: {
      notificationId: claimed.notification.id,
      reference: finalRef,
      paidBsCents: finalBs,
      note: params.note ?? null,
    },
  });

  if (order.status === "PENDING_PAYMENT" || order.status === "CREATED") {
    const outcome = await dispatchPagoMovilConfirmedWebhook({
      order,
      notification: claimed.notification,
      confirmationSource: "owner_manual",
    });
    return { outcome, notification: claimed.notification };
  }

  // Recover EXPIRED or MANUAL_REVIEW order directly into fulfillment without mutating terminal state rules
  if (order.status === "EXPIRED") {
    const moved = await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["EXPIRED"],
      nextStatus: "MANUAL_REVIEW",
      paidCents: mapped.paidUsdCents,
      needsAttention: false,
      attentionReason: null,
    });
    if (!moved) {
      throw new Error("No se pudo recuperar la orden expirada a revisión manual.");
    }
  } else {
    await setOrderPaidCentsForManualReview(order.id, mapped.paidUsdCents);
  }

  const surplusCents = mapped.paidUsdCents - order.amountDueCents;
  if (surplusCents > 0 && order.userId) {
    await appendCreditLedgerEntry({
      userId: order.userId,
      deltaCents: surplusCents,
      reason: "admin_adjust",
      note: `Excedente enviado en tu Pago Móvil (#${order.orderNumber}, Ref ${finalRef})`,
      createdBy: params.adminUser.id,
    });
  }

  const { fulfillOrder } = await import("../fulfillment");
  await fulfillOrder(order.id);
  const refreshed = await getOrderById(order.id);
  return {
    outcome: {
      ok: true,
      recoveredStatus: refreshed?.status ?? "MANUAL_REVIEW",
    },
    notification: claimed.notification,
  };
}
