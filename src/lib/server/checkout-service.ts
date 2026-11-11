import "server-only";
import type { OrderDTO, PaymentGatewayId, SessionUser } from "@/types";
import { getSiteUrl } from "./env";
import { fulfillOrder } from "./fulfillment";
import { getPaymentGateway } from "./payments";
import {
  CheckoutValidationError,
  validateAndPriceCart,
  type CartLineInput,
} from "./pricing";
import {
  appendAuditLog,
  appendCreditLedgerEntry,
  createOrderWithItems,
  ensureCustomerProfile,
  getProviderConfig,
  getUserCreditBalanceCents,
  releaseReservedCodesForOrder,
  reserveManualCodes,
  setOrderGatewaySession,
  transitionOrderStatus,
} from "./repository";

export interface InitiateCheckoutInput {
  email: string;
  items: CartLineInput[];
  applyStoreCredit: boolean;
  paymentGateway: PaymentGatewayId;
  sessionUser: SessionUser | null;
  ipAddress: string | null;
}

export interface InitiateCheckoutResult {
  order: OrderDTO;
  checkoutUrl: string;
  paidInFullByCredit: boolean;
}

export async function initiateCheckout(
  input: InitiateCheckoutInput
): Promise<InitiateCheckoutResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new CheckoutValidationError(
      "EMPTY_CART",
      "Ingresa un correo electrónico válido para recibir tu orden.",
      400
    );
  }

  const { validatedLines, subtotalCents } = await validateAndPriceCart(input.items);

  // Only authenticated users can spend store credit from their credit_ledger
  let creditAppliedCents = 0;
  let customerUserId: string;

  if (input.sessionUser) {
    customerUserId = input.sessionUser.id;
    await ensureCustomerProfile(input.sessionUser.email, input.sessionUser.id);
    if (input.applyStoreCredit) {
      const balanceCents = await getUserCreditBalanceCents(customerUserId);
      creditAppliedCents = Math.min(Math.max(0, balanceCents), subtotalCents);
    }
  } else {
    customerUserId = await ensureCustomerProfile(email);
  }

  const amountDueCents = Math.max(0, subtotalCents - creditAppliedCents);

  if (amountDueCents > 0) {
    const gatewayCfg = await getProviderConfig(input.paymentGateway);
    if (!gatewayCfg || !gatewayCfg.enabled) {
      throw new CheckoutValidationError(
        "GATEWAY_DISABLED",
        "La pasarela de pago seleccionada no está disponible en este momento.",
        503
      );
    }
  }

  const order = await createOrderWithItems({
    userId: customerUserId,
    email,
    subtotalCents,
    creditAppliedCents,
    amountDueCents,
    paymentGateway: input.paymentGateway,
    ipAddress: input.ipAddress,
    items: validatedLines.map((l) => ({
      variantId: l.variant.id,
      productName: l.product.name,
      productSlug: l.product.slug,
      denominationLabel: l.variant.denominationLabel,
      region: l.product.region,
      unitPriceCents: l.variant.salePriceCents,
      quantity: l.quantity,
    })),
  });

  try {
    // 1) Deduct store credit atomically first (DB trigger prevents negative cumulative balance)
    if (creditAppliedCents > 0) {
      await appendCreditLedgerEntry({
        userId: customerUserId,
        orderId: order.id,
        deltaCents: -creditAppliedCents,
        reason: "checkout_apply",
        note: `Aplicado a orden ${order.orderNumber}`,
        createdBy: customerUserId,
      });
    }

    // 2) Atomically reserve manual codes (20-min hold) whenever manual stock should back this line
    const reloadlyCfg = await getProviderConfig("reloadly");
    for (const line of validatedLines) {
      const canFallbackReloadly =
        Boolean(reloadlyCfg?.enabled) &&
        line.variant.sourcePriority !== "manual_only" &&
        Boolean(line.variant.reloadlyProductId);

      if (line.variant.sourcePriority === "reloadly_only" && canFallbackReloadly) {
        continue;
      }

      if (line.variant.sourcePriority === "manual_only" || line.variant.availableStock >= line.quantity) {
        try {
          await reserveManualCodes({
            variantId: line.variant.id,
            orderId: order.id,
            qty: line.quantity,
            holdMinutes: 20,
          });
        } catch {
          if (line.variant.sourcePriority === "manual_only" || !canFallbackReloadly) {
            throw new CheckoutValidationError(
              "OUT_OF_STOCK",
              `Lo sentimos, otro cliente acaba de reservar el último código disponible de ${line.product.name} (${line.variant.denominationLabel}).`,
              409
            );
          }
        }
      }
    }

    // 3) If fully covered by store credit, settle and fulfill immediately!
    if (amountDueCents === 0) {
      await transitionOrderStatus({
        orderId: order.id,
        expectedStatuses: ["CREATED"],
        nextStatus: "PAID",
        paidCents: 0,
      });
      await fulfillOrder(order.id);
      const updated = await import("./repository").then((m) =>
        m.getOrderById(order.id)
      );
      await appendAuditLog({
        actorId: customerUserId,
        actorRole: input.sessionUser?.role ?? "customer",
        action: "order.checkout_credit_only",
        targetType: "order",
        targetId: order.id,
        metadata: { creditAppliedCents, subtotalCents },
      });
      return {
        order: updated ?? order,
        checkoutUrl: `${getSiteUrl()}/order/${order.id}`,
        paidInFullByCredit: true,
      };
    }

    // 4) Create ZenoBank checkout session
    const gateway = getPaymentGateway(input.paymentGateway);
    const successRedirectUrl = `${getSiteUrl()}/order/${order.id}`;
    const gatewaySession = await gateway.createCheckout({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amountCents: amountDueCents,
      currency: "USD",
      customerEmail: email,
      successRedirectUrl,
    });

    await setOrderGatewaySession(order.id, {
      checkoutId: gatewaySession.checkoutId,
      checkoutUrl: gatewaySession.checkoutUrl,
      expiresAt: gatewaySession.expiresAt,
      nextStatus: "PENDING_PAYMENT",
    });

    const refreshed = await import("./repository").then((m) =>
      m.getOrderById(order.id)
    );
    return {
      order: refreshed ?? order,
      checkoutUrl: gatewaySession.checkoutUrl,
      paidInFullByCredit: false,
    };
  } catch (err) {
    // Compensate reservations, credit deduction, and mark order cancelled
    await releaseReservedCodesForOrder(order.id).catch(() => {});
    if (creditAppliedCents > 0) {
      await appendCreditLedgerEntry({
        userId: customerUserId,
        orderId: order.id,
        deltaCents: creditAppliedCents,
        reason: "fulfillment_refund",
        note: `Reversión por fallo al iniciar checkout ${order.orderNumber}`,
        createdBy: customerUserId,
      }).catch(() => {});
    }
    await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["CREATED", "PENDING_PAYMENT"],
      nextStatus: "CANCELLED",
    }).catch(() => {});

    throw err;
  }
}
