import "server-only";
import crypto from "crypto";
import type { OrderDTO, ProductVariantDTO, SessionUser } from "@/types";
import { encryptCode, extractLast4 } from "./crypto";
import { sendCreditAdjustmentEmail, sendOrderReadyEmail } from "./email";
import { isBinancePayConfigured } from "./env";
import {
  getMatchedNotificationForOrder,
  getOrderPagoMovilReport,
} from "./pagomovil-store";
import { getPaymentGateway } from "./payments";
import {
  fetchBinancePayIncomingTransactions,
  findBinancePayTransactionForOrder,
  type BinancePayIncomingTx,
} from "./payments/binance-pay";
import type {
  GatewayCheckoutSession,
  NormalizedPaymentWebhookEvent,
} from "./payments/types";
import {
  extractZenoTransactionsFromPayload,
  formatZenoTransactionsTag,
} from "./payments/zenobank";
import {
  appendAuditLog,
  appendCreditLedgerEntry,
  applyAdditionalCreditToOrder,
  batchSaveVariantPricingMeta,
  commitReservedCodesForOrder,
  countFulfillmentsForOrderItem,
  ensureCustomerProfile,
  findConsumedBinancePayTxIds,
  getOrderByGatewayCheckoutId,
  getOrderById,
  getOrderItemTargets,
  getProviderConfig,
  getSupplierOrderByExternalId,
  getSupplierOrderByIdentifier,
  getSupplierPricingPolicy,
  getUserCreditBalanceCents,
  getVariantPricingMetaMap,
  getVariantsLookupByIds,
  getZenoBinanceReceiver,
  insertFulfillmentRecord,
  listOrdersAdmin,
  listPendingSupplierOrders,
  listPendingSupplierOrdersForOrder,
  markOrderAttentionFlag,
  markOrderItemProgress,
  recordWebhookEventOnce,
  releaseReservedCodesForOrder,
  reserveManualCodes,
  setOrderPaidCentsForManualReview,
  transitionOrderStatus,
  updateOrderItemTargetStatus,
  updateOrderItemUnitCostCents,
  updateOrderPartialPaymentCents,
  updateSupplierOrderState,
  updateVariantAdmin,
  updateWebhookEventStatus,
  upsertSupplierOrder,
} from "./repository";
import { applyLiveQuoteToVariant, fetchLiveQuoteForSku } from "./supplier-sync";
import {
  createCentralOneOrder,
  getCentralOneOrder,
  getCentralOneOrderCodes,
  invalidateCentralOneBalanceCache,
} from "./suppliers/centralone";
import {
  createFazerCardsGiftCardOrder,
  getFazerCardsOrder,
  invalidateFazerCardsBalanceCache,
  isFazerCardsProductId,
} from "./suppliers/fazercards";
import { purchaseReloadlyCard } from "./suppliers/reloadly";

async function checkPreBuySupplierMargin(input: {
  providerLabel: string;
  productName: string;
  variant: ProductVariantDTO;
  itemUnitPriceCents: number;
}): Promise<{ blockedReason: string | null }> {
  const skuId = input.variant.centraloneProductId;
  if (skuId) {
    const liveQuote = await fetchLiveQuoteForSku(skuId, { forceFresh: true }).catch(
      () => null
    );
    if (liveQuote) {
      try {
        const [pricingMetaMap, policy] = await Promise.all([
          getVariantPricingMetaMap(),
          getSupplierPricingPolicy(),
        ]);
        await applyLiveQuoteToVariant({
          productName: input.productName,
          variant: input.variant,
          quote: liveQuote,
          existingMeta: pricingMetaMap[input.variant.id],
          policy,
        });
      } catch {
        // Non-fatal metadata persistence failure; live quote guard still runs below.
      }

      if (liveQuote.costTenths >= input.itemUnitPriceCents * 100) {
        return {
          blockedReason: `${input.providerLabel} bloqueado (anti-pérdida) para ${input.productName}: costo actual ($${liveQuote.costRaw}) alcanza o supera el precio cobrado ($${(input.itemUnitPriceCents / 100).toFixed(2)}).`,
        };
      }
      return { blockedReason: null };
    }
  }

  if (
    typeof input.variant.unitCostCents === "number" &&
    input.variant.unitCostCents > input.itemUnitPriceCents
  ) {
    return {
      blockedReason: `${input.providerLabel} bloqueado (anti-pérdida) para ${input.productName}: costo configurado ($${(input.variant.unitCostCents / 100).toFixed(2)}) supera el precio de venta ($${(input.itemUnitPriceCents / 100).toFixed(2)}).`,
    };
  }

  return { blockedReason: null };
}

async function syncActualBilledVariantCost(
  variant: ProductVariantDTO,
  billedUnitCostCents: number
): Promise<void> {
  if (!Number.isFinite(billedUnitCostCents) || billedUnitCostCents <= 0) return;
  if (variant.unitCostCents === billedUnitCostCents) return;
  try {
    await updateVariantAdmin(variant.id, { unitCostCents: billedUnitCostCents });
    const metaMap = await getVariantPricingMetaMap();
    const existing = metaMap[variant.id];
    const existingRounded =
      existing?.exactCostUsd && /^\d+(\.\d+)?$/.test(existing.exactCostUsd.trim())
        ? Math.round(Number.parseFloat(existing.exactCostUsd.trim()) * 100)
        : null;
    if (existingRounded !== billedUnitCostCents) {
      await batchSaveVariantPricingMeta({
        [variant.id]: {
          ...(existing ?? {}),
          previousExactCostUsd: existing?.exactCostUsd ?? null,
          exactCostUsd: (billedUnitCostCents / 100).toFixed(4),
          lastSyncedAt: new Date().toISOString(),
        },
      });
    }
  } catch {
    // Non-fatal post-purchase cost sync
  }
}

type IdempotentFulfillmentParams =
  | {
      orderId: string;
      orderItemId: string;
      userId: string | null;
      source: "reloadly" | "centralone";
      supplierTxId: string | null;
      codePlaintext: string;
      pinPlaintext?: string | null;
      maxQuantity?: number;
    }
  | {
      orderId: string;
      orderItemId: string;
      userId: string | null;
      source: "manual";
      codeInventoryId: string;
      codeCiphertext: string;
      codeLast4: string;
      pinCiphertext?: string | null;
      maxQuantity?: number;
    };

/**
 * Atomically locks each fulfillment slot (per code inventory row or orderItem+code SHA-256)
 * and enforces the item's `maxQuantity` cap so concurrent retries or webhook races
 * can never store duplicate or excess gift cards in the customer's vault.
 */
async function insertFulfillmentIdempotently(
  params: IdempotentFulfillmentParams
): Promise<boolean> {
  const isManual = params.source === "manual";
  const lockGateway = isManual ? "manual_code_lock" : "supplier_code_lock";
  const lockEventId = isManual
    ? `${params.orderItemId}:${params.codeInventoryId}`
    : `${params.orderItemId}:${crypto
        .createHash("sha256")
        .update(params.codePlaintext.trim(), "utf8")
        .digest("hex")}`;

  const last4 = isManual ? params.codeLast4 : extractLast4(params.codePlaintext);
  const supplierTxId = isManual ? null : params.supplierTxId;

  const lockResult = await recordWebhookEventOnce({
    gateway: lockGateway,
    eventId: lockEventId,
    eventType: isManual ? "manual.code_lock" : "supplier.code_lock",
    orderId: params.orderId,
    gatewayCheckoutId: supplierTxId,
    signatureValid: true,
    payload: {
      source: params.source,
      last4,
      supplierTxId,
    },
  });
  if (lockResult?.isDuplicate) {
    return false;
  }

  try {
    if (typeof params.maxQuantity === "number") {
      const currentCount = await countFulfillmentsForOrderItem(params.orderItemId);
      if (currentCount >= params.maxQuantity) {
        if (lockResult?.recordId) {
          await updateWebhookEventStatus(
            lockResult.recordId,
            "ignored",
            `Order item quantity cap (${params.maxQuantity}) already reached`
          );
        }
        return false;
      }
    }

    await insertFulfillmentRecord({
      orderItemId: params.orderItemId,
      orderId: params.orderId,
      userId: params.userId,
      source: params.source,
      codeInventoryId: isManual ? params.codeInventoryId : null,
      codeCiphertext: isManual ? params.codeCiphertext : encryptCode(params.codePlaintext),
      codeLast4: last4,
      pinCiphertext: isManual
        ? (params.pinCiphertext ?? null)
        : params.pinPlaintext
          ? encryptCode(params.pinPlaintext)
          : null,
      supplierTxId,
    });
    if (lockResult?.recordId) {
      await updateWebhookEventStatus(lockResult.recordId, "processed");
    }
    return true;
  } catch (err) {
    if (lockResult?.recordId) {
      await updateWebhookEventStatus(
        lockResult.recordId,
        "failed",
        err instanceof Error ? err.message : "Failed inserting fulfillment"
      );
    }
    throw err;
  }
}

