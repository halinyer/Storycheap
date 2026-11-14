import "server-only";
import type { OrderDTO, SessionUser } from "@/types";
import { encryptCode, extractLast4 } from "./crypto";
import { sendCreditAdjustmentEmail, sendOrderReadyEmail } from "./email";
import { getPaymentGateway } from "./payments";
import type { NormalizedPaymentWebhookEvent } from "./payments/types";
import {
  appendAuditLog,
  appendCreditLedgerEntry,
  applyAdditionalCreditToOrder,
  commitReservedCodesForOrder,
  ensureCustomerProfile,
  getOrderByGatewayCheckoutId,
  getOrderById,
  getProviderConfig,
  getSupplierOrderByExternalId,
  getUserCreditBalanceCents,
  getVariantsLookupByIds,
  insertFulfillmentRecord,
  markOrderAttentionFlag,
  markOrderItemProgress,
  recordWebhookEventOnce,
  releaseReservedCodesForOrder,
  reserveManualCodes,
  transitionOrderStatus,
  updateOrderPartialPaymentCents,
  updateSupplierOrderState,
  updateWebhookEventStatus,
  upsertSupplierOrder,
} from "./repository";
import {
  createCentralOneOrder,
  getCentralOneOrder,
  getCentralOneOrderCodes,
  invalidateCentralOneBalanceCache,
} from "./suppliers/centralone";
import { purchaseReloadlyCard } from "./suppliers/reloadly";

/**
 * Delivers all items of a PAID/PARTIAL/MANUAL_REVIEW order using pre-reserved
 * manual codes first, unreserved manual inventory second, and Reloadly only if enabled.
 */
