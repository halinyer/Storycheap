import "server-only";
import crypto from "crypto";
import { findBankCodeInText } from "@/lib/catalog-banks";
import type {
  BankPaymentNotificationDTO,
  OrderDTO,
  SessionUser,
} from "@/types";
import {
  getBdvApiBaseUrl,
  getSiteUrl,
  isBdvConciliacionConfigured,
  isDemoSandboxEnabled,
} from "../env";
import { syncBsExchangeRateIfNeeded } from "../exchange-rates";
import {
  buildNotificationContentHash,
  claimNotificationForOrder,
  findClaimedBdvLockOwner,
  getActiveReceiverBankAccount,
  getBankNotificationById,
  getEffectiveCustomerBsRateCents,
  getMatchedNotificationsForOrder,
  getOrCreatePagoMovilWebhookSecret,
  getOrderPagoMovilReport,
  getPagoMovilSettings,
  getReceivedBsCentsForOrder,
  insertBankNotification,
  normalizeReferenceDigits,
  saveOrderPagoMovilReport,
} from "../pagomovil-store";
import { CheckoutValidationError } from "../pricing";
import {
  appendAuditLog,
  getBsRateCents,
  getOrderById,
  getProviderConfig,
  getUserCreditBalanceCents,
  markOrderAttentionFlag,
  updateOrderBsSnapshot,
} from "../repository";
import {
  BdvGatewayError,
  formatBdvImporte,
  getVenezuelaDateYmd,
  isValidYmdDate,
  normalizeBdvBankCode,
  normalizeBdvCedula,
  normalizeBdvPhone,
  normalizeBdvReference,
  verifyBdvMovement,
} from "./bdv-api";
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
    throw new PagoMovilAuthError(
      "Timestamp expirado (fuera de ventana anti-replay).",
      401
    );
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

function formatBsAmount(bsCents: number): string {
  return (bsCents / 100).toFixed(2);
}

function buildBdvReferenceDedupKey(args: {
  fechaPago: string;
  reference: string;
  receiverPhone: string;
}): string {
  return `bdv:${args.fechaPago}:${normalizeBdvReference(args.reference)}:${args.receiverPhone}`;
}

export function mapMatchedBsToAuthoritativeUsdCents(args: {
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
    const rate =
      order.bsRateCents && order.bsRateCents > 0 ? order.bsRateCents : 100;
    const partialUsdCents = Math.max(0, Math.floor((paidBsCents * 100) / rate));
    return { status: "PARTIALLY_PAID", paidUsdCents: partialUsdCents };
  }

  // Within rounding tolerance -> treat as exact full payment
  if (Math.abs(paidBsCents - expectedBsCents) <= toleranceBsCents) {
    return { status: "COMPLETED", paidUsdCents: order.amountDueCents };
  }

  // Genuine overpayment above tolerance -> convert extra Bs surplus into USD store credit
  const rate =
    order.bsRateCents && order.bsRateCents > 0 ? order.bsRateCents : 100;
  const surplusBs = paidBsCents - expectedBsCents;
  const surplusUsdCents = Math.floor((surplusBs * 100) / rate);
  return {
    status: "COMPLETED",
    paidUsdCents: order.amountDueCents + Math.max(0, surplusUsdCents),
  };
}

