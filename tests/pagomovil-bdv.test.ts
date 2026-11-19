import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeBdvFeeBreakdown,
  computeGrossUpForTargetBs,
} from "@/lib/bdv-fees";
import {
  SANDBOX_DEFAULT_ADMIN_ID,
  SANDBOX_DEFAULT_CUSTOMER_ID,
} from "@/lib/server/auth";
import { initiateCheckout } from "@/lib/server/checkout-service";
import { resolveOrderUnderpayment } from "@/lib/server/fulfillment";
import {
  getReceivedBsCentsForOrder,
  savePagoMovilSettings,
  saveReceiverBankAccount,
} from "@/lib/server/pagomovil-store";
import {
  formatBdvImporte,
  getVenezuelaDateYmd,
  normalizeBdvCedula,
  normalizeBdvPhone,
  parseBdvAmountToBsCents,
} from "@/lib/server/payments/bdv-api";
import {
  getPagoMovilAvailabilitySnapshot,
  verifyOrderPagoMovilClaim,
} from "@/lib/server/payments/pagomovil-bdv";
import {
  getOrderById,
  getUserCreditBalanceCents,
  setBsRateCents,
  updateProviderConfig,
} from "@/lib/server/repository";
import { resetSandboxStateForTests } from "@/lib/server/sandbox-db";
import { computeTreasuryPosition } from "@/lib/server/treasury-metrics";
import type { SessionUser } from "@/types";

const PSN_10_VARIANT_ID = "20000000-0000-4000-8000-000000000101";

const ADMIN_SESSION: SessionUser = {
  id: SANDBOX_DEFAULT_ADMIN_ID,
  email: "admin@storycheap.com",
  role: "admin",
  aal: "aal2",
  isSandbox: true,
};