export async function fulfillOrder(orderId: string): Promise<OrderDTO> {
  const initialOrder = await getOrderById(orderId);
  if (!initialOrder) {
    throw new Error(`Order not found for fulfillment: ${orderId}`);
  }

  if (initialOrder.status === "DELIVERED") {
    return initialOrder;
  }

  const movedToFulfilling = await transitionOrderStatus({
    orderId,
    expectedStatuses: ["PAID", "PARTIAL", "MANUAL_REVIEW"],
    nextStatus: "FULFILLING",
  });

  if (!movedToFulfilling) {
    const latest = await getOrderById(orderId);
    return latest ?? initialOrder;
  }

  const order = (await getOrderById(orderId)) ?? initialOrder;

  // 1) Commit any reserved manual codes held for this order
  const committed = await commitReservedCodesForOrder(order.id);
  const committedByVariant = new Map<string, typeof committed>();
  for (const row of committed) {
    const arr = committedByVariant.get(row.variantId) ?? [];
    arr.push(row);
    committedByVariant.set(row.variantId, arr);
  }

  const variantLookup = await getVariantsLookupByIds(
    order.items.map((i) => i.variantId)
  );
  const reloadlyCfg = await getProviderConfig("reloadly");
  const centralOneCfg = await getProviderConfig("centralone");
  const manualCfg = await getProviderConfig("manual_inventory");

  let allItemsFulfilled = true;
  let anyFulfilledNowOrBefore = false;
  let hasPendingAsyncSupplier = false;
  const attentionReasons: string[] = [];

  for (const item of order.items) {
    let delivered = item.deliveredCount;
    const needed = item.quantity - delivered;

    if (needed <= 0) {
      anyFulfilledNowOrBefore = true;
      continue;
    }

    // Step A: consume pre-committed manual codes for this variant
    const pool = committedByVariant.get(item.variantId) ?? [];
    while (delivered < item.quantity && pool.length > 0) {
      const codeRow = pool.shift()!;
      await insertFulfillmentRecord({
        orderItemId: item.id,
        orderId: order.id,
        userId: order.userId,
        source: "manual",
        codeInventoryId: codeRow.id,
        codeCiphertext: codeRow.codeCiphertext,
        codeLast4: codeRow.codeLast4,
        pinCiphertext: codeRow.pinCiphertext,
      });
      delivered += 1;
      anyFulfilledNowOrBefore = true;
    }

    // Step B: try claiming additional AVAILABLE manual stock if still needed
    const variantMeta = variantLookup.get(item.variantId)?.variant;
    if (
      delivered < item.quantity &&
      (manualCfg?.enabled ?? true) &&
      variantMeta?.sourcePriority !== "reloadly_only" &&
      variantMeta?.sourcePriority !== "centralone_only"
    ) {
      const remaining = item.quantity - delivered;
      try {
        await reserveManualCodes({
          variantId: item.variantId,
          orderId: order.id,
          qty: remaining,
          holdMinutes: 5,
        });
        const freshlyCommitted = await commitReservedCodesForOrder(order.id);
        for (const c of freshlyCommitted) {
          if (c.variantId !== item.variantId) continue;
          await insertFulfillmentRecord({
            orderItemId: item.id,
            orderId: order.id,
            userId: order.userId,
            source: "manual",
            codeInventoryId: c.id,
            codeCiphertext: c.codeCiphertext,
            codeLast4: c.codeLast4,
            pinCiphertext: c.pinCiphertext,
          });
          delivered += 1;
          anyFulfilledNowOrBefore = true;
        }
      } catch {
        // Not enough manual inventory; fall through to Reloadly or MANUAL_REVIEW
      }
    }

    // Step C: optional Reloadly fallback ONLY when enabled & variant configured
    if (
      delivered < item.quantity &&
      reloadlyCfg?.enabled &&
      variantMeta &&
      (variantMeta.sourcePriority === "manual_then_reloadly" ||
        variantMeta.sourcePriority === "reloadly_only") &&
      variantMeta.reloadlyProductId
    ) {
      while (delivered < item.quantity) {
        try {
          const deliveredCode = await purchaseReloadlyCard({
            reloadlyProductId: variantMeta.reloadlyProductId,
            unitFaceValueUsd: variantMeta.faceValueCents / 100,
            customIdentifier: `${item.id}-${delivered + 1}`,
            recipientEmail: order.email,
          });
          await insertFulfillmentRecord({
            orderItemId: item.id,
            orderId: order.id,
            userId: order.userId,
            source: "reloadly",
            codeInventoryId: null,
            codeCiphertext: encryptCode(deliveredCode.codePlaintext),
            codeLast4: extractLast4(deliveredCode.codePlaintext),
            pinCiphertext: deliveredCode.pinPlaintext
              ? encryptCode(deliveredCode.pinPlaintext)
              : null,
            supplierTxId: deliveredCode.supplierTxId ?? null,
          });
          delivered += 1;
          anyFulfilledNowOrBefore = true;
        } catch (err) {
          attentionReasons.push(
            `Reloadly falló para ${item.productName}: ${err instanceof Error ? err.message : "Error desconocido"}`
          );
          break;
        }
      }
    }

    // Step D: Central One API fulfillment (supports both instant & async delivery)
    let itemPendingAsync = false;
    if (
      delivered < item.quantity &&
      centralOneCfg?.enabled &&
      variantMeta &&
      (variantMeta.sourcePriority === "manual_then_centralone" ||
        variantMeta.sourcePriority === "centralone_only") &&
      variantMeta.centraloneProductId
    ) {
      const remaining = item.quantity - delivered;
      if (
        typeof variantMeta.unitCostCents === "number" &&
        variantMeta.unitCostCents > item.unitPriceCents
      ) {
        attentionReasons.push(
          `Central One bloqueado para ${item.productName}: costo configurado ($${(variantMeta.unitCostCents / 100).toFixed(2)}) supera el precio de venta ($${(item.unitPriceCents / 100).toFixed(2)}).`
        );
      } else {
        try {
          const c1Order = await createCentralOneOrder({
            idempotencyKey: `sc-item-${item.id}`,
            catalogItemId: variantMeta.centraloneProductId,
            quantity: remaining,
            externalReference: `${order.orderNumber}:${item.id}`,
          });

          await upsertSupplierOrder({
            orderId: order.id,
            orderItemId: item.id,
            provider: "centralone",
            idempotencyKey: `sc-item-${item.id}`,
            externalOrderId: c1Order.externalOrderId,
            referenceCode: c1Order.referenceCode,
            status: c1Order.status,
            expectedQty: remaining,
            deliveredCount: c1Order.deliveredCount,
            supplierUnitCostCents: c1Order.unitCostCents,
            rawPayload: c1Order.raw,
          });
          invalidateCentralOneBalanceCache();

          if (c1Order.status === "completed" && c1Order.deliveredCount > 0) {
            const codes = await getCentralOneOrderCodes(c1Order.externalOrderId);
            const existingC1Count = order.fulfillments.filter(
              (f) => f.orderItemId === item.id && f.source === "centralone"
            ).length;
            const unseenCodes = codes.slice(
              existingC1Count,
              existingC1Count + remaining
            );
            for (const c of unseenCodes) {
              await insertFulfillmentRecord({
                orderItemId: item.id,
                orderId: order.id,
                userId: order.userId,
                source: "centralone",
                codeInventoryId: null,
                codeCiphertext: encryptCode(c.codePlaintext),
                codeLast4: extractLast4(c.codePlaintext),
                pinCiphertext: c.pinPlaintext ? encryptCode(c.pinPlaintext) : null,
                supplierTxId: c1Order.externalOrderId,
              });
              delivered += 1;
              anyFulfilledNowOrBefore = true;
            }
          } else if (
            c1Order.status === "confirmed" ||
            c1Order.status === "processing" ||
            c1Order.status === "pending"
          ) {
            itemPendingAsync = true;
            hasPendingAsyncSupplier = true;
          } else {
            attentionReasons.push(
              `Central One devolvió estado "${c1Order.status}" para ${item.productName}.`
            );
          }
        } catch (err) {
          attentionReasons.push(
            `Central One falló para ${item.productName}: ${err instanceof Error ? err.message : "Error desconocido"}`
          );
        }
      }
    }

    if (delivered < item.quantity) {
      allItemsFulfilled = false;
      if (itemPendingAsync) {
        await markOrderItemProgress(item.id, {
          deliveredCount: delivered,
          status: "RESERVED",
        });
      } else {
        if (attentionReasons.length === 0) {
          attentionReasons.push(
            `Stock insuficiente para entregar ${item.quantity - delivered} unidad(es) de ${item.productName} (${item.denominationLabel}).`
          );
        }
        await markOrderItemProgress(item.id, {
          deliveredCount: delivered,
          status: "MANUAL_REVIEW",
        });
      }
    } else {
      await markOrderItemProgress(item.id, {
        deliveredCount: delivered,
        status: "FULFILLED",
      });
    }
  }

  if (allItemsFulfilled) {
    await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["FULFILLING"],
      nextStatus: "DELIVERED",
      needsAttention: false,
      attentionReason: null,
    });
    const totalDelivered = order.items.reduce((acc, it) => acc + it.quantity, 0);
    await sendOrderReadyEmail({
      to: order.email,
      orderId: order.id,
      orderNumber: order.orderNumber,
      itemCount: totalDelivered,
    }).catch(() => {});
  } else if (hasPendingAsyncSupplier && attentionReasons.length === 0) {
    await appendAuditLog({
      actorId: null,
      actorRole: "system",
      action: "order.fulfillment_awaiting_supplier",
      targetType: "order",
      targetId: order.id,
      metadata: { provider: "centralone" },
    });
  } else {
    const nextStatus = anyFulfilledNowOrBefore ? "PARTIAL" : "MANUAL_REVIEW";
    const reasonText = attentionReasons.join(" | ");
    await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["FULFILLING"],
      nextStatus,
      needsAttention: true,
      attentionReason: reasonText,
    });
    if (anyFulfilledNowOrBefore) {
      await sendOrderReadyEmail({
        to: order.email,
        orderId: order.id,
        orderNumber: order.orderNumber,
        itemCount: order.items.reduce((acc, it) => acc + it.deliveredCount, 0),
        partial: true,
      }).catch(() => {});
    }
    await appendAuditLog({
      actorId: null,
      actorRole: "system",
      action: "order.fulfillment_needs_attention",
      targetType: "order",
      targetId: order.id,
      metadata: { nextStatus, reasonText },
    });
  }

  return (await getOrderById(order.id)) ?? order;
}