export async function assertPagoMovilCheckoutReady(bsRateCents: number | null) {
  const [receiver, settings] = await Promise.all([
    getActiveReceiverBankAccount(),
    getPagoMovilSettings(),
  ]);

  if (!receiver) {
    throw new CheckoutValidationError(
      "PAGOMOVIL_NOT_CONFIGURED",
      "No hay una cuenta receptora de Pago Móvil (BDV) configurada.",
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

  if (!isBdvConciliacionConfigured() && !isDemoSandboxEnabled()) {
    throw new CheckoutValidationError(
      "PAGOMOVIL_NOT_CONFIGURED",
      "La API Key del Banco de Venezuela (BDV_API_KEY) no está configurada en el servidor.",
      503
    );
  }

  return { receiver, settings };
}

export class PagoMovilBdvAdapter implements PaymentGatewayAdapter {
  readonly id = "pagomovil" as const;

  async createCheckout(
    input: CreateCheckoutInput
  ): Promise<GatewayCheckoutSession> {
    await syncBsExchangeRateIfNeeded().catch(() => null);
    const baseBsRateCents = await getBsRateCents();
    const bsRateCents = await getEffectiveCustomerBsRateCents(baseBsRateCents);
    const { settings } = await assertPagoMovilCheckoutReady(bsRateCents);
    const effectiveBsRate = bsRateCents!;

    const amountDueBsCents = Math.round(
      (input.amountCents * effectiveBsRate) / 100
    );
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
    const orderId = checkoutId.startsWith("pm_")
      ? checkoutId.slice(3)
      : checkoutId;
    const [order, report, matchedNotifs, settings] = await Promise.all([
      getOrderById(orderId),
      getOrderPagoMovilReport(orderId),
      getMatchedNotificationsForOrder(orderId),
      getPagoMovilSettings(),
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
        checkoutUrl:
          order.gatewayCheckoutUrl ??
          `${getSiteUrl()}/pay/pagomovil/${order.id}`,
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
      checkoutUrl:
        order.gatewayCheckoutUrl ??
        `${getSiteUrl()}/pay/pagomovil/${order.id}`,
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
    const signature = getHeaderCaseInsensitive(
      args.headers,
      "x-storypay-signature"
    );
    const timestamp = getHeaderCaseInsensitive(
      args.headers,
      "x-storypay-timestamp"
    );

    verifyHmacSignatureEnvelope({
      secret,
      rawBody: args.rawBody,
      signatureHeader: signature,
      timestampHeader: timestamp,
    });

    const parsed = JSON.parse(args.rawBody) as {
      eventId?: string;
      eventType?: NormalizedPaymentWebhookEvent["eventType"];
      orderId?: string;
      checkoutId?: string;
      status?: NormalizedPaymentWebhookEvent["status"];
      priceCents?: number;
      paidCents?: number;
      paidBsCents?: number;
      bankReference?: string;
      confirmationSource?: string;
    };

    if (!parsed.eventId || !parsed.orderId || !parsed.checkoutId) {
      throw new PagoMovilAuthError("Payload de webhook Pago Móvil incompleto.", 400);
    }

    const eventType: NormalizedPaymentWebhookEvent["eventType"] =
      parsed.eventType === "checkout.partially_paid" ||
      parsed.eventType === "checkout.expired"
        ? parsed.eventType
        : "checkout.completed";

    return {
      gateway: "pagomovil",
      eventId: String(parsed.eventId),
      eventType,
      checkoutId: String(parsed.checkoutId),
      orderId: String(parsed.orderId),
      status: parsed.status ?? "COMPLETED",
      priceCents: Number(parsed.priceCents ?? 0),
      paidCents: Number(parsed.paidCents ?? 0),
      rawPayload: parsed as Record<string, unknown>,
    };
  }
}

async function dispatchPagoMovilConfirmedWebhook(params: {
  order: OrderDTO;
  notification: BankPaymentNotificationDTO;
  confirmationSource: "bdv_api" | "admin_manual";
}) {
  const [report, settings, allMatched] = await Promise.all([
    getOrderPagoMovilReport(params.order.id),
    getPagoMovilSettings(),
    getMatchedNotificationsForOrder(params.order.id),
  ]);

  const expectedBs =
    report?.amountDueBsCents ??
    (params.order.bsRateCents
      ? Math.round((params.order.amountDueCents * params.order.bsRateCents) / 100)
      : params.order.totalBsCents ?? 0);

  const accumulatedBsCents = allMatched.reduce(
    (acc, n) => acc + (n.amountBsCents ?? 0),
    0
  );
  const includesCurrent = allMatched.some((n) => n.id === params.notification.id);
  const paidBsCents = includesCurrent
    ? accumulatedBsCents
    : accumulatedBsCents + (params.notification.amountBsCents ?? expectedBs);

  const mapped = mapMatchedBsToAuthoritativeUsdCents({
    order: params.order,
    expectedBsCents: expectedBs,
    paidBsCents,
    toleranceBsCents: settings.amountToleranceBsCents,
  });

  const payloadObj = {
    eventId: `pm_${params.confirmationSource}_${params.notification.id}`,
    eventType:
      mapped.status === "COMPLETED"
        ? "checkout.completed"
        : "checkout.partially_paid",
    orderId: params.order.id,
    checkoutId: params.order.gatewayCheckoutId ?? `pm_${params.order.id}`,
    status: mapped.status,
    priceCents: params.order.amountDueCents,
    paidCents: mapped.paidUsdCents,
    paidBsCents,
    expectedBsCents: expectedBs,
    bankReference: params.notification.referenceFull,
    confirmationSource: params.confirmationSource,
    notificationId: params.notification.id,
  };

  const rawBody = JSON.stringify(payloadObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = await getOrCreatePagoMovilWebhookSecret();
  const signature = computeHmacSha256Hex(secret, timestamp, rawBody);

  const adapter = new PagoMovilBdvAdapter();
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
    const remainingBs = Math.max(0, expectedBs - paidBsCents);
    await markOrderAttentionFlag(
      params.order.id,
      true,
      `Pago Móvil BDV PARCIAL (Ref ${params.notification.referenceFull ?? "—"}): recibido Bs ${formatBsAmount(paidBsCents)} de Bs ${formatBsAmount(expectedBs)} · faltan Bs ${formatBsAmount(remainingBs)}. Abono ≈ $${(mapped.paidUsdCents / 100).toFixed(2)} USD registrado.`
    ).catch(() => {});
    await appendAuditLog({
      actorId: null,
      actorRole: "system",
      action: "pagomovil.partial_payment_recorded",
      targetType: "order",
      targetId: params.order.id,
      metadata: {
        source: params.confirmationSource,
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
        `Sobrepago Pago Móvil BDV (Ref ${params.notification.referenceFull ?? "—"}): recibido Bs ${formatBsAmount(paidBsCents)} vs Bs ${formatBsAmount(expectedBs)} · excedente Bs ${formatBsAmount(surplusBs)} = +$${(surplusUsdCents / 100).toFixed(2)} USD acreditados al saldo del cliente.`
      ).catch(() => {});
      await appendAuditLog({
        actorId: null,
        actorRole: "system",
        action: "pagomovil.overpayment_credited",
        targetType: "order",
        targetId: params.order.id,
        metadata: {
          source: params.confirmationSource,
          notificationId: params.notification.id,
          reference: params.notification.referenceFull,
          receivedBsCents: paidBsCents,
          expectedBsCents: expectedBs,
          surplusBsCents: surplusBs,
          creditedUsdCents: surplusUsdCents,
        },
      }).catch(() => {});
    } else {
      await markOrderAttentionFlag(params.order.id, false, null).catch(() => {});
    }
  }

  return {
    result,
    mappedStatus: mapped.status,
    paidUsdCents: mapped.paidUsdCents,
    totalReceivedBsCents: paidBsCents,
    expectedBsCents: expectedBs,
  };
}

export type PagoMovilClaimResolutionCode =
  | "COMPLETED"
  | "ALREADY_PAID"
  | "DUPLICATE_REFERENCE"
  | "AMOUNT_MISMATCH"
  | "NOT_FOUND_IN_BDV"
  | "BDV_API_ERROR"
  | "RATE_EXPIRED"
  | "ORDER_EXPIRED"
  | "INVALID_INPUT";

export interface PagoMovilClaimResolution {
  ok: boolean;
  code: PagoMovilClaimResolutionCode;
  message: string;
  order?: OrderDTO;
  paidBsCents?: number;
  expectedBsCents?: number;
  receivedBsCents?: number;
  remainingBsCents?: number;
  surplusBsCents?: number;
  surplusUsdCents?: number;
}

/**
 * Direct server-to-server Pago Móvil verification via Banco de Venezuela's
 * official API Conciliación (`POST /getMovement`).
 *
 * - Exact payment -> verifies with BDV, locks reference, delivers order immediately.
 * - Overpayment -> uses BDV's authoritative `data.amount`, credits excess USD to
 *   `credit_ledger`, and delivers order immediately.
 * - Underpayment -> registers verified Bs abono, keeps codes locked, and lets the
 *   customer either transfer the remaining Bs difference or convert to store credit.
 */
export async function verifyOrderPagoMovilClaim(params: {
  orderId: string;
  actorUser: SessionUser | null;
  hasOrderCookie: boolean;
  referenceDigits: string;
  senderBankCode: string;
  senderPhone: string;
  senderDni: string;
  /** Optional customer-declared Bs amount (defaults to exact remaining Bs of the order). */
  amountBsCents?: number | null;
  /** Optional payment date YYYY-MM-DD (defaults to today in America/Caracas UTC-4). */
  paymentDate?: string | null;
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

  const [receiver, settings, report, alreadyReceivedBsCents] = await Promise.all([
    getActiveReceiverBankAccount(),
    getPagoMovilSettings(),
    getOrderPagoMovilReport(order.id),
    getReceivedBsCentsForOrder(order.id),
  ]);

  if (!receiver) {
    return {
      ok: false,
      code: "BDV_API_ERROR",
      message: "No hay cuenta receptora del Banco de Venezuela configurada.",
    };
  }

  const receiverPhone = normalizeBdvPhone(receiver.phone);
  if (!receiverPhone) {
    return {
      ok: false,
      code: "BDV_API_ERROR",
      message: "El teléfono destino de la cuenta BDV configurada en Admin es inválido.",
    };
  }

  // Once an abono is registered the rate stays frozen so the remaining Bs never drifts
  if (
    alreadyReceivedBsCents <= 0 &&
    report?.rateExpiresAt &&
    Date.now() >= Date.parse(report.rateExpiresAt)
  ) {
    return {
      ok: false,
      code: "RATE_EXPIRED",
      message:
        "La ventana de tasa congelada venció. Actualiza la tasa en Bs antes de verificar.",
      order,
    };
  }

  const cleanRef = normalizeBdvReference(params.referenceDigits);
  if (cleanRef.length < settings.minReferenceDigits) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: `Ingresa al menos ${settings.minReferenceDigits} dígitos de tu referencia bancaria.`,
    };
  }

  const senderBank =
    normalizeBdvBankCode(params.senderBankCode) ??
    findBankCodeInText(params.senderBankCode);
  if (!senderBank) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Selecciona el banco de origen desde donde enviaste el Pago Móvil.",
    };
  }

  const normalizedPhone = normalizeBdvPhone(params.senderPhone);
  if (!normalizedPhone) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message:
        "Ingresa el teléfono del pagador en formato venezolano válido (ej. 04121234567).",
    };
  }

  const normalizedCedula = normalizeBdvCedula(params.senderDni);
  if (!normalizedCedula) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message:
        "Ingresa la cédula del pagador válida (ej. V27037606 o E12345678).",
    };
  }

  const expectedBsCents =
    report?.amountDueBsCents ??
    (order.bsRateCents
      ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
      : order.totalBsCents ?? 0);

  if (expectedBsCents <= 0) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "La orden no tiene un monto válido en Bs.",
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

  const queryAmountBsCents =
    typeof params.amountBsCents === "number" &&
    Number.isFinite(params.amountBsCents) &&
    params.amountBsCents > 0
      ? Math.round(params.amountBsCents)
      : remainingBsCents;

  const todayVe = getVenezuelaDateYmd();
  const orderCreatedVe = getVenezuelaDateYmd(order.createdAt);
  const explicitDate = isValidYmdDate(params.paymentDate)
    ? params.paymentDate.trim()
    : null;
  const primaryDateVe = explicitDate ?? todayVe;

  // Save latest submission metadata before calling BDV
  await saveOrderPagoMovilReport(order.id, {
    reportedReference: cleanRef,
    reportedSenderBank: senderBank,
    reportedSenderPhone: normalizedPhone,
    reportedSenderDni: normalizedCedula,
    reportedAmountBsCents: queryAmountBsCents,
    reportedPaymentDate: primaryDateVe,
    reportedAt: new Date().toISOString(),
    lastErrorCode: null,
    lastErrorMessage: null,
  });

  // Fast anti-replay guard BEFORE hitting BDV API
  const primaryDedupKey = buildBdvReferenceDedupKey({
    fechaPago: primaryDateVe,
    reference: cleanRef,
    receiverPhone,
  });
  const existingOwner = await findClaimedBdvLockOwner(primaryDedupKey);
  if (existingOwner) {
    if (existingOwner.orderId && existingOwner.orderId !== order.id) {
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
          existingOrderId: existingOwner.orderId,
        },
      }).catch(() => {});
      return { ok: false, code: "DUPLICATE_REFERENCE", message: msg };
    }

    const msg =
      "Esta referencia ya fue abonada en esta orden. Si falta una diferencia, envía una nueva transferencia e ingresa la nueva referencia.";
    await saveOrderPagoMovilReport(order.id, {
      lastErrorCode: "DUPLICATE_REFERENCE",
      lastErrorMessage: msg,
    });
    return {
      ok: false,
      code: "DUPLICATE_REFERENCE",
      message: msg,
      receivedBsCents: alreadyReceivedBsCents,
      remainingBsCents,
    };
  }

  // Call Banco de Venezuela official API Conciliación (`POST /getMovement`)
  let usedDateVe = primaryDateVe;
  let bdvResult;
  try {
    bdvResult = await verifyBdvMovement({
      cedulaPagador: normalizedCedula,
      telefonoPagador: normalizedPhone,
      telefonoDestino: receiverPhone,
      referencia: cleanRef,
      fechaPago: primaryDateVe,
      importeBsCents: queryAmountBsCents,
      bancoOrigen: senderBank,
    });

    // Midnight crossover resilience (Venezuela UTC-4):
    // If order was created yesterday VE and customer verifies just after midnight, retry once with order creation date
    if (
      !bdvResult.verified &&
      bdvResult.notFound &&
      !explicitDate &&
      orderCreatedVe !== primaryDateVe
    ) {
      const fallbackDedup = buildBdvReferenceDedupKey({
        fechaPago: orderCreatedVe,
        reference: cleanRef,
        receiverPhone,
      });
      const fallbackOwner = await findClaimedBdvLockOwner(fallbackDedup);
      if (!fallbackOwner) {
        const retryRes = await verifyBdvMovement({
          cedulaPagador: normalizedCedula,
          telefonoPagador: normalizedPhone,
          telefonoDestino: receiverPhone,
          referencia: cleanRef,
          fechaPago: orderCreatedVe,
          importeBsCents: queryAmountBsCents,
          bancoOrigen: senderBank,
        });
        if (retryRes.verified) {
          bdvResult = retryRes;
          usedDateVe = orderCreatedVe;
        }
      }
    }
  } catch (err) {
    const errMsg =
      err instanceof BdvGatewayError
        ? err.message
        : "Error temporal consultando al Banco de Venezuela. Intenta de nuevo en unos segundos.";
    await saveOrderPagoMovilReport(order.id, {
      lastErrorCode: "BDV_API_ERROR",
      lastErrorMessage: errMsg,
    });
    return { ok: false, code: "BDV_API_ERROR", message: errMsg };
  }

  if (bdvResult.authError) {
    const msg =
      "El canal de verificación automática del Banco de Venezuela requiere revisión de credenciales. Contacta a soporte o usa ZenoBank.";
    await saveOrderPagoMovilReport(order.id, {
      lastErrorCode: "BDV_API_ERROR",
      lastErrorMessage: msg,
    });
    await appendAuditLog({
      actorId: params.actorUser?.id ?? null,
      actorRole: "system",
      action: "pagomovil.bdv_auth_error",
      targetType: "order",
      targetId: order.id,
      metadata: {
        httpStatus: bdvResult.httpStatus,
        code: bdvResult.code,
        message: bdvResult.message,
      },
    }).catch(() => {});
    return { ok: false, code: "BDV_API_ERROR", message: msg };
  }

  if (!bdvResult.verified || !bdvResult.amountBsCents || bdvResult.amountBsCents <= 0) {
    const queryFormatted = formatBdvImporte(queryAmountBsCents);
    const msg = `Banco de Venezuela no encontró una transferencia por Bs. ${queryFormatted} con esos datos. Verifica tu cédula (${normalizedCedula}), teléfono (${normalizedPhone}), banco y referencia. Si transferiste un monto distinto (de más o de menos), escribe el monto exacto que salió de tu banco en "Monto transferido (Bs)" y vuelve a verificar.`;
    await saveOrderPagoMovilReport(order.id, {
      lastErrorCode: "NOT_FOUND_IN_BDV",
      lastErrorMessage: msg,
    });
    return {
      ok: false,
      code: "NOT_FOUND_IN_BDV",
      message: msg,
      expectedBsCents,
      receivedBsCents: alreadyReceivedBsCents,
      remainingBsCents,
    };
  }

  // Authoritative amount returned by Banco de Venezuela Core Bancario
  const verifiedBsCents = bdvResult.amountBsCents;
  const finalDedupKey = buildBdvReferenceDedupKey({
    fechaPago: usedDateVe,
    reference: cleanRef,
    receiverPhone,
  });

  const contentHash = buildNotificationContentHash({
    deviceId: "bdv_api",
    sourceType: "BDV_API",
    content: `${finalDedupKey}:${verifiedBsCents}:${normalizedCedula}:${normalizedPhone}:${senderBank}`,
    postedAt: usedDateVe,
    explicitEventId: finalDedupKey,
  });

  const inserted = await insertBankNotification({
    deviceId: null,
    receiverAccountId: receiver.id,
    sourceType: "BDV_API",
    appPackage: null,
    rawContentHash: contentHash,
    rawContentPreview: `BDV API Conciliación · Ref ${cleanRef} · Bs ${formatBsAmount(verifiedBsCents)} · ${normalizedCedula} · ${normalizedPhone} · Banco ${senderBank} · ${usedDateVe}`,
    amountBsCents: verifiedBsCents,
    currency: "VES",
    referenceFull: cleanRef,
    referenceLast6: cleanRef.slice(-6),
    referenceLast4: cleanRef.slice(-4),
    senderPhone: normalizedPhone,
    senderDni: normalizedCedula,
    senderBankCode: senderBank,
    parserUsed: "bdv_conciliacion_api",
    postedAt: new Date().toISOString(),
    status: "UNMATCHED",
    matchedOrderId: null,
    matchedAt: null,
  });

  const claimed = await claimNotificationForOrder({
    notificationId: inserted.notification.id,
    orderId: order.id,
    receiverAccountId: receiver.id,
    referenceFull: cleanRef,
    amountBsCents: verifiedBsCents,
    dedupKey: finalDedupKey,
  });

  if (!claimed.ok) {
    const msg = "Esta referencia bancaria ya fue reclamada por otra operación.";
    await saveOrderPagoMovilReport(order.id, {
      lastErrorCode: "DUPLICATE_REFERENCE",
      lastErrorMessage: msg,
    });
    return { ok: false, code: "DUPLICATE_REFERENCE", message: msg };
  }

  const settled = await dispatchPagoMovilConfirmedWebhook({
    order,
    notification: claimed.notification,
    confirmationSource: "bdv_api",
  });

  const refreshed = (await getOrderById(order.id)) ?? order;
  const totalReceivedBsCents = settled.totalReceivedBsCents;
  const remainingAfterBsCents = Math.max(0, expectedBsCents - totalReceivedBsCents);
  const surplusBsCents = Math.max(0, totalReceivedBsCents - expectedBsCents);
  const surplusUsdCents = Math.max(0, settled.paidUsdCents - order.amountDueCents);

  if (
    settled.mappedStatus === "PARTIALLY_PAID" ||
    refreshed.status === "PENDING_PAYMENT" ||
    refreshed.status === "CREATED"
  ) {
    const msg = `Banco de Venezuela verificó tu abono de Bs ${formatBsAmount(verifiedBsCents)} (total acumulado: Bs ${formatBsAmount(totalReceivedBsCents)} de Bs ${formatBsAmount(expectedBsCents)}). Faltan Bs ${formatBsAmount(remainingAfterBsCents)} para liberar tu pedido: envía la diferencia por Pago Móvil o convierte tu abono en saldo a favor ahora.`;
    await saveOrderPagoMovilReport(order.id, {
      lastErrorCode: "AMOUNT_MISMATCH",
      lastErrorMessage: msg,
    });
    return {
      ok: false,
      code: "AMOUNT_MISMATCH",
      message: msg,
      order: refreshed,
      paidBsCents: verifiedBsCents,
      expectedBsCents,
      receivedBsCents: totalReceivedBsCents,
      remainingBsCents: remainingAfterBsCents,
    };
  }

  await saveOrderPagoMovilReport(order.id, {
    lastErrorCode: null,
    lastErrorMessage: null,
  });

  const successMsg =
    surplusUsdCents > 0
      ? `¡Pago verificado por Banco de Venezuela (Bs ${formatBsAmount(totalReceivedBsCents)})! Acreditamos el excedente de Bs ${formatBsAmount(surplusBsCents)} (+$${(surplusUsdCents / 100).toFixed(2)} USD) a tu saldo a favor y estamos liberando tu pedido...`
      : "¡Pago Móvil verificado al instante por Banco de Venezuela! Liberando tu pedido...";

  return {
    ok: true,
    code: "COMPLETED",
    message: successMsg,
    order: refreshed,
    paidBsCents: verifiedBsCents,
    expectedBsCents,
    receivedBsCents: totalReceivedBsCents,
    remainingBsCents: 0,
    surplusBsCents,
    surplusUsdCents,
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

  if ((await getReceivedBsCentsForOrder(order.id)) > 0) {
    throw new Error(
      "Ya registraste un abono: la tasa queda congelada para completar la diferencia en Bs."
    );
  }

  await syncBsExchangeRateIfNeeded().catch(() => null);
  const [baseBsRateCents, settings] = await Promise.all([
    getBsRateCents(),
    getPagoMovilSettings(),
  ]);
  const bsRateCents = await getEffectiveCustomerBsRateCents(baseBsRateCents);
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
  paidCents: number;
  bsRateCents: number | null;
  amountDueBsCents: number;
  rateExpiresAt: string | null;
  rateExpired: boolean;
  expiresAt: string | null;
  orderExpired: boolean;
  reportedReference: string | null;
  reportedSenderBank: string | null;
  reportedSenderPhone: string | null;
  reportedSenderDni: string | null;
  reportedAmountBsCents: number | null;
  reportedPaymentDate: string | null;
  reportedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  matchedReference: string | null;
  paidBsCents: number | null;
  receivedBsCents: number;
  remainingBsCents: number;
  surplusBsCents: number;
  userCreditBalanceCents: number;
  todayDateVe: string;
  orderCreatedDateVe: string;
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
    rateExpirationMinutes: number;
    orderExpirationMinutes: number;
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

  const [receiver, report, matchedNotifs, settings, userCreditBalanceCents] =
    await Promise.all([
      getActiveReceiverBankAccount(),
      getOrderPagoMovilReport(order.id),
      getMatchedNotificationsForOrder(order.id),
      getPagoMovilSettings(),
      order.userId
        ? getUserCreditBalanceCents(order.userId).catch(() => 0)
        : Promise.resolve(0),
    ]);

  const matchedNotif = matchedNotifs[0] ?? null;
  const receivedBsCents = matchedNotifs.reduce(
    (acc, n) => acc + (n.amountBsCents ?? 0),
    0
  );

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

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    amountDueCents: order.amountDueCents,
    paidCents: order.paidCents,
    bsRateCents: order.bsRateCents ?? null,
    amountDueBsCents,
    rateExpiresAt: report?.rateExpiresAt ?? null,
    rateExpired,
    expiresAt: order.expiresAt,
    orderExpired,
    reportedReference: report?.reportedReference ?? null,
    reportedSenderBank: report?.reportedSenderBank ?? null,
    reportedSenderPhone: report?.reportedSenderPhone ?? null,
    reportedSenderDni: report?.reportedSenderDni ?? null,
    reportedAmountBsCents: report?.reportedAmountBsCents ?? null,
    reportedPaymentDate: report?.reportedPaymentDate ?? null,
    reportedAt: report?.reportedAt ?? null,
    lastErrorCode: report?.lastErrorCode ?? null,
    lastErrorMessage: report?.lastErrorMessage ?? null,
    matchedReference: matchedNotif?.referenceFull ?? null,
    paidBsCents: matchedNotif?.amountBsCents ?? null,
    receivedBsCents,
    remainingBsCents,
    surplusBsCents,
    userCreditBalanceCents,
    todayDateVe: getVenezuelaDateYmd(),
    orderCreatedDateVe: getVenezuelaDateYmd(order.createdAt),
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
      rateExpirationMinutes: settings.rateExpirationMinutes,
      orderExpirationMinutes: settings.orderExpirationMinutes,
    },
  };
}

