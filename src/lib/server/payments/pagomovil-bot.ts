import "server-only";
import crypto from "crypto";
import { findBankCodeInText, normalizeVePhone } from "@/lib/catalog-banks";
import type {
  BankPaymentNotificationDTO,
  OrderDTO,
  SessionUser,
} from "@/types";
import { getSiteUrl } from "../env";
import {
  buildNotificationContentHash,
  claimNotificationForOrder,
  findCandidateNotificationsForOrder,
  findOrdersWaitingForBankNotification,
  findOrdersWaitingWithInsufficientAmount,
  getActiveReceiverBankAccount,
  getBankNotificationById,
  getBotDeviceWithSecret,
  getMatchedNotificationForOrder,
  getOrCreatePagoMovilWebhookSecret,
  getOrderPagoMovilReport,
  getPagoMovilBotSettings,
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
    const [order, report, matchedNotif, settings] = await Promise.all([
      getOrderById(orderId),
      getOrderPagoMovilReport(orderId),
      getMatchedNotificationForOrder(orderId),
      getPagoMovilBotSettings(),
    ]);

    if (!order) {
      throw new Error(`Pago Móvil checkout not found: ${checkoutId}`);
    }

    if (matchedNotif && matchedNotif.amountBsCents !== null) {
      const expectedBs =
        report?.amountDueBsCents ??
        (order.bsRateCents
          ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
          : order.totalBsCents ?? 0);

      const mapped = mapMatchedBsToAuthoritativeUsdCents({
        order,
        expectedBsCents: expectedBs,
        paidBsCents: matchedNotif.amountBsCents,
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

  const paidBsCents = params.notification.amountBsCents ?? expectedBs;
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
  return processVerifiedWebhookEvent(verifiedEvent, {
    skipRemoteDoubleCheck: false,
  });
}

export async function ingestBotNotification(args: {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
}): Promise<{
  ok: true;
  duplicate: boolean;
  notification: BankPaymentNotificationDTO;
  autoMatchedOrderId: string | null;
}> {
  const auth = await verifyBotDeviceAuthentication({
    rawBody: args.rawBody,
    headers: args.headers,
  });

  const payload = JSON.parse(args.rawBody) as {
    title?: string;
    content: string;
    app_package?: string;
    source_type?: "APP_PUSH" | "SMS" | "EMAIL" | "MANUAL";
    posted_at?: string;
    event_id?: string;
    battery_level?: number;
    network_type?: string;
    app_version?: string;
  };

  const content = String(payload.content ?? "").trim();
  if (!content) {
    throw new PagoMovilAuthError("El campo 'content' es obligatorio.", 400);
  }

  await updateBotDeviceHeartbeat(auth.deviceId, {
    batteryLevel: payload.battery_level ?? null,
    networkType: payload.network_type ?? null,
    appVersion: payload.app_version ?? null,
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

    for (const u of underpaidWaiting) {
      const msg = `Recibimos Bs ${(inserted.notification.amountBsCents! / 100).toFixed(2)}, pero esta orden requiere Bs ${(u.expectedBsCents / 100).toFixed(2)}. No se liberaron códigos.`;
      await saveOrderPagoMovilReport(u.order.id, {
        lastErrorCode: "AMOUNT_MISMATCH",
        lastErrorMessage: msg,
      });
      await markOrderAttentionFlag(
        u.order.id,
        true,
        `Pago Móvil insuficiente detectado (Ref ${inserted.notification.referenceFull}): recibido Bs ${(inserted.notification.amountBsCents! / 100).toFixed(2)} vs esperado Bs ${(u.expectedBsCents / 100).toFixed(2)}.`
      );
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

export async function verifyOrderPagoMovilClaim(params: {
  orderId: string;
  actorUser: SessionUser | null;
  hasOrderCookie: boolean;
  referenceDigits: string;
  senderBankCode?: string | null;
  senderPhone?: string | null;
}): Promise<{
  ok: boolean;
  code:
    | "COMPLETED"
    | "ALREADY_PAID"
    | "WAITING_BANK_CONFIRMATION"
    | "DUPLICATE_REFERENCE"
    | "AMBIGUOUS_REFERENCE"
    | "AMOUNT_MISMATCH"
    | "RATE_EXPIRED"
    | "ORDER_EXPIRED"
    | "INVALID_INPUT";
  message: string;
  order?: OrderDTO;
  paidBsCents?: number;
  expectedBsCents?: number;
}> {
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

  const [settings, report] = await Promise.all([
    getPagoMovilBotSettings(),
    getOrderPagoMovilReport(order.id),
  ]);

  if (
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

  await saveOrderPagoMovilReport(order.id, {
    reportedReference: cleanRef,
    reportedSenderBank: senderBank,
    reportedSenderPhone: normalizedPhone,
    reportedAt: new Date().toISOString(),
    lastErrorCode: null,
    lastErrorMessage: null,
  });

  const orderCreatedMs = Date.parse(order.createdAt);
  const windowStartMs = Number.isFinite(orderCreatedMs)
    ? orderCreatedMs - 10 * 60_000
    : Date.now() - 60 * 60_000;
  const windowEndMs = Date.now() + 5 * 60_000;

  const match = await findCandidateNotificationsForOrder({
    orderId: order.id,
    referenceDigits: cleanRef,
    amountDueBsCents: expectedBsCents,
    toleranceBsCents: settings.amountToleranceBsCents,
    senderBankCode: senderBank,
    senderPhone: normalizedPhone,
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
      metadata: { reportedRef: cleanRef, existingOrderId: match.notification?.matchedOrderId },
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

  if (match.kind === "underpaid") {
    const msg = `Recibimos Bs ${(match.paidBsCents / 100).toFixed(2)}, pero esta orden requiere Bs ${(expectedBsCents / 100).toFixed(2)}. No se liberaron códigos.`;
    await saveOrderPagoMovilReport(order.id, {
      lastErrorCode: "AMOUNT_MISMATCH",
      lastErrorMessage: msg,
    });
    await markOrderAttentionFlag(
      order.id,
      true,
      `Pago Móvil insuficiente detectado (Ref ${match.notification?.referenceFull ?? cleanRef}): recibido Bs ${(match.paidBsCents / 100).toFixed(2)} vs esperado Bs ${(expectedBsCents / 100).toFixed(2)}.`
    );
    return {
      ok: false,
      code: "AMOUNT_MISMATCH",
      message: msg,
      paidBsCents: match.paidBsCents,
      expectedBsCents,
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
  const order = await getOrderById(params.orderId);
  if (!order) {
    throw new PagoMovilAuthError("Orden no encontrada.", 404);
  }

  const isOwner = Boolean(params.actorUser && order.userId === params.actorUser.id);
  const isAdmin = Boolean(params.actorUser?.role === "admin");
  if (!isOwner && !isAdmin && !params.hasOrderCookie) {
    throw new PagoMovilAuthError("No autorizado para consultar esta orden.", 403);
  }

  const [receiver, report, matchedNotif, settings] = await Promise.all([
    getActiveReceiverBankAccount(),
    getOrderPagoMovilReport(order.id),
    getMatchedNotificationForOrder(order.id),
    getPagoMovilBotSettings(),
  ]);
  const watchdog = await isBotWatchdogHealthy(settings);

  const amountDueBsCents =
    report?.amountDueBsCents ??
    (order.bsRateCents
      ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
      : order.totalBsCents ?? 0);

  const nowMs = Date.now();
  const rateExpired = Boolean(
    report?.rateExpiresAt && nowMs >= Date.parse(report.rateExpiresAt)
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