async function safeUpdateOrderItemTargetStatus(
  orderId: string,
  orderItemId: string,
  patch: {
    supplierReferenceCode?: string | null;
    topupStatus?: "pending" | "processing" | "completed" | "failed" | "refunded";
    topupFailureReason?: string | null;
  }
): Promise<void> {
  if (typeof updateOrderItemTargetStatus !== "function") return;
  await updateOrderItemTargetStatus(orderId, orderItemId, patch).catch(() => {});
}

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
  const orderTargets =
    typeof getOrderItemTargets === "function"
      ? await getOrderItemTargets(order.id).catch(() => ({}))
      : {};
  const reloadlyCfg = await getProviderConfig("reloadly");
  const centralOneCfg = await getProviderConfig("centralone");
  const fazerCardsCfg = await getProviderConfig("fazercards");
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

    const variantMeta = variantLookup.get(item.variantId)?.variant;
    const itemTarget =
      item.targetInfo ??
      (orderTargets as Record<string, typeof item.targetInfo>)[item.id] ??
      null;
    const isDirectTopup = Boolean(itemTarget || variantMeta?.requiresTarget);

    const tryConsumeManualCode = async (row: {
      id: string;
      codeCiphertext: string;
      codeLast4: string;
      pinCiphertext?: string | null;
    }) => {
      const inserted = await insertFulfillmentIdempotently({
        orderItemId: item.id,
        orderId: order.id,
        userId: order.userId,
        source: "manual",
        codeInventoryId: row.id,
        codeCiphertext: row.codeCiphertext,
        codeLast4: row.codeLast4,
        pinCiphertext: row.pinCiphertext,
        maxQuantity: item.quantity,
      });
      if (inserted) {
        delivered += 1;
        anyFulfilledNowOrBefore = true;
        return;
      }
      delivered = Math.min(
        item.quantity,
        Math.max(delivered, await countFulfillmentsForOrderItem(item.id))
      );
    };

    // Step A: consume pre-committed manual codes for this variant (never for direct ID top-ups)
    if (!isDirectTopup) {
      const pool = committedByVariant.get(item.variantId) ?? [];
      while (delivered < item.quantity && pool.length > 0) {
        await tryConsumeManualCode(pool.shift()!);
      }
    }

    // Step B: try claiming additional AVAILABLE manual stock if still needed (never for direct ID top-ups)
    if (
      !isDirectTopup &&
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
          if (c.variantId !== item.variantId || delivered >= item.quantity) continue;
          await tryConsumeManualCode(c);
        }
      } catch {
        // Not enough manual inventory; fall through to Reloadly or MANUAL_REVIEW
      }
    }

    // Step C: optional Reloadly fallback ONLY when enabled & variant configured (never for direct ID top-ups)
    if (
      !isDirectTopup &&
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
          const inserted = await insertFulfillmentIdempotently({
            orderItemId: item.id,
            orderId: order.id,
            userId: order.userId,
            source: "reloadly",
            supplierTxId: deliveredCode.supplierTxId ?? null,
            codePlaintext: deliveredCode.codePlaintext,
            pinPlaintext: deliveredCode.pinPlaintext,
            maxQuantity: item.quantity,
          });
          if (inserted) {
            delivered += 1;
            anyFulfilledNowOrBefore = true;
          } else {
            delivered = Math.min(
              item.quantity,
              Math.max(delivered, await countFulfillmentsForOrderItem(item.id))
            );
            break;
          }
        } catch (err) {
          attentionReasons.push(
            `Reloadly falló para ${item.productName}: ${err instanceof Error ? err.message : "Error desconocido"}`
          );
          break;
        }
      }
    }

    // Step D: Central One / FazerCards API fulfillment (supports both instant & async delivery)
    let itemPendingAsync = false;
    const isFazerSku = isFazerCardsProductId(variantMeta?.centraloneProductId);

    if (
      delivered < item.quantity &&
      isFazerSku &&
      (fazerCardsCfg?.enabled ?? true) &&
      variantMeta &&
      (variantMeta.sourcePriority === "manual_then_centralone" ||
        variantMeta.sourcePriority === "centralone_only") &&
      variantMeta.centraloneProductId
    ) {
      const remaining = item.quantity - delivered;
      const existingFz = (
        await listPendingSupplierOrdersForOrder(order.id, "fazercards")
      ).find((so) => so.orderItemId === item.id && Boolean(so.externalOrderId));

      const marginCheck = existingFz?.externalOrderId
        ? { blockedReason: null }
        : await checkPreBuySupplierMargin({
            providerLabel: "FazerCards",
            productName: item.productName,
            variant: variantMeta,
            itemUnitPriceCents: item.unitPriceCents,
          });

      if (marginCheck.blockedReason) {
        attentionReasons.push(marginCheck.blockedReason);
      } else {
        try {
          const fetchedFz = existingFz?.externalOrderId
            ? await getFazerCardsOrder(existingFz.externalOrderId)
            : null;
          const fzOrder = fetchedFz
            ? {
                ...fetchedFz,
                unitCostCents:
                  fetchedFz.unitCostCents > 0
                    ? fetchedFz.unitCostCents
                    : (existingFz?.supplierUnitCostCents ?? 0),
              }
            : await createFazerCardsGiftCardOrder({
                fazerProductId: variantMeta.centraloneProductId,
                quantity: remaining,
                customIdentifier: `sc-item-${item.id}`,
              });

          const fzStatusNormalized =
            fzOrder.status === "COMPLETED"
              ? "completed"
              : fzOrder.status === "FAILED"
              ? "failed"
              : "processing";

          if (fzOrder.unitCostCents > 0) {
            await updateOrderItemUnitCostCents(item.id, fzOrder.unitCostCents);
            await syncActualBilledVariantCost(variantMeta, fzOrder.unitCostCents);
          }
          invalidateFazerCardsBalanceCache();

          if (fzOrder.codes.length > 0) {
            let skippedDuplicate = false;
            for (const codeText of fzOrder.codes.slice(0, item.quantity)) {
              const inserted = await insertFulfillmentIdempotently({
                orderItemId: item.id,
                orderId: order.id,
                userId: order.userId,
                source: "centralone",
                supplierTxId: fzOrder.externalOrderId,
                codePlaintext: codeText,
                maxQuantity: item.quantity,
              });
              if (inserted) {
                delivered += 1;
                anyFulfilledNowOrBefore = true;
              } else {
                skippedDuplicate = true;
              }
            }
            if (skippedDuplicate) {
              const freshOrder = await getOrderById(order.id);
              const freshCount =
                freshOrder?.fulfillments.filter((f) => f.orderItemId === item.id)
                  .length ?? delivered;
              delivered = Math.min(item.quantity, Math.max(delivered, freshCount));
              if (delivered > 0) anyFulfilledNowOrBefore = true;
            }
          }

          await upsertSupplierOrder({
            orderId: order.id,
            orderItemId: item.id,
            provider: "fazercards",
            idempotencyKey: existingFz?.idempotencyKey ?? `sc-item-${item.id}`,
            externalOrderId: fzOrder.externalOrderId,
            referenceCode: fzOrder.rawOrderId,
            status: fzStatusNormalized,
            expectedQty: remaining,
            deliveredCount: Math.min(remaining, Math.max(fzOrder.codes.length, delivered)),
            supplierUnitCostCents: fzOrder.unitCostCents,
            rawPayload: fzOrder.rawResponse,
          });

          if (delivered < item.quantity && fzOrder.status === "PENDING") {
            itemPendingAsync = true;
            hasPendingAsyncSupplier = true;
          } else if (delivered < item.quantity && fzOrder.status === "FAILED") {
            attentionReasons.push(
              `FazerCards devolvió estado FAILED para ${item.productName}${fzOrder.failReason ? ` (${fzOrder.failReason})` : ""}.`
            );
          }
        } catch (err) {
          attentionReasons.push(
            `FazerCards falló para ${item.productName}: ${err instanceof Error ? err.message : "Error desconocido"}`
          );
        }
      }
    } else if (
      delivered < item.quantity &&
      !isFazerSku &&
      centralOneCfg?.enabled &&
      variantMeta &&
      (variantMeta.sourcePriority === "manual_then_centralone" ||
        variantMeta.sourcePriority === "centralone_only") &&
      variantMeta.centraloneProductId
    ) {
      const remaining = item.quantity - delivered;
      const existingC1 = (
        await listPendingSupplierOrdersForOrder(order.id, "centralone")
      ).find((so) => so.orderItemId === item.id && Boolean(so.externalOrderId));

      const marginCheck = existingC1?.externalOrderId
        ? { blockedReason: null }
        : await checkPreBuySupplierMargin({
            providerLabel: "Central One",
            productName: item.productName,
            variant: variantMeta,
            itemUnitPriceCents: item.unitPriceCents,
          });

      if (isDirectTopup && (!itemTarget || Object.keys(itemTarget.payload ?? {}).length === 0)) {
        attentionReasons.push(
          `Faltan los datos del jugador (ID/Servidor) para ejecutar la recarga directa de ${item.productName}.`
        );
      } else if (marginCheck.blockedReason) {
        attentionReasons.push(marginCheck.blockedReason);
      } else {
        try {
          const c1Order = existingC1?.externalOrderId
            ? await getCentralOneOrder(existingC1.externalOrderId)
            : await createCentralOneOrder({
                idempotencyKey: `sc-item-${item.id}`,
                catalogItemId: variantMeta.centraloneProductId,
                quantity: remaining,
                externalReference: `${order.orderNumber}:${item.id}`,
                ...(isDirectTopup && itemTarget
                  ? {
                      targetPayload: itemTarget.payload,
                      expectedUnitPrice:
                        item.unitPriceCents > 1
                          ? (item.unitPriceCents - 1) / 100
                          : undefined,
                    }
                  : {}),
              });

          const effectiveDeliveredFromC1 = isDirectTopup
            ? c1Order.status === "completed" || c1Order.status === "delivered"
              ? remaining
              : Math.min(remaining, c1Order.completedLineCount ?? 0)
            : c1Order.deliveredCount;

          await upsertSupplierOrder({
            orderId: order.id,
            orderItemId: item.id,
            provider: "centralone",
            idempotencyKey: existingC1?.idempotencyKey ?? `sc-item-${item.id}`,
            externalOrderId: c1Order.externalOrderId,
            referenceCode: c1Order.referenceCode,
            status: c1Order.status,
            expectedQty: remaining,
            deliveredCount: effectiveDeliveredFromC1,
            supplierUnitCostCents: c1Order.unitCostCents,
            rawPayload: c1Order.raw,
          });
          if (c1Order.unitCostCents && c1Order.unitCostCents > 0) {
            await updateOrderItemUnitCostCents(item.id, c1Order.unitCostCents);
            await syncActualBilledVariantCost(variantMeta, c1Order.unitCostCents);
          }
          invalidateCentralOneBalanceCache();

          if (isDirectTopup) {
            // Direct ID top-ups do NOT return PINs via /orders/{id}/codes (`delivered_count === 0`).
            // Delivery is confirmed exclusively by Central One order/item status ("completed").
            if (
              c1Order.status === "completed" ||
              c1Order.status === "delivered" ||
              (c1Order.completedLineCount ?? 0) >= remaining
            ) {
              delivered = item.quantity;
              anyFulfilledNowOrBefore = true;
              await safeUpdateOrderItemTargetStatus(order.id, item.id, {
                supplierReferenceCode: c1Order.referenceCode ?? c1Order.externalOrderId,
                topupStatus: "completed",
                topupFailureReason: null,
              }).catch(() => {});
            } else if (isCentralOnePendingStatus(c1Order.status)) {
              itemPendingAsync = true;
              hasPendingAsyncSupplier = true;
              await safeUpdateOrderItemTargetStatus(order.id, item.id, {
                supplierReferenceCode: c1Order.referenceCode ?? c1Order.externalOrderId,
                topupStatus: "processing",
                topupFailureReason: null,
              }).catch(() => {});
            } else if (isCentralOnePartialStatus(c1Order.status)) {
              const completedUnits = Math.min(remaining, c1Order.completedLineCount ?? 0);
              if (completedUnits > 0) {
                delivered = Math.min(item.quantity, delivered + completedUnits);
                anyFulfilledNowOrBefore = true;
              }
              await safeUpdateOrderItemTargetStatus(order.id, item.id, {
                supplierReferenceCode: c1Order.referenceCode ?? c1Order.externalOrderId,
                topupStatus: "failed",
                topupFailureReason: c1Order.failureReason ?? "Entrega parcial en recarga directa.",
              }).catch(() => {});
              attentionReasons.push(
                `Central One completó parcialmente la recarga directa (${delivered}/${item.quantity}) para ${item.productName}${c1Order.failureReason ? `: ${c1Order.failureReason}` : ""}.`
              );
            } else {
              const failStatus = c1Order.status === "refunded" ? "refunded" : "failed";
              await safeUpdateOrderItemTargetStatus(order.id, item.id, {
                supplierReferenceCode: c1Order.referenceCode ?? c1Order.externalOrderId,
                topupStatus: failStatus,
                topupFailureReason: c1Order.failureReason ?? c1Order.status,
              }).catch(() => {});
              attentionReasons.push(
                `Central One no pudo acreditar la recarga directa para ${item.productName} (${c1Order.failureReason ?? c1Order.status})${c1Order.refunded ? " · Saldo liberado automáticamente en Central One." : "."}`
              );
            }
          } else {
            const existingC1Count = order.fulfillments.filter(
              (f) => f.orderItemId === item.id && f.source === "centralone"
            ).length;

            if (
              isCentralOneReadyStatus(c1Order.status) ||
              c1Order.deliveredCount > existingC1Count
            ) {
              const codesRes = await fetchCentralOneCodesSafe(
                c1Order.externalOrderId
              );
              if (!codesRes.ready) {
                if (delivered < item.quantity) {
                  itemPendingAsync = true;
                  hasPendingAsyncSupplier = true;
                }
              } else {
                let skippedDuplicate = false;
                for (const c of codesRes.codes.slice(0, item.quantity)) {
                  const inserted = await insertFulfillmentIdempotently({
                    orderItemId: item.id,
                    orderId: order.id,
                    userId: order.userId,
                    source: "centralone",
                    supplierTxId: c1Order.externalOrderId,
                    codePlaintext: c.codePlaintext,
                    pinPlaintext: c.pinPlaintext,
                    maxQuantity: item.quantity,
                  });
                  if (inserted) {
                    delivered += 1;
                    anyFulfilledNowOrBefore = true;
                  } else {
                    skippedDuplicate = true;
                  }
                }
                if (skippedDuplicate) {
                  const freshOrder = await getOrderById(order.id);
                  const freshCount =
                    freshOrder?.fulfillments.filter((f) => f.orderItemId === item.id)
                      .length ?? delivered;
                  delivered = Math.min(item.quantity, Math.max(delivered, freshCount));
                  if (delivered > 0) anyFulfilledNowOrBefore = true;
                }

                if (delivered < item.quantity) {
                  if (isCentralOnePartialStatus(c1Order.status)) {
                    attentionReasons.push(
                      `Central One entregó parcialmente (${delivered}/${item.quantity}) para ${item.productName}${c1Order.failureReason ? `: ${c1Order.failureReason}` : ""}.`
                    );
                  } else {
                    itemPendingAsync = true;
                    hasPendingAsyncSupplier = true;
                  }
                }
              }
            } else if (isCentralOnePendingStatus(c1Order.status)) {
              itemPendingAsync = true;
              hasPendingAsyncSupplier = true;
            } else {
              attentionReasons.push(
                `Central One devolvió estado "${c1Order.status}" para ${item.productName}${c1Order.failureReason ? ` (${c1Order.failureReason})` : ""}.`
              );
            }
          }
        } catch (err) {
          if (isDirectTopup) {
            await safeUpdateOrderItemTargetStatus(order.id, item.id, {
              topupStatus: "failed",
              topupFailureReason:
                err instanceof Error ? err.message : "Error desconocido",
            }).catch(() => {});
          }
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
    const movedToDelivered = await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["FULFILLING"],
      nextStatus: "DELIVERED",
      needsAttention: false,
      attentionReason: null,
    });
    if (movedToDelivered) {
      const latestDeliveredOrder = (await getOrderById(order.id)) ?? order;
      const totalDelivered = latestDeliveredOrder.items.reduce(
        (acc, it) => acc + it.quantity,
        0
      );
      const directTopupSummaries = latestDeliveredOrder.items
        .filter((it) => Boolean(it.targetInfo))
        .map((it) => ({
          productName: it.productName,
          denominationLabel: it.denominationLabel,
          targetSummary: it.targetInfo!.displaySummary,
          referenceCode: it.targetInfo?.supplierReferenceCode ?? null,
        }));
      await sendOrderReadyEmail({
        to: order.email,
        orderId: order.id,
        orderNumber: order.orderNumber,
        itemCount: totalDelivered,
        directTopupSummaries,
      }).catch(() => {});
    }
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
  txReference?: string | null;
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
        txReference: params.txReference,
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
  let liveZenoTransactions = extractZenoTransactionsFromPayload(event.rawPayload);
  if (!options?.skipRemoteDoubleCheck) {
    const gateway = getPaymentGateway(event.gateway);
    const liveCheckout = await gateway.getCheckout(event.checkoutId);
    authoritativeStatus = liveCheckout.status;
    authoritativePaidCents = liveCheckout.paidCents;
    authoritativeExpiresAt = liveCheckout.expiresAt ?? authoritativeExpiresAt;
    if (liveCheckout.transactions && liveCheckout.transactions.length > 0) {
      liveZenoTransactions = liveCheckout.transactions;
    }
  }
  const zenoTxTag =
    event.gateway === "zenobank"
      ? formatZenoTransactionsTag(liveZenoTransactions, event.checkoutId)
      : null;
  const txSuffix = zenoTxTag ? ` · ${zenoTxTag}` : "";

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
    // Before expiring a ZenoBank order with $0 reported by ZenoBank, check if the customer sent an overpayment/deposit directly in Binance Pay
    if (
      event.gateway === "zenobank" &&
      authoritativeStatus !== "CANCELLED" &&
      authoritativePaidCents < matchedOrder.amountDueCents
    ) {
      const autoBinance = await autoReconcileBinancePayForOrder({
        orderId: matchedOrder.id,
        source: "webhook_expiry_check",
        minAgeMs: 0,
      }).catch(() => null);

      if (autoBinance?.matched) {
        await updateWebhookEventStatus(recordId, "processed");
        return {
          outcome:
            autoBinance.mode === "fulfilled"
              ? "delivered_or_fulfilling"
              : autoBinance.mode === "partial_credited"
                ? "partial_underpaid_credited"
                : "partial_pending",
          orderId: matchedOrder.id,
        };
      }
    }

    if (authoritativePaidCents > 0 || matchedOrder.creditAppliedCents > 0) {
      await settleUnderpaymentToCredit({
        order: matchedOrder,
        paidCents: authoritativePaidCents,
        note:
          authoritativePaidCents > 0
            ? `Pago parcial recibido tras expiración (${matchedOrder.orderNumber})${txSuffix}`
            : `Devolución de saldo aplicado por orden expirada (${matchedOrder.orderNumber})`,
        needsAttention: false,
        attentionReason: null,
        txReference: authoritativePaidCents > 0 ? zenoTxTag : null,
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
          ? `Pago parcial recibido al vencer enlace (${matchedOrder.orderNumber})${txSuffix}`
          : `Monto recibido menor al total en orden ${matchedOrder.orderNumber}${txSuffix}`,
        needsAttention:
          event.eventType === "checkout.completed" ||
          authoritativeStatus === "COMPLETED",
        attentionReason: `Pago insuficiente: pagado ${authoritativePaidCents} vs esperado ${matchedOrder.amountDueCents}${txSuffix}`,
        txReference: zenoTxTag,
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
      note: `Excedente pagado en orden ${matchedOrder.orderNumber}${txSuffix}`,
      createdBy: null,
    });
    await sendCreditAdjustmentEmail({
      to: matchedOrder.email,
      orderNumber: matchedOrder.orderNumber,
      amountCents: surplusCents,
      reasonText:
        matchedOrder.paymentGateway === "pagomovil" ||
        matchedOrder.paymentGateway === "pablito"
          ? "Excedente enviado en tu Pago Móvil"
          : "Excedente enviado en tu pago cripto",
      txReference: zenoTxTag,
    }).catch(() => {});
  }

  await fulfillOrder(matchedOrder.id);
  return { outcome: "delivered_or_fulfilling", orderId: matchedOrder.id };
}