async function settleUnderpaymentToCredit(params: {
  order: OrderDTO;
  paidCents: number;
  note: string;
  needsAttention: boolean;
  attentionReason: string | null;
}): Promise<boolean> {
  await releaseReservedCodesForOrder(params.order.id);
  const transitioned = await transitionOrderStatus({
    orderId: params.order.id,
    expectedStatuses: ["PENDING_PAYMENT", "CREATED", "EXPIRED"],
    nextStatus: "REFUNDED_CREDIT",
    paidCents: params.paidCents,
    needsAttention: params.needsAttention,
    attentionReason: params.attentionReason,
  });

  if (transitioned) {
    const userId =
      params.order.userId ?? (await ensureCustomerProfile(params.order.email));

    if (params.order.creditAppliedCents > 0) {
      await appendCreditLedgerEntry({
        userId,
        orderId: params.order.id,
        deltaCents: params.order.creditAppliedCents,
        reason: "fulfillment_refund",
        note: `Devolución automática de saldo aplicado en orden no completada (${params.order.orderNumber})`,
        createdBy: null,
      });
    }

    if (params.paidCents > 0) {
      await appendCreditLedgerEntry({
        userId,
        orderId: params.order.id,
        deltaCents: params.paidCents,
        reason: "partial_payment",
        note: params.note,
        createdBy: null,
      });
    }

    const totalCreditedCents = params.paidCents + params.order.creditAppliedCents;
    if (totalCreditedCents > 0) {
      await sendCreditAdjustmentEmail({
        to: params.order.email,
        orderNumber: params.order.orderNumber,
        amountCents: totalCreditedCents,
        reasonText: params.note,
      }).catch(() => {});
    }
  }

  return transitioned;
}

