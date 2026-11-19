import { describe, expect, it } from "vitest";
import { computeVariantDualPaymentComparison } from "@/lib/currency";
import {
  computeFilteredBinanceP2pRate,
  computeTargetBsRateFromBenchmark,
} from "@/lib/server/exchange-rates";
import {
  buildTreasuryMovementWithFeePlan,
  computeTreasuryPosition,
} from "@/lib/server/treasury-metrics";
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
    expect(pos.liquidProfitInReceiversUsdCents).toBe(0);
    expect(pos.reinvestedProfitInSuppliersUsdCents).toBe(2100);
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

  it("Descuenta comisiones de red BSC al reinvertir saldo y distingue ganancia liquida vs reinvertida", () => {
    const netflix10Order = makeOrder({
      id: "ord-nf-10",
      subtotalCents: 15460,
      creditAppliedCents: 7,
      amountDueCents: 15453,
      paidCents: 15453,
      paymentGateway: "zenobank",
      items: [
        {
          id: "item-nf-10",
          orderId: "ord-nf-10",
          variantId: "v-nf15",
          productName: "Netflix Gift Card (USA / USD)",
          productSlug: "netflix-gift-card-usa",
          denominationLabel: "15 USD",
          region: "USA",
          unitPriceCents: 1546,
          unitCostCents: 1460,
          quantity: 10,
          deliveredCount: 10,
          status: "FULFILLED",
        },
      ],
    });

    const initialFazerSeed = makeMovement({
      movementType: "CAPITAL_IN",
      sourceAccount: "external",
      targetAccount: "fazercards",
      amountUsdCents: 14600,
    });

    // Transfer 1: $154.53 sent from Binance with $0.01 BSC network fee ($154.52 credited)
    const plan1 = buildTreasuryMovementWithFeePlan({
      movementType: "SUPPLIER_TOPUP",
      sourceAccount: "zenobank",
      targetAccount: "fazercards",
      amountUsdCents: 15453,
      networkFeeUsdCents: 1,
    });
    expect(plan1.primaryAmountUsdCents).toBe(15452);
    expect(plan1.feeEntry).toEqual({
      movementType: "EXPENSE_FEE",
      sourceAccount: "zenobank",
      targetAccount: "expense",
      amountUsdCents: 1,
    });

    // Transfer 2: $3.00 sent from external wallet with $0.01 BSC fee ($2.99 credited)
    const plan2 = buildTreasuryMovementWithFeePlan({
      movementType: "SUPPLIER_TOPUP",
      sourceAccount: "external",
      targetAccount: "fazercards",
      amountUsdCents: 300,
      networkFeeUsdCents: 1,
    });
    expect(plan2.primaryAmountUsdCents).toBe(300);
    expect(plan2.feeEntry).toEqual({
      movementType: "EXPENSE_FEE",
      sourceAccount: "fazercards",
      targetAccount: "expense",
      amountUsdCents: 1,
    });

    const movements = [
      initialFazerSeed,
      makeMovement({
        movementType: "SUPPLIER_TOPUP",
        sourceAccount: "zenobank",
        targetAccount: "fazercards",
        amountUsdCents: plan1.primaryAmountUsdCents,
        occurredAt: "2026-11-17T21:10:00.000Z",
      }),
      makeMovement({
        movementType: plan1.feeEntry!.movementType,
        sourceAccount: plan1.feeEntry!.sourceAccount,
        targetAccount: plan1.feeEntry!.targetAccount,
        amountUsdCents: plan1.feeEntry!.amountUsdCents,
        occurredAt: "2026-11-17T21:10:01.000Z",
      }),
      makeMovement({
        movementType: "SUPPLIER_TOPUP",
        sourceAccount: "external",
        targetAccount: "fazercards",
        amountUsdCents: plan2.primaryAmountUsdCents,
        occurredAt: "2026-11-17T21:12:00.000Z",
      }),
      makeMovement({
        movementType: plan2.feeEntry!.movementType,
        sourceAccount: plan2.feeEntry!.sourceAccount,
        targetAccount: plan2.feeEntry!.targetAccount,
        amountUsdCents: plan2.feeEntry!.amountUsdCents,
        occurredAt: "2026-11-17T21:12:01.000Z",
      }),
    ];

    const pos = computeTreasuryPosition({
      orders: [netflix10Order],
      movements,
      suppliers: [
        { id: "fazercards", balanceCents: 15751, enabled: true, configured: true },
      ],
    });

    // Binance drained cleanly to $0.00; FazerCards has exact $157.51 ($154.52 + $2.99)
    expect(pos.zenobankBalanceUsdCents).toBe(0);
    expect(pos.totalSuppliersUsdCents).toBe(15751);
    expect(pos.suppliersDiscrepancyUsdCents).toBe(0);
    expect(pos.netContributedCapitalUsdCents).toBe(14900);
    // Gross sales profit = $154.60 - $146.00 = $8.60; minus $0.02 BSC fees = $8.58
    expect(pos.salesGrossProfitUsdCents).toBe(860);
    expect(pos.expensesUsdCents).toBe(2);
    expect(pos.netBusinessProfitUsdCents).toBe(858);
    expect(pos.liquidProfitInReceiversUsdCents).toBe(0);
    expect(pos.reinvestedProfitInSuppliersUsdCents).toBe(858);
  });

  it("Audita ganancia o pérdida real en Bolívares (devaluación latente P2P vs tasa cobrada y punto de equilibrio)", () => {
    // Vendimos una tarjeta de $10.00 (costo API $9.00) a tasa Bs 1.000,00/$ (cobrando Bs 10.000,00)
    const pmOrder = makeOrder({
      id: "ord-pm-deval",
      subtotalCents: 1000,
      amountDueCents: 1000,
      paidCents: 1000,
      paymentGateway: "pagomovil",
      bsRateCents: 100000, // Bs 1000.00 / $
      totalBsCents: 1000000, // Bs 10,000.00
      items: [
        {
          id: "item-pm-1",
          orderId: "ord-pm-deval",
          variantId: "v-1",
          productName: "Steam $10",
          productSlug: "steam-us",
          denominationLabel: "$10",
          region: "USA",
          unitPriceCents: 1000,
          unitCostCents: 900,
          quantity: 1,
          deliveredCount: 1,
          status: "FULFILLED",
        },
      ],
    });

    // Escenario A: USDT P2P subió a Bs 1.069,50/$ mientras los Bs siguen en el banco
    const posStillInBank = computeTreasuryPosition({
      orders: [pmOrder],
      movements: [],
      suppliers: [],
      bsRateCents: 100000,
      replacementUsdtRateCents: 106950, // Bs 1069.50 / USDT
    });

    expect(posStillInBank.pagomovilSalesGrossUsdCents).toBe(1000);
    expect(posStillInBank.pagomovilSalesCostUsdCents).toBe(900);
    expect(posStillInBank.pagomovilNominalProfitUsdCents).toBe(100); // +$1.00 nominal
    expect(posStillInBank.weightedBookBsRateCents).toBe(100000); // Bs 1000.00/$
    // Break-even = Bs 10,000 / $9.00 cost = Bs 1111.11 / USDT (111111 cents)
    expect(posStillInBank.pagomovilBreakEvenRateCents).toBe(111111);
    // Mark-to-market hoy en P2P: 10,000 Bs / 1069.50 = $9.35 USDT (935 cents)
    expect(posStillInBank.pagomovilMarkToMarketUsdtCents).toBe(935);
    // Pérdida latente por devaluación: $9.35 - $10.00 = -$0.65 (-65 cents)
    expect(posStillInBank.unrealizedExchangeDiffUsdCents).toBe(-65);
    // Ganancia neta real aún positiva: +$1.00 margen - $0.65 devaluación = +$0.35 (+35 cents)
    expect(posStillInBank.pagomovilRealNetProfitUsdCents).toBe(35);

    // Escenario B: Devaluación severa a Bs 1.150,00/USDT (supera el Break-Even de Bs 1.111,11)
    const posSevereDeval = computeTreasuryPosition({
      orders: [pmOrder],
      movements: [],
      suppliers: [],
      bsRateCents: 100000,
      replacementUsdtRateCents: 115000, // Bs 1150.00 / USDT
    });

    // 10,000 Bs / 1150 = $8.70 USDT (870 cents) -> pérdida latente -$1.30 -> pérdida neta real -$0.30 frente al costo de $9.00
    expect(posSevereDeval.pagomovilMarkToMarketUsdtCents).toBe(870);
    expect(posSevereDeval.unrealizedExchangeDiffUsdCents).toBe(-130);
    expect(posSevereDeval.pagomovilRealNetProfitUsdCents).toBe(-30);
  });
});