/**
 * Reconciles a freshly polled gateway checkout session (e.g. ZenoBank) against an order,
 * including OPEN checkouts where a partial transfer just arrived (`paidCents > order.paidCents`).
 */
export async function reconcileGatewaySession(params: {
  order: OrderDTO;
  session: GatewayCheckoutSession;
  source: string;
}): Promise<{ reconciled: boolean; outcome?: string }> {
  const { order, session, source } = params;
  const hasNewPartialPayment =
    session.status === "OPEN" && session.paidCents > order.paidCents;

  // When ZenoBank hasn't detected the full payment (e.g. customer sent extra / overpaid in Binance Pay),
  // check Binance Pay directly via API Key + Secret Key before leaving it open or expiring it.
  if (
    order.paymentGateway === "zenobank" &&
    session.status !== "COMPLETED" &&
    session.status !== "CANCELLED" &&
    session.paidCents < order.amountDueCents
  ) {
    const autoBinance = await autoReconcileBinancePayForOrder({
      orderId: order.id,
      source: "auto_poll_reconcile",
      minAgeMs: session.status === "EXPIRED" ? 0 : 8_000,
    }).catch(() => null);

    if (autoBinance?.matched) {
      return {
        reconciled: true,
        outcome:
          autoBinance.mode === "fulfilled"
            ? "delivered_or_fulfilling"
            : autoBinance.mode === "partial_credited"
              ? "partial_underpaid_credited"
              : "partial_pending",
      };
    }
  }

  if (
    session.status !== "COMPLETED" &&
    session.status !== "PARTIALLY_PAID" &&
    session.status !== "EXPIRED" &&
    session.status !== "CANCELLED" &&
    !hasNewPartialPayment
  ) {
    return { reconciled: false };
  }

  const eventType: NormalizedPaymentWebhookEvent["eventType"] =
    session.status === "COMPLETED"
      ? "checkout.completed"
      : session.status === "PARTIALLY_PAID" || hasNewPartialPayment
        ? "checkout.partially_paid"
        : "checkout.expired";

  const expiredTag =
    session.expiresAt && Date.now() >= Date.parse(session.expiresAt)
      ? "exp"
      : "open";

  const res = await processVerifiedWebhookEvent(
    {
      gateway: order.paymentGateway,
      eventId: `${source}:${order.gatewayCheckoutId ?? order.id}:${session.status}:${session.paidCents}:${expiredTag}`,
      eventType,
      orderId: order.id,
      checkoutId: order.gatewayCheckoutId ?? session.checkoutId,
      priceCents: session.priceCents,
      paidCents: session.paidCents,
      status: session.status,
      expiresAt: session.expiresAt,
      rawPayload: { source, liveSession: session, session },
    },
    { skipRemoteDoubleCheck: true }
  );

  return { reconciled: true, outcome: res.outcome };
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

  // Never refund more than what the customer actually funded (`paidCents + creditAppliedCents`)
  const actuallyFundedCents = Math.max(0, order.paidCents + order.creditAppliedCents);
  const refundCents = Math.min(
    order.subtotalCents,
    actuallyFundedCents,
    undeliveredCents > 0 ? undeliveredCents : actuallyFundedCents
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
    expectedStatuses: [
      "PAID",
      "FULFILLING",
      "PARTIAL",
      "MANUAL_REVIEW",
      "EXPIRED",
      ...(actuallyFundedCents > 0 ? (["PENDING_PAYMENT"] as const) : []),
    ],
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

async function applyZenoUsdReceiptToOrder(params: {
  order: OrderDTO;
  totalPaidCents: number;
  txTag: string | null;
  cleanTx: string | null;
  actorUser: SessionUser | null;
  auditActionPrefix: string;
  forceCreditIfExpiredOlderThan24h?: boolean;
}): Promise<{
  mode: "fulfilled" | "partial_pending" | "partial_credited";
  receivedCents: number;
  missingCents: number;
  surplusCents: number;
  nextStatus: OrderDTO["status"];
  order: OrderDTO;
}> {
  const { order, totalPaidCents, txTag, cleanTx, actorUser, auditActionPrefix } = params;
  const txSuffix = txTag ? ` · ${txTag}` : "";

  const expiredOlderThan24h =
    Boolean(params.forceCreditIfExpiredOlderThan24h) &&
    order.status === "EXPIRED" &&
    Date.now() - Date.parse(order.createdAt) > 24 * 3600_000;

  if (totalPaidCents < order.amountDueCents || expiredOlderThan24h) {
    const missingCents = Math.max(0, order.amountDueCents - totalPaidCents);

    if (order.status === "EXPIRED") {
      await settleUnderpaymentToCredit({
        order,
        paidCents: totalPaidCents,
        note: expiredOlderThan24h
          ? `Pago Binance Pay recibido tras expiración (>24h) (${order.orderNumber})${txSuffix}`
          : `Pago parcial Binance/ZenoBank conciliado (${order.orderNumber})${txSuffix}`,
        needsAttention: false,
        attentionReason: null,
        txReference: txTag,
      });
      await appendAuditLog({
        actorId: actorUser?.id ?? null,
        actorRole: actorUser?.role ?? "customer",
        action: `${auditActionPrefix}_credited`,
        targetType: "order",
        targetId: order.id,
        metadata: {
          receivedCents: totalPaidCents,
          expectedCents: order.amountDueCents,
          missingCents,
          txReference: cleanTx,
        },
      });
      const updated = (await getOrderById(order.id)) ?? order;
      return {
        mode: "partial_credited",
        receivedCents: totalPaidCents,
        missingCents,
        surplusCents: 0,
        nextStatus: updated.status,
        order: updated,
      };
    }

    if (totalPaidCents <= order.paidCents) {
      throw new Error(
        `El monto total (${(totalPaidCents / 100).toFixed(2)} USD) debe superar los ${(order.paidCents / 100).toFixed(2)} USD ya registrados.`
      );
    }

    await updateOrderPartialPaymentCents(order.id, totalPaidCents);
    await appendAuditLog({
      actorId: actorUser?.id ?? null,
      actorRole: actorUser?.role ?? "customer",
      action: `${auditActionPrefix}_partial`,
      targetType: "order",
      targetId: order.id,
      metadata: {
        receivedCents: totalPaidCents,
        expectedCents: order.amountDueCents,
        missingCents,
        txReference: cleanTx,
      },
    });
    const updated = (await getOrderById(order.id)) ?? order;
    return {
      mode: "partial_pending",
      receivedCents: totalPaidCents,
      missingCents,
      surplusCents: 0,
      nextStatus: updated.status,
      order: updated,
    };
  }

  let transitioned = false;
  if (order.status === "PENDING_PAYMENT" || order.status === "CREATED") {
    transitioned = await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["PENDING_PAYMENT", "CREATED"],
      nextStatus: "PAID",
      paidCents: totalPaidCents,
      needsAttention: false,
      attentionReason: null,
    });
  } else if (order.status === "EXPIRED") {
    transitioned = await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["EXPIRED"],
      nextStatus: "MANUAL_REVIEW",
      paidCents: totalPaidCents,
      needsAttention: false,
      attentionReason: null,
    });
  } else if (order.status === "MANUAL_REVIEW") {
    await setOrderPaidCentsForManualReview(order.id, totalPaidCents);
    await markOrderAttentionFlag(order.id, false, null);
    transitioned = true;
  }

  if (!transitioned) {
    throw new Error(
      "No se pudo procesar la orden (ya fue atendida o cambió de estado)."
    );
  }

  const surplusCents = totalPaidCents - order.amountDueCents;
  if (surplusCents > 0) {
    const userId = order.userId ?? (await ensureCustomerProfile(order.email));
    await appendCreditLedgerEntry({
      userId,
      orderId: order.id,
      deltaCents: surplusCents,
      reason: "overpayment",
      note: `Excedente pagado en orden ${order.orderNumber}${txSuffix}`,
      createdBy: actorUser?.id ?? null,
    });
    await sendCreditAdjustmentEmail({
      to: order.email,
      orderNumber: order.orderNumber,
      amountCents: surplusCents,
      reasonText: "Excedente verificado en tu pago cripto / Binance Pay",
      txReference: txTag,
    }).catch(() => {});
  }

  await appendAuditLog({
    actorId: actorUser?.id ?? null,
    actorRole: actorUser?.role ?? "customer",
    action: `${auditActionPrefix}_confirm`,
    targetType: "order",
    targetId: order.id,
    metadata: {
      receivedCents: totalPaidCents,
      expectedCents: order.amountDueCents,
      surplusCents,
      txReference: cleanTx,
    },
  });

  const fulfilled = await fulfillOrder(order.id);
  return {
    mode: "fulfilled",
    receivedCents: totalPaidCents,
    missingCents: 0,
    surplusCents,
    nextStatus: fulfilled.status,
    order: fulfilled,
  };
}