export async function processVerifiedWebhookEvent(
  event: NormalizedPaymentWebhookEvent,
  options?: { skipRemoteDoubleCheck?: boolean }
): Promise<{
  outcome:
    | "duplicate"
    | "delivered_or_fulfilling"
    | "partial_underpaid_credited"
    | "partial_pending"
    | "expired"
    | "ignored";
  orderId: string | null;
}> {
  const matchedOrder =
    (await getOrderById(event.orderId)) ??
    (await getOrderByGatewayCheckoutId(event.checkoutId));

  const { isDuplicate, recordId } = await recordWebhookEventOnce({
    gateway: event.gateway,
    eventId: event.eventId,
    eventType: event.eventType,
    orderId: matchedOrder?.id ?? null,
    gatewayCheckoutId: event.checkoutId,
    signatureValid: true,
    payload: event.rawPayload,
  });

  if (isDuplicate) {
    return { outcome: "duplicate", orderId: matchedOrder?.id ?? null };
  }

  if (!matchedOrder) {
    await updateWebhookEventStatus(
      recordId,
      "ignored",
      `Order not found for orderId=${event.orderId} checkoutId=${event.checkoutId}`
    );
    return { outcome: "ignored", orderId: null };
  }

  // Server-to-server authoritative checkout double-check with gateway API
  let authoritativeStatus = event.status;
  let authoritativePaidCents = event.paidCents;
  let authoritativeExpiresAt = event.expiresAt ?? matchedOrder.expiresAt ?? null;
  if (!options?.skipRemoteDoubleCheck) {
    const gateway = getPaymentGateway(event.gateway);
    const liveCheckout = await gateway.getCheckout(event.checkoutId);
    authoritativeStatus = liveCheckout.status;
    authoritativePaidCents = liveCheckout.paidCents;
    authoritativeExpiresAt = liveCheckout.expiresAt ?? authoritativeExpiresAt;
  }

  const checkoutHasExpired = Boolean(
    matchedOrder.status === "EXPIRED" ||
      (authoritativeExpiresAt && Date.now() >= Date.parse(authoritativeExpiresAt))
  );

  // Handle expiry or non-completed underpayment
  if (
    event.eventType === "checkout.expired" ||
    authoritativeStatus === "EXPIRED" ||
    authoritativeStatus === "CANCELLED"
  ) {
    if (authoritativePaidCents > 0 || matchedOrder.creditAppliedCents > 0) {
      await settleUnderpaymentToCredit({
        order: matchedOrder,
        paidCents: authoritativePaidCents,
        note:
          authoritativePaidCents > 0
            ? `Pago parcial recibido tras expiración (${matchedOrder.orderNumber})`
            : `Devolución de saldo aplicado por orden expirada (${matchedOrder.orderNumber})`,
        needsAttention: false,
        attentionReason: null,
      });
      await updateWebhookEventStatus(recordId, "processed");
      return {
        outcome:
          authoritativePaidCents > 0 ? "partial_underpaid_credited" : "expired",
        orderId: matchedOrder.id,
      };
    }

    await releaseReservedCodesForOrder(matchedOrder.id);
    await transitionOrderStatus({
      orderId: matchedOrder.id,
      expectedStatuses: ["PENDING_PAYMENT", "CREATED"],
      nextStatus: "EXPIRED",
    });
    await updateWebhookEventStatus(recordId, "processed");
    return { outcome: "expired", orderId: matchedOrder.id };
  }

  if (
    event.eventType === "checkout.partially_paid" ||
    authoritativeStatus === "PARTIALLY_PAID" ||
    authoritativePaidCents < matchedOrder.amountDueCents
  ) {
    // Underpayment: NEVER release digital codes.
    const shouldSettleToCredit =
      event.eventType === "checkout.completed" ||
      authoritativeStatus === "COMPLETED" ||
      checkoutHasExpired;

    if (shouldSettleToCredit && authoritativePaidCents > 0) {
      await settleUnderpaymentToCredit({
        order: matchedOrder,
        paidCents: authoritativePaidCents,
        note: checkoutHasExpired
          ? `Pago parcial recibido al vencer enlace (${matchedOrder.orderNumber})`
          : `Monto recibido menor al total en orden ${matchedOrder.orderNumber}`,
        needsAttention:
          event.eventType === "checkout.completed" ||
          authoritativeStatus === "COMPLETED",
        attentionReason: `Pago insuficiente: pagado ${authoritativePaidCents} vs esperado ${matchedOrder.amountDueCents}`,
      });
      await updateWebhookEventStatus(recordId, "processed");
      return { outcome: "partial_underpaid_credited", orderId: matchedOrder.id };
    }

    if (shouldSettleToCredit && authoritativePaidCents === 0) {
      if (matchedOrder.creditAppliedCents > 0) {
        await settleUnderpaymentToCredit({
          order: matchedOrder,
          paidCents: 0,
          note: `Devolución de saldo aplicado por orden expirada (${matchedOrder.orderNumber})`,
          needsAttention: false,
          attentionReason: null,
        });
      } else {
        await releaseReservedCodesForOrder(matchedOrder.id);
        await transitionOrderStatus({
          orderId: matchedOrder.id,
          expectedStatuses: ["PENDING_PAYMENT", "CREATED"],
          nextStatus: "EXPIRED",
        });
      }
      await updateWebhookEventStatus(recordId, "processed");
      return { outcome: "expired", orderId: matchedOrder.id };
    }

    // Checkout is still OPEN: persist partial paid_cents so UI shows exact missing balance
    if (authoritativePaidCents > 0) {
      await updateOrderPartialPaymentCents(matchedOrder.id, authoritativePaidCents);
      await updateWebhookEventStatus(recordId, "processed");
      return { outcome: "partial_pending", orderId: matchedOrder.id };
    }

    await updateWebhookEventStatus(recordId, "processed");
    return { outcome: "ignored", orderId: matchedOrder.id };
  }

  // Full payment verified (`authoritativePaidCents >= matchedOrder.amountDueCents`)
  const transitioned = await transitionOrderStatus({
    orderId: matchedOrder.id,
    expectedStatuses: ["PENDING_PAYMENT", "CREATED"],
    nextStatus: "PAID",
    paidCents: authoritativePaidCents,
  });

  if (!transitioned) {
    // Order already PAID/FULFILLING/DELIVERED -> idempotent no-op
    await updateWebhookEventStatus(recordId, "ignored", "Order already paid");
    return { outcome: "duplicate", orderId: matchedOrder.id };
  }

  // Overpayment protection (> $0.05 tolerance or any integer surplus >= 1 cent)
  const surplusCents = authoritativePaidCents - matchedOrder.amountDueCents;
  if (surplusCents > 0) {
    const userId =
      matchedOrder.userId ?? (await ensureCustomerProfile(matchedOrder.email));
    await appendCreditLedgerEntry({
      userId,
      orderId: matchedOrder.id,
      deltaCents: surplusCents,
      reason: "overpayment",
      note: `Excedente pagado en orden ${matchedOrder.orderNumber}`,
      createdBy: null,
    });
    await sendCreditAdjustmentEmail({
      to: matchedOrder.email,
      orderNumber: matchedOrder.orderNumber,
      amountCents: surplusCents,
      reasonText: "Excedente enviado en tu pago cripto",
    }).catch(() => {});
  }

  await fulfillOrder(matchedOrder.id);
  return { outcome: "delivered_or_fulfilling", orderId: matchedOrder.id };
}

