import { describe, expect, it } from "vitest";
import { computeTreasuryPosition } from "@/lib/server/treasury-metrics";
import type { OrderDTO, TreasuryMovementDTO } from "@/types";

function makeOrder(overrides: Partial<OrderDTO> = {}): OrderDTO {
  return {
    id: overrides.id ?? "ord-1",
    orderNumber: overrides.orderNumber ?? "SC-TEST-1",
    userId: null,
    email: "buyer@example.com",
    status: overrides.status ?? "DELIVERED",
    subtotalCents: overrides.subtotalCents ?? 42100,
    creditAppliedCents: overrides.creditAppliedCents ?? 0,
    amountDueCents: overrides.amountDueCents ?? 42100,
    paidCents: overrides.paidCents ?? 42100,
    bsRateCents: overrides.bsRateCents ?? null,
    totalBsCents: overrides.totalBsCents ?? null,
    paymentGateway: overrides.paymentGateway ?? "zenobank",
    gatewayCheckoutId: null,
    gatewayCheckoutUrl: null,
    expiresAt: null,
    needsAttention: false,
    attentionReason: null,
    isTest: overrides.isTest ?? false,
    testNote: overrides.testNote ?? null,
    createdAt: overrides.createdAt ?? "2026-11-15T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-11-15T12:00:00.000Z",
    items: overrides.items ?? [
      {
        id: "item-1",
        orderId: overrides.id ?? "ord-1",
        variantId: "var-1",
        productName: "Netflix USA",
        productSlug: "netflix-us",
        denominationLabel: "$15",
        region: "USA",
        unitPriceCents: 1540,
        unitCostCents: 1460,
        quantity: 27,
        deliveredCount: 27,
        status: "FULFILLED",
      },
    ],
    fulfillments: overrides.fulfillments ?? [],
  };
}

function makeMovement(
  partial: Partial<TreasuryMovementDTO> &
    Pick<
      TreasuryMovementDTO,
      "movementType" | "sourceAccount" | "targetAccount" | "amountUsdCents"
    >
): TreasuryMovementDTO {
  return {
    id: partial.id ?? `mov-${Math.random().toString(36).slice(2, 8)}`,
    occurredAt: partial.occurredAt ?? "2026-11-15T12:00:00.000Z",
    movementType: partial.movementType,
    sourceAccount: partial.sourceAccount,
    targetAccount: partial.targetAccount,
    amountUsdCents: partial.amountUsdCents,
    amountBsCents: partial.amountBsCents ?? null,
    exchangeRateCents: partial.exchangeRateCents ?? null,
    partnerName: partial.partnerName ?? null,
    reference: partial.reference ?? null,
    notes: partial.notes ?? "",
    relatedOrderId: partial.relatedOrderId ?? null,
    voidedAt: partial.voidedAt ?? null,
    voidReason: partial.voidReason ?? null,
    createdBy: null,
    createdAt: partial.createdAt ?? "2026-11-15T12:00:00.000Z",
  };
}