export async function adminRecordManualZenoPayment(params: {
  orderId: string;
  receivedCents: number;
  txReference?: string | null;
  adminUser: SessionUser;
}): Promise<{
  mode: "fulfilled" | "partial_pending" | "partial_credited";
  receivedCents: number;
  missingCents: number;
  surplusCents: number;
  nextStatus: OrderDTO["status"];
}> {
  if (!Number.isInteger(params.receivedCents) || params.receivedCents <= 0) {
    throw new Error("El monto recibido debe ser mayor a $0.00 USD.");
  }

  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Orden no encontrada.");
  if (order.paymentGateway !== "zenobank") {
    throw new Error("Esta orden no utiliza pasarela ZenoBank / Binance.");
  }
  if (
    order.status === "DELIVERED" ||
    order.status === "REFUNDED_CREDIT" ||
    order.status === "CANCELLED"
  ) {
    throw new Error(
      `No se puede registrar pago manual en estado ${order.status}.`
    );
  }

  const cleanTx = params.txReference?.trim() || null;
  const txTag = cleanTx ? `TX ${cleanTx}` : null;
  const result = await applyZenoUsdReceiptToOrder({
    order,
    totalPaidCents: params.receivedCents,
    txTag,
    cleanTx,
    actorUser: params.adminUser,
    auditActionPrefix: "order.admin_manual_zeno",
  });

  return {
    mode: result.mode,
    receivedCents: result.receivedCents,
    missingCents: result.missingCents,
    surplusCents: result.surplusCents,
    nextStatus: result.nextStatus,
  };
}