export async function adminRefundOrderToCredit(params: {
  orderId: string;
  adminUser: SessionUser;
  reasonNote: string;
}) {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Orden no encontrada.");
  if (order.status === "DELIVERED" || order.status === "REFUNDED_CREDIT") {
    throw new Error(`No se puede acreditar saldo en estado ${order.status}.`);
  }

  await releaseReservedCodesForOrder(order.id);

  // Calculate undelivered monetary value based on items minus already-delivered items
  const undeliveredCents = order.items.reduce((acc, it) => {
    const pendingUnits = Math.max(0, it.quantity - it.deliveredCount);
    return acc + pendingUnits * it.unitPriceCents;
  }, 0);

  const refundCents = Math.min(
    order.subtotalCents,
    undeliveredCents > 0 ? undeliveredCents : order.paidCents + order.creditAppliedCents
  );

  const userId = order.userId ?? (await ensureCustomerProfile(order.email));
  if (refundCents > 0) {
    await appendCreditLedgerEntry({
      userId,
      orderId: order.id,
      deltaCents: refundCents,
      reason: "fulfillment_refund",
      note: params.reasonNote,
      createdBy: params.adminUser.id,
    });
    await sendCreditAdjustmentEmail({
      to: order.email,
      orderNumber: order.orderNumber,
      amountCents: refundCents,
      reasonText: params.reasonNote,
    }).catch(() => {});
  }

  await transitionOrderStatus({
    orderId: order.id,
    expectedStatuses: ["PAID", "FULFILLING", "PARTIAL", "MANUAL_REVIEW", "EXPIRED"],
    nextStatus: "REFUNDED_CREDIT",
    needsAttention: false,
    attentionReason: null,
  });

  await markOrderAttentionFlag(order.id, false, null);

  await appendAuditLog({
    actorId: params.adminUser.id,
    actorRole: params.adminUser.role,
    action: "order.admin_refund_credit",
    targetType: "order",
    targetId: order.id,
    metadata: { refundCents, reasonNote: params.reasonNote },
  });
}