const CUSTOMER_SESSION: SessionUser = {
  id: SANDBOX_DEFAULT_CUSTOMER_ID,
  email: "cliente.bdv@example.com",
  role: "customer",
  aal: "aal1",
  isSandbox: true,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function setupBdvPagoMovil(
  bsRateCents = 10000,
  feePassThroughMode: "off" | "incoming" | "both" = "off"
) {
  process.env.BDV_API_KEY = "BDV_TEST_KEY_123456";
  await updateProviderConfig("pagomovil", { enabled: true }, ADMIN_SESSION.id);
  await setBsRateCents(bsRateCents, ADMIN_SESSION.id);
  await savePagoMovilSettings({ feePassThroughMode }, ADMIN_SESSION.id);
  await saveReceiverBankAccount(
    {
      bankCode: "0102",
      bankName: "Banco de Venezuela",
      accountType: "juridical",
      phone: "04127141363",
      dni: "J-500123456",
      holderName: "StoryCheap C.A.",
      active: true,
    },
    ADMIN_SESSION.id
  );
}

describe("Pago Móvil Directo · API Conciliación BDV (MDU-006)", () => {
  const originalFetch = globalThis.fetch;
  const originalBdvKey = process.env.BDV_API_KEY;

  beforeEach(() => {
    resetSandboxStateForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalBdvKey === undefined) {
      delete process.env.BDV_API_KEY;
    } else {
      process.env.BDV_API_KEY = originalBdvKey;
    }
  });

  describe("1. Normalizadores BDV y cálculo exacto de comisiones BDV (1.5% entrada + 1.5% retiro)", () => {
    it("normalizes cedula, phone, importe, amount and Venezuela UTC-4 date cleanly", () => {
      expect(normalizeBdvCedula("v-27.037.606")).toBe("V27037606");
      expect(normalizeBdvCedula("27037606")).toBe("V27037606");
      expect(normalizeBdvCedula("E-81234567")).toBe("E81234567");
      expect(normalizeBdvPhone("+58 412-714-1363")).toBe("04127141363");
      expect(normalizeBdvPhone("4141234567")).toBe("04141234567");
      expect(formatBdvImporte(12000)).toBe("120.00");
      expect(parseBdvAmountToBsCents("120.00")).toBe(12000);
      expect(parseBdvAmountToBsCents("1.080,00")).toBe(108000);
      // 2026-11-20T02:30:00Z is still 2026-11-19 22:30 in Venezuela (UTC-4)
      expect(getVenezuelaDateYmd("2026-11-20T02:30:00Z")).toBe("2026-11-19");
    });

    it("computes exact real BDV balance on Bs. 1,080.00 with 1.5% incoming and 1.5% withdrawal fees", () => {
      const b = computeBdvFeeBreakdown({
        grossBsCents: 108000, // Bs 1080.00
        incomingFeePct: 1.5,
        outgoingFeePct: 1.5,
      });

      expect(b.incomingFeeBsCents).toBe(1620); // -Bs 16.20
      expect(b.netCreditedBsCents).toBe(106380); // Real in BDV: Bs 1063.80
      expect(b.estimatedOutgoingFeeBsCents).toBe(1596); // -Bs 15.96
      expect(b.netLiquidableBsCents).toBe(104784); // Free to withdraw: Bs 1047.84
      expect(b.combinedEffectiveFeePct).toBe(2.98);
      expect(b.requiredMarkupPct).toBe(3.07);
    });

    it("deducts BDV 1.5% incoming fee from real Treasury balance and exposes net liquidable Bs", async () => {
      await setupBdvPagoMovil(10000); // Bs 100 / USD
      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });
      const expectedBsCents = checkout.order.totalBsCents!; // 108000 Bs cents ($10.80 * 100)

      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          code: 1000,
          message: `Monto: ${(expectedBsCents / 100).toFixed(2)} - estatus : Transaccion realizada`,
          data: {
            status: "1000",
            amount: (expectedBsCents / 100).toFixed(2),
            reason: "Transaccion realizada",
          },
          status: 200,
        })
      ) as typeof fetch;

      await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "900112233",
        senderBankCode: "0102",
        senderPhone: "04121112233",
        senderDni: "V27037606",
      });

      const deliveredOrder = (await getOrderById(checkout.order.id))!;
      expect(deliveredOrder.status).toBe("DELIVERED");

      const pos = computeTreasuryPosition({
        orders: [deliveredOrder],
        movements: [],
        suppliers: [],
        bsRateCents: 10000,
        replacementUsdtRateCents: 10000,
        pagomovilIncomingFeePct: 1.5,
        pagomovilOutgoingFeePct: 1.5,
      });

      expect(pos.pagomovilSalesGrossBsCents).toBe(expectedBsCents);
      expect(pos.pagomovilIncomingFeeBsCents).toBe(
        Math.round(expectedBsCents * 0.015)
      );
      // Real balance in BDV is strictly Gross minus 1.5% incoming fee!
      expect(pos.pagomovilBalanceBsCents).toBe(
        expectedBsCents - pos.pagomovilIncomingFeeBsCents
      );
      expect(pos.pagomovilNetLiquidableBsCents).toBeLessThan(
        pos.pagomovilBalanceBsCents
      );
    });
  });

  describe("2. Exacto, Sobrepago (entrega + crédito) y Pago por debajo (abono + 2do pago / crédito)", () => {
    it("is available 24/7 without any Android bot or Watchdog", async () => {
      await setupBdvPagoMovil(10000);
      const avail = await getPagoMovilAvailabilitySnapshot();
      expect(avail.available).toBe(true);
      expect(avail.bdvApiConfigured).toBe(true);
      expect(avail.receiverBankName).toBe("Banco de Venezuela");
    });

    it("delivers immediately on overpayment and credits surplus USD to credit_ledger", async () => {
      await setupBdvPagoMovil(10000); // Bs 100 / USD
      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      const expectedBsCents = checkout.order.totalBsCents!; // e.g. 108000 (Bs 1080.00)
      const overpaidBsCents = expectedBsCents + 25000; // +Bs 250.00 = +$2.50 USD surplus

      const fetchMock = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          code: 1000,
          message: "Transaccion realizada",
          data: {
            status: "1000",
            amount: formatBdvImporte(overpaidBsCents),
            reason: "Transaccion realizada",
          },
          status: 200,
        })
      );
      globalThis.fetch = fetchMock as typeof fetch;

      const creditBefore = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);

      const res = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "888777666",
        senderBankCode: "0134",
        senderPhone: "04141234567",
        senderDni: "V-27.037.606",
        amountBsCents: overpaidBsCents,
      });

      expect(res.ok).toBe(true);
      expect(res.code).toBe("COMPLETED");
      expect(res.surplusBsCents).toBe(25000);
      expect(res.surplusUsdCents).toBe(250);

      // Verify exact BDV payload sent
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("getMovement");
      expect(new Headers(init.headers).get("X-API-Key")).toBe("BDV_TEST_KEY_123456");
      expect(JSON.parse(String(init.body))).toMatchObject({
        cedulaPagador: "V27037606",
        telefonoPagador: "04141234567",
        telefonoDestino: "04127141363",
        referencia: "888777666",
        importe: formatBdvImporte(overpaidBsCents),
        bancoOrigen: "0134",
      });

      const delivered = (await getOrderById(checkout.order.id))!;
      expect(delivered.status).toBe("DELIVERED");
      expect(delivered.fulfillments.length).toBe(1);

      const creditAfter = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
      expect(creditAfter - creditBefore).toBe(250);
    });

    it("locks codes on underpayment (abono), then completes + credits excess on 2nd Pago Móvil", async () => {
      await setupBdvPagoMovil(10000); // Bs 100 / USD
      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      const expectedBsCents = checkout.order.totalBsCents!;
      const firstHalfBs = Math.floor(expectedBsCents / 2);
      const secondTransferBs = expectedBsCents - firstHalfBs + 10000; // completes + Bs 100 ($1.00) extra!

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            code: 1000,
            message: "Transaccion realizada",
            data: {
              status: "1000",
              amount: formatBdvImporte(firstHalfBs),
              reason: "Transaccion realizada",
            },
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            code: 1000,
            message: "Transaccion realizada",
            data: {
              status: "1000",
              amount: formatBdvImporte(secondTransferBs),
              reason: "Transaccion realizada",
            },
            status: 200,
          })
        ) as typeof fetch;

      const creditBefore = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);

      // 1) Underpayment abono -> MUST NOT release codes
      const firstRes = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "111222333",
        senderBankCode: "0105",
        senderPhone: "04241234567",
        senderDni: "V20111222",
        amountBsCents: firstHalfBs,
      });

      expect(firstRes.ok).toBe(false);
      expect(firstRes.code).toBe("AMOUNT_MISMATCH");
      expect(firstRes.receivedBsCents).toBe(firstHalfBs);
      expect(firstRes.remainingBsCents).toBe(expectedBsCents - firstHalfBs);

      const midOrder = (await getOrderById(checkout.order.id))!;
      expect(midOrder.status).toBe("PENDING_PAYMENT");
      expect(midOrder.fulfillments.length).toBe(0);

      // 2) Second Pago Móvil covers difference + Bs 100 extra -> delivers AND credits $1.00!
      const secondRes = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "444555666",
        senderBankCode: "0105",
        senderPhone: "04241234567",
        senderDni: "V20111222",
        amountBsCents: secondTransferBs,
      });

      expect(secondRes.ok).toBe(true);
      expect(secondRes.code).toBe("COMPLETED");
      expect(secondRes.surplusBsCents).toBe(10000);
      expect(secondRes.surplusUsdCents).toBe(100);

      const finalOrder = (await getOrderById(checkout.order.id))!;
      expect(finalOrder.status).toBe("DELIVERED");
      expect(finalOrder.fulfillments.length).toBe(1);
      expect(await getReceivedBsCentsForOrder(checkout.order.id)).toBe(
        firstHalfBs + secondTransferBs
      );

      const creditAfter = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
      expect(creditAfter - creditBefore).toBe(100);
    });

    it("allows instant conversion of underpayment abono into store credit (REFUNDED_CREDIT)", async () => {
      await setupBdvPagoMovil(10000);
      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      const abonoBsCents = 40000; // Bs 400 = $4.00
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          code: 1000,
          message: "Transaccion realizada",
          data: { status: "1000", amount: "400.00", reason: "Transaccion realizada" },
          status: 200,
        })
      ) as typeof fetch;

      const creditBefore = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);

      const res = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "555666777",
        senderBankCode: "0102",
        senderPhone: "04129998877",
        senderDni: "V18123456",
        amountBsCents: abonoBsCents,
      });
      expect(res.code).toBe("AMOUNT_MISMATCH");

      const converted = await resolveOrderUnderpayment({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        mode: "convert_to_credit_now",
      });
      expect(converted.outcome).toBe("converted_to_credit");
      expect(converted.order.status).toBe("REFUNDED_CREDIT");

      const creditAfter = await getUserCreditBalanceCents(CUSTOMER_SESSION.id);
      expect(creditAfter - creditBefore).toBe(400);
    });
  });

  describe("3. Anti-reuso y manejo de errores BDV (code 1010)", () => {
    it("blocks reusing the same BDV reference across two orders without double-delivering", async () => {
      await setupBdvPagoMovil(10000);
      const order1 = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });
      const order2 = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      const exactBs = formatBdvImporte(order1.order.totalBsCents!);
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          code: 1000,
          message: "Transaccion realizada",
          data: { status: "1000", amount: exactBs, reason: "Transaccion realizada" },
          status: 200,
        })
      );
      globalThis.fetch = fetchMock as typeof fetch;

      const r1 = await verifyOrderPagoMovilClaim({
        orderId: order1.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "777888999",
        senderBankCode: "0102",
        senderPhone: "04127141363",
        senderDni: "V27037606",
      });
      expect(r1.ok).toBe(true);
      expect(r1.code).toBe("COMPLETED");

      // Second order attempting to reuse the same BDV reference MUST be rejected BEFORE calling BDV again!
      const r2 = await verifyOrderPagoMovilClaim({
        orderId: order2.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "777888999",
        senderBankCode: "0102",
        senderPhone: "04127141363",
        senderDni: "V27037606",
      });
      expect(r2.ok).toBe(false);
      expect(r2.code).toBe("DUPLICATE_REFERENCE");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const o2After = (await getOrderById(order2.order.id))!;
      expect(o2After.status).toBe("PENDING_PAYMENT");
      expect(o2After.fulfillments.length).toBe(0);
    });

    it("rejects cleanly when BDV returns code 1010 (Registro solicitado no existe)", async () => {
      await setupBdvPagoMovil(10000);
      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          code: 1010,
          message: "No se pudo validar el movimiento : Registro solicitado no existe",
          data: null,
          status: 200,
        })
      ) as typeof fetch;

      const res = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "00000001",
        senderBankCode: "0102",
        senderPhone: "04127141363",
        senderDni: "V27037606",
      });

      expect(res.ok).toBe(false);
      expect(res.code).toBe("NOT_FOUND_IN_BDV");
      expect(res.message).toContain("Monto transferido (Bs)");
      const stillPending = (await getOrderById(checkout.order.id))!;
      expect(stillPending.status).toBe("PENDING_PAYMENT");
      expect(stillPending.fulfillments.length).toBe(0);
    });
  });

  describe("8. Traslado automático de comisión BDV al cliente (Gross-Up)", () => {
    it("Si quiero Bs 1,080.00 netos en mi cuenta BDV (incoming 1.5%), cobra Bs 1,096.45 y me caen exactamente Bs 1,080.00; en modo both cobra Bs 1,113.15 y quedan Bs 1,080.00 libres", async () => {
      const incoming = computeGrossUpForTargetBs({
        targetNetBsCents: 108000, // Bs 1,080.00
        incomingFeePct: 1.5,
        outgoingFeePct: 1.5,
        passThroughMode: "incoming",
      });
      expect(incoming.chargeGrossBsCents).toBe(109645); // Bs 1,096.45
      expect(incoming.breakdown.netCreditedBsCents).toBe(108000); // Bs 1,080.00 EXACTOS en BDV

      const both = computeGrossUpForTargetBs({
        targetNetBsCents: 108000, // Bs 1,080.00 libres tras sacar hacia Antonio
        incomingFeePct: 1.5,
        outgoingFeePct: 1.5,
        passThroughMode: "both",
      });
      expect(both.chargeGrossBsCents).toBe(111315); // Bs 1,113.15
      expect(both.breakdown.netLiquidableBsCents).toBe(108000); // Bs 1,080.00 EXACTOS libres al sacar

      // End-to-end checkout with passThroughMode = "incoming"
      await setupBdvPagoMovil(10000, "incoming"); // objetivo Bs 100.00 / USD
      const avail = await getPagoMovilAvailabilitySnapshot();
      // Tasa cobrada al cliente: ceil(10000 / 0.985) = 10153 (Bs 101.53 / USD)
      expect(avail.bsRateCents).toBe(10153);
    });
  });
});