export class BinancePayVerifyError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BinancePayVerifyError";
    this.status = status;
  }
}

async function resolveConfiguredBinanceReceiverNumericId(): Promise<string | null> {
  const rec = await getZenoBinanceReceiver().catch(() => null);
  const acc = rec?.binanceAccount?.trim() ?? "";
  return /^\d{5,20}$/.test(acc) ? acc : null;
}

export async function listRecentBinancePayCandidatesForOrder(orderId: string): Promise<{
  receiverBinanceId: string | null;
  deposits: Array<BinancePayIncomingTx & { alreadyUsed: boolean }>;
}> {
  const order = await getOrderById(orderId);
  if (!order) {
    throw new BinancePayVerifyError("Orden no encontrada.", 404);
  }
  if (order.paymentGateway !== "zenobank") {
    throw new BinancePayVerifyError(
      "Esta orden no utiliza ZenoBank / Binance Pay.",
      400
    );
  }

  const receiverBinanceId = await resolveConfiguredBinanceReceiverNumericId();
  const createdMs = Date.parse(order.createdAt);
  const startTimeMs = Number.isFinite(createdMs)
    ? createdMs - 10 * 60_000
    : Date.now() - 24 * 3600_000;

  const list = await fetchBinancePayIncomingTransactions({
    startTimeMs,
    limit: 30,
    expectedReceiverBinanceId: receiverBinanceId,
  });

  const consumed = await findConsumedBinancePayTxIds(
    list.map((tx) => tx.transactionId)
  );

  return {
    receiverBinanceId,
    deposits: list.map((tx) => ({
      ...tx,
      alreadyUsed: consumed.has(tx.transactionId.trim().toUpperCase()),
    })),
  };
}

export async function applyVerifiedBinancePayTxToOrder(params: {
  orderId: string;
  transactionId: string;
  actorUser?: SessionUser | null;
  source: "customer_tx_verify" | "admin_tx_verify";
}) {
  const order = await getOrderById(params.orderId);
  if (!order) {
    throw new BinancePayVerifyError("Orden no encontrada.", 404);
  }
  if (order.paymentGateway !== "zenobank") {
    throw new BinancePayVerifyError(
      "Esta orden no usa ZenoBank / Binance Pay.",
      400
    );
  }
  if (
    order.status === "DELIVERED" ||
    order.status === "REFUNDED_CREDIT" ||
    order.status === "CANCELLED"
  ) {
    throw new BinancePayVerifyError(
      `Esta orden ya está en estado ${order.status}.`,
      409
    );
  }

  const expectedReceiverBinanceId =
    await resolveConfiguredBinanceReceiverNumericId();
  const tx = await findBinancePayTransactionForOrder({
    txId: params.transactionId,
    orderCreatedAtIso: order.createdAt,
    expectedReceiverBinanceId,
  });

  if (!tx) {
    throw new BinancePayVerifyError(
      "No encontramos un depósito entrante USD (USDT/USDC/FDUSD) en Binance Pay con ese ID para esta orden. Revisa el ID de transacción y que se haya enviado tras crear la orden.",
      404
    );
  }

  const consumed = await findConsumedBinancePayTxIds([tx.transactionId]);
  if (consumed.has(tx.transactionId.trim().toUpperCase())) {
    throw new BinancePayVerifyError(
      `La transacción ${tx.transactionId} ya fue aplicada anteriormente.`,
      409
    );
  }

  const receiverInfo = await getZenoBinanceReceiver().catch(() => null);
  const { isDuplicate, recordId } = await recordWebhookEventOnce({
    gateway: "zenobank",
    eventId: `binance_pay_tx:${tx.transactionId.trim().toUpperCase()}`,
    eventType: "binance_pay.verified",
    orderId: order.id,
    gatewayCheckoutId: order.gatewayCheckoutId ?? order.id,
    signatureValid: true,
    payload: {
      source: params.source,
      data: {
        id: order.gatewayCheckoutId ?? order.id,
        transactions: [
          {
            uid: tx.orderId || tx.transactionId,
            transactionId: tx.transactionId,
            networkId: "BINANCE_PAY",
            tokenId: `${tx.currency}_BINANCE_PAY`,
            tokenAmount: tx.amount,
            from: tx.counterpartyId,
            fromLabel: tx.payerName,
            to: tx.receiverBinanceId,
            toLabel: receiverInfo?.label ?? null,
            createdAt: tx.createdAt,
          },
        ],
      },
    },
  });

  if (isDuplicate) {
    throw new BinancePayVerifyError(
      `La transacción ${tx.transactionId} ya fue aplicada.`,
      409
    );
  }

  const totalPaidCents = order.paidCents + tx.usdCents;
  const txTag = `TX ${tx.transactionId} (${tx.amount} ${tx.currency} · BINANCE_PAY)`;

  try {
    const applied = await applyZenoUsdReceiptToOrder({
      order,
      totalPaidCents,
      txTag,
      cleanTx: tx.transactionId,
      actorUser: params.actorUser ?? null,
      auditActionPrefix:
        params.source === "admin_tx_verify"
          ? "order.admin_binance_pay"
          : "order.customer_binance_pay",
      forceCreditIfExpiredOlderThan24h: params.source === "customer_tx_verify",
    });

    await updateWebhookEventStatus(recordId, "processed");
    return {
      ...applied,
      tx,
    };
  } catch (err) {
    await updateWebhookEventStatus(
      recordId,
      "failed",
      err instanceof Error ? err.message : "Failed applying Binance Pay TX"
    );
    throw err;
  }
}