describe("computeTreasuryPosition — exact $400 -> $421 cases & test reconciliation", () => {
  const baseNetflixOrder = makeOrder({
    subtotalCents: 42100,
    paidCents: 42100,
    paymentGateway: "zenobank",
    items: [
      {
        id: "item-nf",
        orderId: "ord-1",
        variantId: "v-nf",
        productName: "Netflix US",
        productSlug: "netflix-us",
        denominationLabel: "Custom Lot",
        region: "USA",
        unitPriceCents: 42100,
        unitCostCents: 40000,
        quantity: 1,
        deliveredCount: 1,
        status: "FULFILLED",
      },
    ],
  });

  const initialSeed = makeMovement({
    movementType: "CAPITAL_IN",
    sourceAccount: "external",
    targetAccount: "fazercards",
    amountUsdCents: 40000,
    notes: "Capital inicial $400",
  });

  it("Caso 1: reinvierte los $421 completos en distribuidores", () => {
    const reinvestAll = makeMovement({
      movementType: "SUPPLIER_TOPUP",
      sourceAccount: "zenobank",
      targetAccount: "fazercards",
      amountUsdCents: 42100,
      occurredAt: "2026-11-15T13:00:00.000Z",
    });

    const pos = computeTreasuryPosition({
      orders: [baseNetflixOrder],
      movements: [initialSeed, reinvestAll],
      suppliers: [
        { id: "fazercards", balanceCents: 42100, enabled: true, configured: true },
        { id: "centralone", balanceCents: 0, enabled: true, configured: true },
      ],
    });

    expect(pos.totalReceiversUsdCents).toBe(0);
    expect(pos.totalSuppliersUsdCents).toBe(42100);
    expect(pos.totalBusinessEquityUsdCents).toBe(42100);
    expect(pos.netContributedCapitalUsdCents).toBe(40000);
    expect(pos.salesGrossProfitUsdCents).toBe(2100);
    expect(pos.withdrawnProfitUsdCents).toBe(0);
    expect(pos.undistributedProfitUsdCents).toBe(2100);
    expect(pos.suppliersDiscrepancyUsdCents).toBe(0);
    expect(pos.fundedBySupplierUsdCents.fazercards).toBe(82100);
  });

  it("Caso 2: saca $21 de ganancia y reinvierte solo $400 en distribuidores", () => {
    const withdraw21 = makeMovement({
      movementType: "PROFIT_WITHDRAWAL",
      sourceAccount: "zenobank",
      targetAccount: "partner_payout",
      amountUsdCents: 2100,
      partnerName: "Socios",
      occurredAt: "2026-11-15T13:00:00.000Z",
    });
    const reinvest400 = makeMovement({
      movementType: "SUPPLIER_TOPUP",
      sourceAccount: "zenobank",
      targetAccount: "fazercards",
      amountUsdCents: 40000,
      occurredAt: "2026-11-15T13:05:00.000Z",
    });

    const pos = computeTreasuryPosition({
      orders: [baseNetflixOrder],
      movements: [initialSeed, withdraw21, reinvest400],
      suppliers: [
        { id: "fazercards", balanceCents: 40000, enabled: true, configured: true },
      ],
    });

    expect(pos.totalReceiversUsdCents).toBe(0);
    expect(pos.totalSuppliersUsdCents).toBe(40000);
    expect(pos.totalBusinessEquityUsdCents).toBe(40000);
    expect(pos.netContributedCapitalUsdCents).toBe(40000);
    expect(pos.salesGrossProfitUsdCents).toBe(2100);
    expect(pos.withdrawnProfitUsdCents).toBe(2100);
    expect(pos.undistributedProfitUsdCents).toBe(0);
    expect(pos.suppliersDiscrepancyUsdCents).toBe(0);
  });

  it("Mantiene la ganancia real limpia al inyectar $200 de capital adicional", () => {
    const extraCapital = makeMovement({
      movementType: "CAPITAL_IN",
      sourceAccount: "external",
      targetAccount: "centralone",
      amountUsdCents: 20000,
      occurredAt: "2026-11-15T14:00:00.000Z",
    });

    const pos = computeTreasuryPosition({
      orders: [baseNetflixOrder],
      movements: [initialSeed, extraCapital],
      suppliers: [
        { id: "fazercards", balanceCents: 0, enabled: true, configured: true },
        { id: "centralone", balanceCents: 20000, enabled: true, configured: true },
      ],
    });

    expect(pos.netContributedCapitalUsdCents).toBe(60000);
    expect(pos.totalReceiversUsdCents).toBe(42100);
    expect(pos.totalSuppliersUsdCents).toBe(20000);
    expect(pos.totalBusinessEquityUsdCents).toBe(62100);
    expect(pos.salesGrossProfitUsdCents).toBe(2100);
    expect(pos.suppliersDiscrepancyUsdCents).toBe(0);
  });

  it("Registra cambios P2P Pago Movil Bs -> Binance USDT descontando Bs y reflejando diferencial cambiario", () => {
    const pmOrder = makeOrder({
      id: "ord-pm",
      subtotalCents: 10000,
      paidCents: 10000,
      paymentGateway: "pagomovil",
      bsRateCents: 5000,
      totalBsCents: 500000,
      items: [
        {
          id: "item-pm",
          orderId: "ord-pm",
          variantId: "v-pm",
          productName: "PSN 100",
          productSlug: "psn",
          denominationLabel: "$100",
          region: "USA",
          unitPriceCents: 10000,
          unitCostCents: 9300,
          quantity: 1,
          deliveredCount: 1,
          status: "FULFILLED",
        },
      ],
    });

    const swapToUsdt = makeMovement({
      movementType: "INTERNAL_TRANSFER",
      sourceAccount: "pagomovil",
      targetAccount: "zenobank",
      amountUsdCents: 9800,
      amountBsCents: 500000,
      exchangeRateCents: 5102,
    });

    const pos = computeTreasuryPosition({
      orders: [pmOrder],
      movements: [swapToUsdt],
      suppliers: [
        { id: "fazercards", balanceCents: 0, enabled: true, configured: true },
      ],
    });

    expect(pos.pagomovilBalanceBsCents).toBe(0);
    expect(pos.pagomovilBalanceUsdCents).toBe(0);
    expect(pos.zenobankBalanceUsdCents).toBe(9800);
    expect(pos.exchangeDiffUsdCents).toBe(-200);
    expect(pos.netBusinessProfitUsdCents).toBe(500);
  });

  it("Excluye ordenes de prueba (isTest: true) y deja caja cuadrada con saldos vivos iniciales", () => {
    const testOrder = makeOrder({
      id: "ord-test-c1",
      isTest: true,
      subtotalCents: 72,
      paidCents: 72,
      items: [
        {
          id: "item-ff",
          orderId: "ord-test-c1",
          variantId: "v-ff",
          productName: "Free Fire",
          productSlug: "ff",
          denominationLabel: "110",
          region: "Latam",
          unitPriceCents: 72,
          unitCostCents: 69,
          quantity: 1,
          deliveredCount: 1,
          status: "FULFILLED",
        },
      ],
    });

    const voidedMove = makeMovement({
      movementType: "PROFIT_WITHDRAWAL",
      sourceAccount: "zenobank",
      targetAccount: "partner_payout",
      amountUsdCents: 9999,
      voidedAt: "2026-11-15T12:30:00.000Z",
    });

    const openingC1 = makeMovement({
      movementType: "CAPITAL_IN",
      sourceAccount: "external",
      targetAccount: "centralone",
      amountUsdCents: 293,
      notes: "Saldo vivo inicial tras pruebas",
    });
    const openingFazer = makeMovement({
      movementType: "CAPITAL_IN",
      sourceAccount: "external",
      targetAccount: "fazercards",
      amountUsdCents: 276,
      notes: "Saldo vivo inicial tras pruebas",
    });

    const pos = computeTreasuryPosition({
      orders: [testOrder],
      movements: [voidedMove, openingC1, openingFazer],
      suppliers: [
        { id: "centralone", balanceCents: 293, enabled: true, configured: true },
        { id: "fazercards", balanceCents: 276, enabled: true, configured: true },
      ],
      includeTestOrders: false,
    });

    expect(pos.allTimeSalesUsdCents).toBe(0);
    expect(pos.totalReceiversUsdCents).toBe(0);
    expect(pos.totalSuppliersUsdCents).toBe(569);
    expect(pos.netContributedCapitalUsdCents).toBe(569);
    expect(pos.salesGrossProfitUsdCents).toBe(0);
    expect(pos.withdrawnProfitUsdCents).toBe(0);
    expect(pos.suppliersDiscrepancyUsdCents).toBe(0);
  });
});