/**
 * Reconciles an asynchronous Central One order against GET /orders/{id} and
 * GET /orders/{id}/codes. Called by /api/webhooks/centralone and /api/cron/reconcile.
 */
export async function syncCentralOneOrderProgress(
  externalOrderId: string,
  sequenceHint?: number
): Promise<{ ok: boolean; status: string; addedCodes: number }> {
  const supplierOrder = await getSupplierOrderByExternalId("centralone", externalOrderId);
  if (!supplierOrder) {
    return { ok: false, status: "unknown_supplier_order", addedCodes: 0 };
  }

  if (
    typeof sequenceHint === "number" &&
    sequenceHint > 0 &&
    sequenceHint <= supplierOrder.lastSequence
  ) {
    return { ok: true, status: "stale_sequence_ignored", addedCodes: 0 };
  }

  const live = await getCentralOneOrder(externalOrderId);
  const order = await getOrderById(supplierOrder.orderId);
  if (!order) {
    return { ok: false, status: "order_not_found", addedCodes: 0 };
  }

  const targetItem = order.items.find((it) => it.id === supplierOrder.orderItemId);
  if (!targetItem) {
    return { ok: false, status: "order_item_not_found", addedCodes: 0 };
  }

  let addedCodes = 0;
  if (live.deliveredCount > 0) {
    const existingCount = order.fulfillments.filter(
      (f) => f.orderItemId === targetItem.id && f.source === "centralone"
    ).length;

    if (live.deliveredCount > existingCount) {
      const codes = await getCentralOneOrderCodes(externalOrderId);
      const pendingCodes = codes.slice(existingCount);
      for (const c of pendingCodes) {
        await insertFulfillmentRecord({
          orderItemId: targetItem.id,
          orderId: order.id,
          userId: order.userId,
          source: "centralone",
          codeInventoryId: null,
          codeCiphertext: encryptCode(c.codePlaintext),
          codeLast4: extractLast4(c.codePlaintext),
          pinCiphertext: c.pinPlaintext ? encryptCode(c.pinPlaintext) : null,
          supplierTxId: externalOrderId,
        });
        addedCodes += 1;
      }
    }
  }

  const newDeliveredForItem = Math.min(
    targetItem.quantity,
    targetItem.deliveredCount + addedCodes
  );

  await updateSupplierOrderState(supplierOrder.id, {
    status: live.status,
    deliveredCount: live.deliveredCount,
    supplierUnitCostCents: live.unitCostCents ?? supplierOrder.supplierUnitCostCents,
    lastSequence:
      typeof sequenceHint === "number" && sequenceHint > supplierOrder.lastSequence
        ? sequenceHint
        : supplierOrder.lastSequence,
    rawPayload: live.raw,
  });

  if (live.status === "failed" || live.status === "cancelled") {
    await markOrderItemProgress(targetItem.id, {
      deliveredCount: newDeliveredForItem,
      status: newDeliveredForItem >= targetItem.quantity ? "FULFILLED" : "MANUAL_REVIEW",
    });
    const nextOrderStatus = newDeliveredForItem > 0 ? "PARTIAL" : "MANUAL_REVIEW";
    await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["FULFILLING", "PARTIAL"],
      nextStatus: nextOrderStatus,
      needsAttention: true,
      attentionReason: `Central One devolvió estado "${live.status}" (orden ${externalOrderId}).`,
    });
    return { ok: true, status: live.status, addedCodes };
  }

  await markOrderItemProgress(targetItem.id, {
    deliveredCount: newDeliveredForItem,
    status: newDeliveredForItem >= targetItem.quantity ? "FULFILLED" : "RESERVED",
  });

  const refreshed = await getOrderById(order.id);
  if (
    refreshed &&
    refreshed.items.every((it) => it.deliveredCount >= it.quantity) &&
    refreshed.status !== "DELIVERED"
  ) {
    await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["FULFILLING", "PARTIAL", "MANUAL_REVIEW"],
      nextStatus: "DELIVERED",
      needsAttention: false,
      attentionReason: null,
    });
    await sendOrderReadyEmail({
      to: order.email,
      orderId: order.id,
      orderNumber: order.orderNumber,
      itemCount: refreshed.items.reduce((acc, it) => acc + it.quantity, 0),
    }).catch(() => {});
  }

  return { ok: true, status: live.status, addedCodes };
}