export async function autoReconcileBinancePayForOrder(params: {
  orderId: string;
  actorUser?: SessionUser | null;
  source?:
    | "auto_poll_reconcile"
    | "customer_auto_verify"
    | "admin_tx_verify"
    | "cron_auto_reconcile"
    | "webhook_expiry_check";
  minAgeMs?: number;
}): Promise<
  | { matched: false; reason: string }
  | {
      matched: true;
      mode: "fulfilled" | "partial_pending" | "partial_credited";
      receivedCents: number;
      missingCents: number;
      surplusCents: number;
      nextStatus: OrderDTO["status"];
      order: OrderDTO;
      tx: BinancePayIncomingTx;
    }
> {
  if (!isBinancePayConfigured() && process.env.NODE_ENV !== "test") {
    return { matched: false, reason: "not_configured" };
  }

  const order = await getOrderById(params.orderId);
  if (!order) {
    return { matched: false, reason: "order_not_found" };
  }
  if (order.paymentGateway !== "zenobank") {
    return { matched: false, reason: "not_zenobank" };
  }
  if (
    order.status !== "PENDING_PAYMENT" &&
    order.status !== "CREATED" &&
    order.status !== "EXPIRED"
  ) {
    return { matched: false, reason: `status_${order.status}` };
  }

  const orderCreatedMs = Date.parse(order.createdAt);
  if (
    order.status === "EXPIRED" &&
    Number.isFinite(orderCreatedMs) &&
    Date.now() - orderCreatedMs > 24 * 3600_000
  ) {
    return { matched: false, reason: "expired_too_old" };
  }

  const remainingDueCents = Math.max(0, order.amountDueCents - order.paidCents);
  if (remainingDueCents <= 0) {
    return { matched: false, reason: "already_paid" };
  }

  const minTxTimeMs = Number.isFinite(orderCreatedMs)
    ? orderCreatedMs - 15_000
    : Date.now() - 3600_000;
  const orderExpiresMs =
    order.expiresAt && Number.isFinite(Date.parse(order.expiresAt))
      ? Date.parse(order.expiresAt)
      : (Number.isFinite(orderCreatedMs) ? orderCreatedMs : Date.now()) +
        60 * 60_000;
  const maxTxTimeMs = orderExpiresMs + 20 * 60_000;

  const expectedReceiverBinanceId =
    await resolveConfiguredBinanceReceiverNumericId();

  const incomingList = await fetchBinancePayIncomingTransactions({
    startTimeMs: minTxTimeMs,
    limit: 50,
    expectedReceiverBinanceId,
  });

  const windowTxs = incomingList.filter(
    (tx) =>
      tx.usdCents > 0 &&
      tx.transactionTime >= minTxTimeMs &&
      tx.transactionTime <= maxTxTimeMs
  );

  if (windowTxs.length === 0) {
    return { matched: false, reason: "no_tx_in_window" };
  }

  const allTokens: string[] = [];
  for (const tx of windowTxs) {
    allTokens.push(tx.transactionId);
    if (tx.orderId) allTokens.push(tx.orderId);
  }
  const [consumed, recentZenoOrders] = await Promise.all([
    findConsumedBinancePayTxIds(allTokens),
    listOrdersAdmin()
      .then((list) => list.filter((o) => o.paymentGateway === "zenobank"))
      .catch(() => [] as OrderDTO[]),
  ]);

  const unconsumed = windowTxs
    .filter((tx) => {
      const txIdUp = tx.transactionId.trim().toUpperCase();
      const ordIdUp = tx.orderId.trim().toUpperCase();
      if (consumed.has(txIdUp) || (ordIdUp && consumed.has(ordIdUp))) {
        return false;
      }

      // Guard against historical orders manually confirmed by admin without a saved txReference
      const claimedByManualConfirmOrder = recentZenoOrders.some((other) => {
        if (other.id === order.id) return false;
        if (
          other.status !== "DELIVERED" &&
          other.status !== "PAID" &&
          other.status !== "FULFILLING" &&
          other.status !== "PARTIAL"
        ) {
          return false;
        }
        if (other.paidCents !== tx.usdCents) return false;
        const otherCreatedMs = Date.parse(other.createdAt);
        const otherUpdatedMs = Date.parse(other.updatedAt);
        if (!Number.isFinite(otherCreatedMs)) return false;
        const inOtherWindow =
          tx.transactionTime >= otherCreatedMs - 15_000 &&
          (!Number.isFinite(otherUpdatedMs) ||
            tx.transactionTime <= otherUpdatedMs + 5 * 60_000);
        if (!inOtherWindow) return false;
        return (
          Math.abs(tx.transactionTime - otherCreatedMs) <=
          Math.abs(tx.transactionTime - orderCreatedMs)
        );
      });

      return !claimedByManualConfirmOrder;
    })
    .sort((a, b) => a.transactionTime - b.transactionTime);

  if (unconsumed.length === 0) {
    return { matched: false, reason: "all_tx_consumed" };
  }

  const emailPrefix = order.email.split("@")[0]?.trim().toLowerCase() ?? "";
  const maxAutoOverpayCents = Math.max(
    remainingDueCents * 5,
    remainingDueCents + 5000
  );

  for (const tx of unconsumed) {
    const ageMs = Math.max(0, Date.now() - tx.transactionTime);
    const isOverpayment = tx.usdCents > remainingDueCents;
    const requiredAgeMs =
      params.minAgeMs === 0
        ? 0
        : isOverpayment
          ? Math.min(params.minAgeMs ?? 3_000, 3_000)
          : (params.minAgeMs ?? 8_000);

    if (ageMs < requiredAgeMs) {
      continue;
    }

    const noteUpper = (tx.note ?? "").toUpperCase();
    const explicitNoteMatch =
      Boolean(order.orderNumber && noteUpper.includes(order.orderNumber.toUpperCase())) ||
      noteUpper.includes(order.id.toUpperCase()) ||
      Boolean(
        order.gatewayCheckoutId &&
          noteUpper.includes(order.gatewayCheckoutId.toUpperCase())
      );

    // Find any other unpaid ZenoBank orders active at the exact timestamp of this transaction
    const concurrentUnpaidOrders = recentZenoOrders.filter((other) => {
      if (other.id === order.id) return false;
      if (
        other.status !== "PENDING_PAYMENT" &&
        other.status !== "CREATED" &&
        !(other.status === "EXPIRED" && other.paidCents < other.amountDueCents)
      ) {
        return false;
      }
      const ocMs = Date.parse(other.createdAt);
      const oeMs =
        other.expiresAt && Number.isFinite(Date.parse(other.expiresAt))
          ? Date.parse(other.expiresAt)
          : ocMs + 60 * 60_000;
      return (
        Number.isFinite(ocMs) &&
        tx.transactionTime >= ocMs - 15_000 &&
        tx.transactionTime <= oeMs + 15 * 60_000
      );
    });

    const payerLower = (tx.payerName ?? "").trim().toLowerCase();
    const payerMatchesCustomer =
      payerLower.length >= 3 &&
      emailPrefix.length >= 3 &&
      (emailPrefix.includes(payerLower) || payerLower.includes(emailPrefix));

    let isMatch = false;
    if (explicitNoteMatch) {
      isMatch = true;
    } else if (tx.usdCents >= remainingDueCents && tx.usdCents <= maxAutoOverpayCents) {
      if (concurrentUnpaidOrders.length === 0 || payerMatchesCustomer) {
        isMatch = true;
      } else {
        // Disambiguate among concurrent orders by closest covered amountDueCents
        const mySurplus = tx.usdCents - remainingDueCents;
        const closerCompetitor = concurrentUnpaidOrders.some((other) => {
          const otherRem = Math.max(0, other.amountDueCents - other.paidCents);
          if (otherRem <= 0 || tx.usdCents < otherRem) return false;
          const otherSurplus = tx.usdCents - otherRem;
          return otherSurplus <= mySurplus;
        });
        if (!closerCompetitor && mySurplus <= 1000) {
          isMatch = true;
        }
      }
    } else if (
      tx.usdCents > 0 &&
      tx.usdCents < remainingDueCents &&
      tx.usdCents >= Math.min(10, Math.floor(remainingDueCents * 0.1)) &&
      (concurrentUnpaidOrders.length === 0 ||
        payerMatchesCustomer ||
        params.source === "customer_auto_verify" ||
        params.source === "admin_tx_verify")
    ) {
      isMatch = true;
    }

    if (!isMatch) continue;

    const applied = await applyVerifiedBinancePayTxToOrder({
      orderId: order.id,
      transactionId: tx.transactionId,
      actorUser: params.actorUser ?? null,
      source:
        params.source === "admin_tx_verify"
          ? "admin_tx_verify"
          : "customer_tx_verify",
    });

    return {
      matched: true,
      ...applied,
    };
  }

  return { matched: false, reason: "no_unambiguous_match" };
}

function isCentralOneReadyStatus(status: string): boolean {
  return (
    status === "delivered" ||
    status === "completed" ||
    status === "partially_delivered" ||
    status === "partially_completed"
  );
}