export async function getPagoMovilAvailabilitySnapshot() {
  await syncBsExchangeRateIfNeeded().catch(() => null);
  const [providerCfg, receiver, baseBsRateCents] = await Promise.all([
    getProviderConfig("pagomovil"),
    getActiveReceiverBankAccount(),
    getBsRateCents(),
  ]);
  const bsRateCents = await getEffectiveCustomerBsRateCents(baseBsRateCents);
  const enabled = Boolean(providerCfg?.enabled);
  const bdvApiConfigured = isBdvConciliacionConfigured() || isDemoSandboxEnabled();
  const configured = Boolean(
    receiver && bsRateCents && bsRateCents > 0 && bdvApiConfigured
  );
  const available = enabled && configured;

  return {
    enabled,
    configured,
    bdvApiConfigured,
    available,
    bsRateCents,
    receiverBankName: receiver?.bankName ?? null,
    receiverAccountType: receiver?.accountType ?? null,
  };
}

/**
 * Operator backup manual confirmation (e.g., if BDV API has temporary bank maintenance).
 */
export async function adminManualConfirmPagoMovil(params: {
  orderId: string;
  adminUser: SessionUser;
  referenceDigits: string;
  paidBsCents?: number | null;
  notificationId?: string | null;
  note?: string;
}): Promise<{ order: OrderDTO; notification: BankPaymentNotificationDTO }> {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Orden no encontrada.");

  const report = await getOrderPagoMovilReport(order.id);
  const receiver = await getActiveReceiverBankAccount();
  const expectedBs =
    report?.amountDueBsCents ??
    (order.bsRateCents
      ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
      : order.totalBsCents ?? 0);

  let targetNotif: BankPaymentNotificationDTO | null = null;
  if (params.notificationId) {
    targetNotif = await getBankNotificationById(params.notificationId);
  }

  const cleanRef = normalizeReferenceDigits(
    params.referenceDigits || targetNotif?.referenceFull || ""
  );
  if (cleanRef.length < 4) {
    throw new Error("Ingresa una referencia bancaria válida (mínimo 4 dígitos).");
  }

  const amountBsCents =
    params.paidBsCents && params.paidBsCents > 0
      ? Math.round(params.paidBsCents)
      : targetNotif?.amountBsCents ?? expectedBs;

  if (!targetNotif) {
    const contentHash = buildNotificationContentHash({
      deviceId: `admin:${params.adminUser.id}`,
      sourceType: "MANUAL",
      content: `MANUAL:${order.id}:${cleanRef}:${amountBsCents}`,
      postedAt: new Date().toISOString(),
      explicitEventId: `manual_${order.id}_${cleanRef}_${Date.now()}`,
    });
    const inserted = await insertBankNotification({
      deviceId: null,
      receiverAccountId: receiver?.id ?? null,
      sourceType: "MANUAL",
      appPackage: null,
      rawContentHash: contentHash,
      rawContentPreview: `Confirmación manual admin (${params.adminUser.email}): Ref ${cleanRef} · Bs ${(amountBsCents / 100).toFixed(2)}`,
      amountBsCents,
      currency: "VES",
      referenceFull: cleanRef,
      referenceLast6: cleanRef.slice(-6),
      referenceLast4: cleanRef.slice(-4),
      senderPhone: report?.reportedSenderPhone ?? null,
      senderDni: report?.reportedSenderDni ?? null,
      senderBankCode: report?.reportedSenderBank ?? null,
      parserUsed: "admin_manual",
      postedAt: new Date().toISOString(),
      status: "UNMATCHED",
      matchedOrderId: null,
      matchedAt: null,
    });
    targetNotif = inserted.notification;
  }

  const claimed = await claimNotificationForOrder({
    notificationId: targetNotif.id,
    orderId: order.id,
    receiverAccountId: targetNotif.receiverAccountId ?? receiver?.id ?? null,
    referenceFull: cleanRef,
    amountBsCents,
  });

  if (!claimed.ok) {
    throw new Error(
      claimed.reason === "DUPLICATE_REFERENCE"
        ? "Esta referencia bancaria ya fue reclamada por otra orden."
        : "Este movimiento bancario ya fue utilizado."
    );
  }

  await dispatchPagoMovilConfirmedWebhook({
    order,
    notification: claimed.notification,
    confirmationSource: "admin_manual",
  });

  await appendAuditLog({
    actorId: params.adminUser.id,
    actorRole: params.adminUser.role,
    action: "pagomovil.admin_manual_confirm",
    targetType: "order",
    targetId: order.id,
    metadata: {
      reference: cleanRef,
      amountBsCents,
      notificationId: claimed.notification.id,
      note: params.note ?? null,
    },
  });

  return {
    order: (await getOrderById(order.id)) ?? order,
    notification: claimed.notification,
  };
}

/**
 * Admin live diagnostic helper to test `POST /getMovement` directly against BDV.
 */
export async function adminTestBdvConciliacion(params: {
  cedulaPagador: string;
  telefonoPagador: string;
  telefonoDestino?: string;
  referencia: string;
  fechaPago?: string;
  importeBsCents: number;
  bancoOrigen: string;
}) {
  const receiver = await getActiveReceiverBankAccount();
  const destPhone = params.telefonoDestino?.trim() || receiver?.phone || "04121234567";
  const fecha = isValidYmdDate(params.fechaPago)
    ? params.fechaPago!.trim()
    : getVenezuelaDateYmd();

  const res = await verifyBdvMovement({
    cedulaPagador: params.cedulaPagador,
    telefonoPagador: params.telefonoPagador,
    telefonoDestino: destPhone,
    referencia: params.referencia,
    fechaPago: fecha,
    importeBsCents: params.importeBsCents,
    bancoOrigen: params.bancoOrigen,
  });

  return {
    endpoint: getBdvApiBaseUrl(),
    ...res,
  };
}