/**
 * Self-service resolution for partially paid orders (`PENDING_PAYMENT` with `paidCents > 0`).
 * Customers can either cover the missing difference with existing store credit (`complete_with_credit`)
 * or convert the partial payment immediately into store credit (`convert_to_credit_now`) without waiting for expiry.
 */
export async function resolveOrderUnderpayment(params: {
  orderId: string;
  actorUser: SessionUser;
  mode: "complete_with_credit" | "convert_to_credit_now";
  skipRemoteDoubleCheck?: boolean;
}): Promise<{
  outcome: "fulfilled" | "converted_to_credit";
  order: OrderDTO;
  creditDeltaCents: number;
}> {
  const order = await getOrderById(params.orderId);
  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  const isOwner = order.userId === params.actorUser.id;
  const isAdmin = params.actorUser.role === "admin";
  if (!isOwner && !isAdmin) {
    throw new Error("FORBIDDEN_ORDER_OWNER");
  }

  if (order.status !== "PENDING_PAYMENT" && order.status !== "CREATED") {
    throw new Error(`INVALID_ORDER_STATUS:${order.status}`);
  }

  let authoritativePaidCents = order.paidCents;
  if (
    !params.skipRemoteDoubleCheck &&
    order.paymentGateway === "zenobank" &&
    order.gatewayCheckoutId
  ) {
    try {
      const gw = getPaymentGateway("zenobank");
      const liveSession = await gw.getCheckout(order.gatewayCheckoutId);
      authoritativePaidCents = Math.max(order.paidCents, liveSession.paidCents);
    } catch {
      // Fallback to persisted paidCents if gateway query temporarily fails
    }
  }

  if (authoritativePaidCents <= 0) {
    throw new Error("NO_PARTIAL_PAYMENT_DETECTED");
  }

  // If the customer actually completed full payment in the meantime, fulfill directly
  if (authoritativePaidCents >= order.amountDueCents) {
    const transitioned = await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["PENDING_PAYMENT", "CREATED"],
      nextStatus: "PAID",
      paidCents: authoritativePaidCents,
    });
    if (transitioned) {
      await fulfillOrder(order.id);
    }
    const updated = (await getOrderById(order.id)) ?? order;
    return {
      outcome: "fulfilled",
      order: updated,
      creditDeltaCents: 0,
    };
  }

  if (params.mode === "convert_to_credit_now") {
    const settled = await settleUnderpaymentToCredit({
      order,
      paidCents: authoritativePaidCents,
      note: `Pago parcial acreditado a solicitud del cliente (${order.orderNumber})`,
      needsAttention: false,
      attentionReason: null,
    });
    if (!settled) {
      throw new Error("ORDER_STATE_CONFLICT");
    }
    await appendAuditLog({
      actorId: params.actorUser.id,
      actorRole: params.actorUser.role,
      action: "order.underpayment_converted_to_credit",
      targetType: "order",
      targetId: order.id,
      metadata: {
        paidCents: authoritativePaidCents,
        creditAppliedCents: order.creditAppliedCents,
      },
    });
    const updated = (await getOrderById(order.id)) ?? order;
    return {
      outcome: "converted_to_credit",
      order: updated,
      creditDeltaCents: authoritativePaidCents + order.creditAppliedCents,
    };
  }

  // mode === "complete_with_credit"
  const missingCents = order.amountDueCents - authoritativePaidCents;
  const targetUserId = order.userId ?? params.actorUser.id;
  const availableCredit = await getUserCreditBalanceCents(targetUserId);

  if (availableCredit < missingCents) {
    throw new Error(
      `INSUFFICIENT_CREDIT_FOR_DIFFERENCE:needed=${missingCents},available=${availableCredit}`
    );
  }

  // Deduct missing cents from customer's credit ledger
  await appendCreditLedgerEntry({
    userId: targetUserId,
    orderId: order.id,
    deltaCents: -missingCents,
    reason: "checkout_apply",
    note: `Cobertura de diferencia faltante en orden ${order.orderNumber}`,
    createdBy: params.actorUser.id,
  });

  const transitioned = await transitionOrderStatus({
    orderId: order.id,
    expectedStatuses: ["PENDING_PAYMENT", "CREATED"],
    nextStatus: "PAID",
    paidCents: authoritativePaidCents,
  });

  if (!transitioned) {
    // Rollback ledger deduction if concurrent webhook already transitioned the order
    await appendCreditLedgerEntry({
      userId: targetUserId,
      orderId: order.id,
      deltaCents: missingCents,
      reason: "fulfillment_refund",
      note: `Reverso por transición concurrente en orden ${order.orderNumber}`,
      createdBy: null,
    });
    throw new Error("ORDER_STATE_CONFLICT");
  }

  await applyAdditionalCreditToOrder(order.id, missingCents);

  await appendAuditLog({
    actorId: params.actorUser.id,
    actorRole: params.actorUser.role,
    action: "order.underpayment_completed_with_credit",
    targetType: "order",
    targetId: order.id,
    metadata: {
      paidCents: authoritativePaidCents,
      creditCoveredCents: missingCents,
    },
  });

  const fulfilledOrder = await fulfillOrder(order.id);
  return {
    outcome: "fulfilled",
    order: fulfilledOrder,
    creditDeltaCents: -missingCents,
  };
}