function isCentralOnePartialStatus(status: string): boolean {
  return status === "partially_delivered" || status === "partially_completed";
}

function isCentralOnePendingStatus(status: string): boolean {
  return status === "confirmed" || status === "processing" || status === "pending";
}

async function fetchCentralOneCodesSafe(externalOrderId: string) {
  try {
    const codes = await getCentralOneOrderCodes(externalOrderId);
    return { ready: true as const, codes };
  } catch (err) {
    const typed = err as { message?: string; code?: string; httpStatus?: number };
    const message = typed?.message ?? "";
    if (
      typed?.httpStatus === 409 ||
      typed?.code === "codes_not_ready" ||
      message.includes("codes_not_ready") ||
      message.includes("409")
    ) {
      return {
        ready: false as const,
        codes: [] as Awaited<ReturnType<typeof getCentralOneOrderCodes>>,
      };
    }
    throw err;
  }
}

/**
 * Reconciles an asynchronous Central One order against GET /orders/{id} and
 * GET /orders/{id}/codes. Called by /api/webhooks/centralone and /api/cron/reconcile.
 */
export async function syncCentralOneOrderProgress(
  externalOrderOrLookup:
    | string
    | {
        externalOrderId?: string | null;
        referenceCode?: string | null;
        idempotencyKey?: string | null;
      },
  sequenceHint?: number
): Promise<{ ok: boolean; status: string; addedCodes: number }> {
  const lookup =
    typeof externalOrderOrLookup === "string"
      ? { externalOrderId: externalOrderOrLookup }
      : externalOrderOrLookup;
  const rawExternalId = lookup.externalOrderId?.trim() || "";
  const isFazerHint = isFazerCardsProductId(rawExternalId);
  const providers = isFazerHint
    ? ["fazercards", "centralone"]
    : ["centralone", "fazercards"];

  let supplierOrder =
    rawExternalId && typeof getSupplierOrderByExternalId === "function"
      ? await getSupplierOrderByExternalId(providers, rawExternalId)
      : null;
  if (!supplierOrder && typeof getSupplierOrderByIdentifier === "function") {
    supplierOrder = await getSupplierOrderByIdentifier(providers, lookup);
  }
  if (!supplierOrder) {
    return { ok: false, status: "unknown_supplier_order", addedCodes: 0 };
  }

  const externalOrderId = supplierOrder.externalOrderId ?? rawExternalId;
  if (!externalOrderId) {
    return { ok: false, status: "missing_external_order_id", addedCodes: 0 };
  }
  const isFazerOrder =
    supplierOrder.provider === "fazercards" || isFazerCardsProductId(externalOrderId);

  if (
    typeof sequenceHint === "number" &&
    sequenceHint > 0 &&
    sequenceHint <= supplierOrder.lastSequence
  ) {
    return { ok: true, status: "stale_sequence_ignored", addedCodes: 0 };
  }

  const live = isFazerOrder
    ? await (async () => {
        const fz = await getFazerCardsOrder(externalOrderId);
        return {
          status:
            fz.status === "COMPLETED"
              ? "completed"
              : fz.status === "FAILED"
              ? "failed"
              : "processing",
          deliveredCount: fz.codes.length,
          completedLineCount: fz.status === "COMPLETED" ? fz.codes.length : 0,
          failedLineCount: fz.status === "FAILED" ? 1 : 0,
          refunded: false,
          referenceCode: fz.rawOrderId ?? null,
          unitCostCents:
            fz.unitCostCents > 0 ? fz.unitCostCents : supplierOrder.supplierUnitCostCents,
          failureReason: null as string | null,
          raw: fz.rawResponse,
          fazerCodes: fz.codes,
          fazerFailReason: fz.failReason,
        };
      })()
    : await (async () => {
        const c1 = await getCentralOneOrder(externalOrderId);
        return {
          ...c1,
          failureReason: c1.failureReason ?? null,
          fazerCodes: null as string[] | null,
          fazerFailReason: null as string | null,
        };
      })();

  const order = await getOrderById(supplierOrder.orderId);
  if (!order) {
    return { ok: false, status: "order_not_found", addedCodes: 0 };
  }

  const targetItem = order.items.find((it) => it.id === supplierOrder.orderItemId);
  if (!targetItem) {
    return { ok: false, status: "order_item_not_found", addedCodes: 0 };
  }

  const orderTargets =
    typeof getOrderItemTargets === "function"
      ? await getOrderItemTargets(order.id).catch(() => ({}))
      : {};
  const itemTarget =
    targetItem.targetInfo ??
    (orderTargets as Record<string, typeof targetItem.targetInfo>)[targetItem.id] ??
    null;
  const isDirectTopup = Boolean(!isFazerOrder && itemTarget);

  const existingCount = order.fulfillments.filter(
    (f) => f.orderItemId === targetItem.id && f.source === "centralone"
  ).length;

  let addedCodes = 0;
  let skippedDuplicate = false;
  let newDeliveredForItem = targetItem.deliveredCount;

  if (isDirectTopup) {
    if (
      live.status === "completed" ||
      live.status === "delivered" ||
      (live.completedLineCount ?? 0) >= targetItem.quantity
    ) {
      newDeliveredForItem = targetItem.quantity;
      await safeUpdateOrderItemTargetStatus(order.id, targetItem.id, {
        supplierReferenceCode:
          live.referenceCode ?? supplierOrder.referenceCode ?? externalOrderId,
        topupStatus: "completed",
        topupFailureReason: null,
      }).catch(() => {});
    } else if (
      live.status === "failed" ||
      live.status === "cancelled" ||
      live.status === "refunded"
    ) {
      newDeliveredForItem = Math.min(
        targetItem.quantity,
        Math.max(targetItem.deliveredCount, live.completedLineCount ?? 0)
      );
      await safeUpdateOrderItemTargetStatus(order.id, targetItem.id, {
        supplierReferenceCode:
          live.referenceCode ?? supplierOrder.referenceCode ?? externalOrderId,
        topupStatus: live.status === "refunded" ? "refunded" : "failed",
        topupFailureReason: live.failureReason ?? live.status,
      }).catch(() => {});
    } else if (isCentralOnePartialStatus(live.status)) {
      newDeliveredForItem = Math.min(
        targetItem.quantity,
        Math.max(targetItem.deliveredCount, live.completedLineCount ?? 0)
      );
      await safeUpdateOrderItemTargetStatus(order.id, targetItem.id, {
        supplierReferenceCode:
          live.referenceCode ?? supplierOrder.referenceCode ?? externalOrderId,
        topupStatus: "failed",
        topupFailureReason: live.failureReason ?? "Entrega parcial",
      }).catch(() => {});
    } else {
      await safeUpdateOrderItemTargetStatus(order.id, targetItem.id, {
        supplierReferenceCode:
          live.referenceCode ?? supplierOrder.referenceCode ?? externalOrderId,
        topupStatus: "processing",
      }).catch(() => {});
    }
  } else {
    const shouldFetchCodes =
      existingCount < targetItem.quantity &&
      (isCentralOneReadyStatus(live.status) || live.deliveredCount > existingCount);

    if (shouldFetchCodes) {
      const codesRes = live.fazerCodes
        ? {
            ready: true as const,
            codes: live.fazerCodes.map((codePlaintext) => ({
              codePlaintext,
              pinPlaintext: null,
            })),
          }
        : await fetchCentralOneCodesSafe(externalOrderId);

      if (codesRes.ready) {
        for (const c of codesRes.codes.slice(0, targetItem.quantity)) {
          const inserted = await insertFulfillmentIdempotently({
            orderItemId: targetItem.id,
            orderId: order.id,
            userId: order.userId,
            source: "centralone",
            supplierTxId: externalOrderId,
            codePlaintext: c.codePlaintext,
            pinPlaintext: c.pinPlaintext,
            maxQuantity: targetItem.quantity,
          });
          if (inserted) {
            addedCodes += 1;
          } else {
            skippedDuplicate = true;
          }
        }
      }
    }

    let actualItemFulfillments = existingCount + addedCodes;
    if (skippedDuplicate) {
      const afterCodesOrder = await getOrderById(order.id);
      actualItemFulfillments =
        afterCodesOrder?.fulfillments.filter((f) => f.orderItemId === targetItem.id)
          .length ?? actualItemFulfillments;
    }
    const totalCentralOneForItem = Math.min(targetItem.quantity, actualItemFulfillments);
    newDeliveredForItem = Math.min(
      targetItem.quantity,
      Math.max(targetItem.deliveredCount, totalCentralOneForItem)
    );
  }

  const resolvedUnitCost = live.unitCostCents ?? supplierOrder.supplierUnitCostCents;
  await updateSupplierOrderState(supplierOrder.id, {
    status: live.status,
    deliveredCount: Math.min(
      targetItem.quantity,
      Math.max(live.deliveredCount, newDeliveredForItem)
    ),
    supplierUnitCostCents: resolvedUnitCost,
    lastSequence:
      typeof sequenceHint === "number" && sequenceHint > supplierOrder.lastSequence
        ? sequenceHint
        : supplierOrder.lastSequence,
    rawPayload: live.raw,
  });
  if (resolvedUnitCost && resolvedUnitCost > 0) {
    await updateOrderItemUnitCostCents(targetItem.id, resolvedUnitCost);
    try {
      const variantLookup = await getVariantsLookupByIds([targetItem.variantId]);
      const billedVariant = variantLookup?.get?.(targetItem.variantId)?.variant;
      if (billedVariant) {
        await syncActualBilledVariantCost(billedVariant, resolvedUnitCost);
      }
    } catch {
      // Non-fatal variant metadata sync
    }
  }

  const failureNote = live.failureReason ?? live.fazerFailReason ?? null;

  if (
    live.status === "failed" ||
    live.status === "cancelled" ||
    live.status === "refunded"
  ) {
    await markOrderItemProgress(targetItem.id, {
      deliveredCount: newDeliveredForItem,
      status:
        newDeliveredForItem >= targetItem.quantity && live.status !== "refunded"
          ? "FULFILLED"
          : "MANUAL_REVIEW",
    });
    const nextOrderStatus =
      newDeliveredForItem > 0 && live.status !== "refunded"
        ? "PARTIAL"
        : "MANUAL_REVIEW";
    await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["FULFILLING", "PARTIAL", "DELIVERED"],
      nextStatus: nextOrderStatus,
      needsAttention: true,
      attentionReason: `${isFazerOrder ? "FazerCards" : "Central One"} devolvió estado "${live.status}" (orden ${live.referenceCode ?? externalOrderId}${failureNote ? `: ${failureNote}` : ""})${live.refunded ? " · Saldo liberado en Central One." : "."}`,
    });
    return { ok: true, status: live.status, addedCodes };
  }

  if (isCentralOnePartialStatus(live.status) && newDeliveredForItem < targetItem.quantity) {
    await markOrderItemProgress(targetItem.id, {
      deliveredCount: newDeliveredForItem,
      status: "MANUAL_REVIEW",
    });
    await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["FULFILLING", "PARTIAL"],
      nextStatus: newDeliveredForItem > 0 ? "PARTIAL" : "MANUAL_REVIEW",
      needsAttention: true,
      attentionReason: `Central One entregó parcialmente (${newDeliveredForItem}/${targetItem.quantity}) en orden ${live.referenceCode ?? externalOrderId}${failureNote ? `: ${failureNote}` : ""}.`,
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
    const movedToDelivered = await transitionOrderStatus({
      orderId: order.id,
      expectedStatuses: ["FULFILLING", "PARTIAL", "MANUAL_REVIEW"],
      nextStatus: "DELIVERED",
      needsAttention: false,
      attentionReason: null,
    });
    if (movedToDelivered) {
      const directTopupSummaries = refreshed.items
        .filter((it) => Boolean(it.targetInfo))
        .map((it) => ({
          productName: it.productName,
          denominationLabel: it.denominationLabel,
          targetSummary: it.targetInfo!.displaySummary,
          referenceCode: it.targetInfo?.supplierReferenceCode ?? null,
        }));
      await sendOrderReadyEmail({
        to: order.email,
        orderId: order.id,
        orderNumber: order.orderNumber,
        itemCount: refreshed.items.reduce((acc, it) => acc + it.quantity, 0),
        directTopupSummaries,
      }).catch(() => {});
    }
  }

  return { ok: true, status: live.status, addedCodes };
}