describe("exchange-rates — filtrado anti-trampa Binance P2P y cálculo de tasa objetivo", () => {
  it("Ignora anuncios trampa de 1 Bs de rango en Binance P2P y promedia ofertas líquidas", () => {
    const rate = computeFilteredBinanceP2pRate([
      // Anuncio trampa (min 300, max 301)
      { adv: { price: "1055.54", minSingleTransAmount: "300", maxSingleTransAmount: "301" } },
      // Ofertas reales con liquidez
      { adv: { price: "1068.00", minSingleTransAmount: "5000", maxSingleTransAmount: "500000" } },
      { adv: { price: "1070.00", minSingleTransAmount: "5000", maxSingleTransAmount: "500000" } },
    ]);

    expect(rate).toBe(1069);
  });

  it("Calcula tasa objetivo desde USDT P2P, Euro BCV o la más alta aplicando spread y piso anti-bajada", () => {
    const sampleRates = {
      officialBcvCents: 91665,
      euroBcvCents: 100739,
      paraleloCents: 106705,
      binanceP2pCents: 106950,
    };

    // Euro BCV sin spread
    expect(
      computeTargetBsRateFromBenchmark(
        sampleRates,
        { benchmark: "euro_bcv", spreadPct: 0, onlyIncrease: false },
        null
      )
    ).toBe(100739);

    // Binance P2P + 1% spread = 106950 * 1.01 = 108020
    expect(
      computeTargetBsRateFromBenchmark(
        sampleRates,
        { benchmark: "binance_p2p", spreadPct: 1, onlyIncrease: false },
        null
      )
    ).toBe(108020);

    // Piso anti-bajada (onlyIncrease: true) mantiene la tasa actual si es mayor
    expect(
      computeTargetBsRateFromBenchmark(
        sampleRates,
        { benchmark: "binance_p2p", spreadPct: 0, onlyIncrease: true },
        109500
      )
    ).toBe(109500);
  });

  it("Calcula la comparativa exacta de Netflix $15 (Pago en Bs vs Pago directo en USDT) para Admin", () => {
    const cmp = computeVariantDualPaymentComparison({
      saleUsd: 15.46,
      costUsd: 15.0,
      storeBsRateCents: 112299, // 15.46 * 1122.99 = Bs. 17.361,43
      usdtP2pRateCents: 107000, // USDT P2P a Bs. 1.070,00
    });

    expect(cmp).not.toBeNull();
    expect(cmp!.saleBsCents).toBe(1736143); // Bs. 17.361,43
    expect(cmp!.realUsdtFromBsRounded).toBe(16.23); // 16.23 USDT
    expect(cmp!.bsProfitUsdt).toBeCloseTo(1.23, 2); // +1.23 USDT
    expect(cmp!.bsMarkupPct?.toFixed(2)).toBe("8.17"); // 8.17%
    expect(cmp!.directUsdtProfit).toBeCloseTo(0.46, 2); // +0.46 USDT
    expect(cmp!.directUsdtMarkupPct?.toFixed(2)).toBe("3.07"); // 3.07%
    expect(cmp!.extraCushionUsdt).toBeCloseTo(0.77, 2); // +0.77 USDT extra
    expect(cmp!.effectiveBsPerCostDollar).toBeCloseTo(1157.43, 2); // Bs. 1.157,43
    expect(cmp!.effectiveBsSpreadOverUsdt).toBeCloseTo(87.43, 2); // +Bs. 87,43 sobre USDT
  });

  it("Reinversion directa desde Pago Movil BDV (1.5% entrada + cambio a USDT con ganancia cambiaria) cuadra BDV en 0 y FazerCards exacto", () => {
    // Cliente paga 1080 Bs por $10.00 (tasa 108 Bs/$) por un PIN que cuesta $9.00
    const pmOrder = makeOrder({
      id: "ord-bdv-reinvest",
      paymentGateway: "pagomovil",
      subtotalCents: 1000,
      amountDueCents: 1000,
      paidCents: 1000,
      bsRateCents: 10800,
      totalBsCents: 108000, // Bs 1,080.00
      items: [
        {
          id: "item-bdv-1",
          orderId: "ord-bdv-reinvest",
          variantId: "v-10",
          productName: "Gift Card $10",
          productSlug: "gc-10",
          denominationLabel: "$10",
          region: "USA",
          unitPriceCents: 1000,
          unitCostCents: 900,
          quantity: 1,
          deliveredCount: 1,
          status: "FULFILLED",
        },
      ],
    });

    // BDV cobra 1.5% entrada -> entran reales Bs 1,063.80 ($9.85 en libros).
    // Luego Elvias saca los Bs 1,063.80 de BDV (BDV cobra 1.5% al sacar), Antonio los convierte a $10.10 USDT
    // y los recarga directo a FazerCards (con $0.01 fee BSC -> llegan $10.09 netos a FazerCards).
    const plan = buildTreasuryMovementWithFeePlan({
      movementType: "SUPPLIER_TOPUP",
      sourceAccount: "pagomovil",
      targetAccount: "fazercards",
      amountUsdCents: 1010,
      networkFeeUsdCents: 1,
    });

    const movements: TreasuryMovementDTO[] = [
      makeMovement({
        movementType: "CAPITAL_IN",
        sourceAccount: "external",
        targetAccount: "fazercards",
        amountUsdCents: 900,
      }),
      makeMovement({
        movementType: "SUPPLIER_TOPUP",
        sourceAccount: "pagomovil",
        targetAccount: "fazercards",
        amountUsdCents: plan.primaryAmountUsdCents,
        amountBsCents: 106380,
      }),
      ...(plan.feeEntry
        ? [
            makeMovement({
              movementType: plan.feeEntry.movementType,
              sourceAccount: plan.feeEntry.sourceAccount,
              targetAccount: plan.feeEntry.targetAccount,
              amountUsdCents: plan.feeEntry.amountUsdCents,
            }),
          ]
        : []),
    ];

    const pos = computeTreasuryPosition({
      orders: [pmOrder],
      movements,
      suppliers: [
        // Arrancó en $9.00, se vendió $9.00, entraron $10.09 netos -> saldo vivo $10.09
        { id: "fazercards", balanceCents: 1009, enabled: true, configured: true },
      ],
      pagomovilIncomingFeePct: 1.5,
      pagomovilOutgoingFeePct: 1.5,
    });

    expect(pos.pagomovilBalanceBsCents).toBe(0);
    expect(pos.pagomovilBalanceUsdCents).toBe(0);
    expect(pos.suppliersDiscrepancyUsdCents).toBe(0);
    // Diferencia cambiaria de Antonio: $10.10 obtenidos - $9.85 en libros BDV = +$0.25
    expect(pos.exchangeDiffUsdCents).toBe(25);
    // Utilidad bruta ($1.00) - BDV entrada ($0.15) + cambio Antonio (+$0.25) - fee BSC ($0.01) = $1.09
    expect(pos.netBusinessProfitUsdCents).toBe(109);
  });
});