export async function syncSupplierOrdersForOrder(
  orderId: string
): Promise<{ checked: number; addedCodes: number }> {
  const pendingSuppliers = await listPendingSupplierOrdersForOrder(orderId, [
    "centralone",
    "fazercards",
  ]);
  let checked = 0;
  let addedCodes = 0;
  for (const so of pendingSuppliers) {
    if (!so.externalOrderId) continue;
    checked += 1;
    const res = await syncCentralOneOrderProgress(so.externalOrderId);
    addedCodes += res.addedCodes;
  }
  return { checked, addedCodes };
}

export async function syncAllPendingSupplierOrders(): Promise<{
  checked: number;
  addedCodes: number;
  errors: number;
}> {
  const pendingSuppliers = await listPendingSupplierOrders([
    "centralone",
    "fazercards",
  ]);
  let checked = 0;
  let addedCodes = 0;
  let errors = 0;
  for (const so of pendingSuppliers) {
    if (!so.externalOrderId) continue;
    checked += 1;
    try {
      const res = await syncCentralOneOrderProgress(so.externalOrderId);
      addedCodes += res.addedCodes;
    } catch {
      errors += 1;
    }
  }
  return { checked, addedCodes, errors };
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

export class CancelOrderError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "CancelOrderError";
    this.code = code;
    this.status = status;
  }
}

export interface CancelOrderResult {
  outcome: "cancelled" | "already_cancelled";
  order: OrderDTO;
  releasedCodesCount: number;
  refundedCreditCents: number;
}

/**
 * Cancels an unpaid PENDING_PAYMENT / CREATED order on behalf of its owner (or admin),
 * atomically releasing any reserved manual codes and refunding applied store credit.
 */
export async function cancelOrderByCustomer(params: {
  orderId: string;
  actorUser: SessionUser | null;
  forceAfterReport?: boolean;
}): Promise<CancelOrderResult> {
  if (!params.actorUser) {
    throw new CancelOrderError(
      "UNAUTHORIZED",
      "Debes iniciar sesión para cancelar esta orden.",
      401
    );
  }

  const order = await getOrderById(params.orderId);
  if (!order) {
    throw new CancelOrderError("ORDER_NOT_FOUND", "Orden no encontrada.", 404);
  }

  const isAuthorized =
    order.userId === params.actorUser.id || params.actorUser.role === "admin";
  if (!isAuthorized) {
    throw new CancelOrderError(
      "FORBIDDEN",
      "No tienes permiso para cancelar esta orden.",
      403
    );
  }

  if (order.status === "CANCELLED") {
    return {
      outcome: "already_cancelled",
      order,
      releasedCodesCount: 0,
      refundedCreditCents: 0,
    };
  }

  if (order.paidCents > 0) {
    throw new CancelOrderError(
      "PARTIAL_PAYMENT_ACTIVE",
      "Esta orden ya tiene un abono parcial registrado. Resuelve la diferencia o solicítalo como saldo a favor.",
      409
    );
  }

  if (order.status !== "PENDING_PAYMENT" && order.status !== "CREATED") {
    throw new CancelOrderError(
      "ORDER_NOT_CANCELLABLE",
      "Solo se pueden cancelar órdenes que aún están pendientes de pago.",
      409
    );
  }

  if (order.paymentGateway === "pagomovil" || order.paymentGateway === "pablito") {
    const matchedNotif = await getMatchedNotificationForOrder(order.id);
    if (matchedNotif) {
      throw new CancelOrderError(
        "PAYMENT_ALREADY_MATCHED",
        "Ya detectamos tu pago bancario para esta orden. Procesando confirmación...",
        409
      );
    }

    const report = await getOrderPagoMovilReport(order.id);
    if (
      report?.reportedReference &&
      !report.lastErrorCode &&
      !params.forceAfterReport
    ) {
      throw new CancelOrderError(
        "REPORTED_REFERENCE_PENDING",
        `Ya reportaste la referencia ${report.reportedReference} y el sistema está verificándola. Confirma si deseas cancelar la orden igualmente.`,
        409
      );
    }
  }

  const transitioned = await transitionOrderStatus({
    orderId: order.id,
    expectedStatuses: ["PENDING_PAYMENT", "CREATED"],
    nextStatus: "CANCELLED",
  });

  if (!transitioned) {
    const latest = await getOrderById(order.id);
    if (latest?.status === "CANCELLED") {
      return {
        outcome: "already_cancelled",
        order: latest,
        releasedCodesCount: 0,
        refundedCreditCents: 0,
      };
    }
    throw new CancelOrderError(
      "ORDER_STATE_CONFLICT",
      "La orden cambió de estado mientras intentabas cancelarla. Actualiza la página.",
      409
    );
  }

  const releasedCodesCount = await releaseReservedCodesForOrder(order.id);

  let refundedCreditCents = 0;
  if (order.creditAppliedCents > 0 && order.userId) {
    await appendCreditLedgerEntry({
      userId: order.userId,
      orderId: order.id,
      deltaCents: order.creditAppliedCents,
      reason: "fulfillment_refund",
      note: `Reembolso de saldo por cancelación de orden ${order.orderNumber}`,
      createdBy: params.actorUser.id,
    });
    refundedCreditCents = order.creditAppliedCents;
  }

  await appendAuditLog({
    actorId: params.actorUser.id,
    actorRole: params.actorUser.role,
    action: "order.cancelled_by_customer",
    targetType: "order",
    targetId: order.id,
    metadata: {
      previousStatus: order.status,
      paymentGateway: order.paymentGateway,
      releasedCodesCount,
      refundedCreditCents,
      forcedAfterReport: Boolean(params.forceAfterReport),
    },
  });

  const updatedOrder =
    (await getOrderById(order.id)) ?? { ...order, status: "CANCELLED" };

  return {
    outcome: "cancelled",
    order: updatedOrder,
    releasedCodesCount,
    refundedCreditCents,
  };
}
