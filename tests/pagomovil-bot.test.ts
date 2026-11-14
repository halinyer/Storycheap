import { beforeEach, describe, expect, it } from "vitest";
import { SANDBOX_DEFAULT_ADMIN_ID } from "@/lib/server/auth";
import { initiateCheckout } from "@/lib/server/checkout-service";
import {
  getOrderPagoMovilReport,
  getPagoMovilBotSettings,
  registerBotDevice,
  saveOrderPagoMovilReport,
  savePagoMovilBotSettings,
  saveReceiverBankAccount,
  updateBotDeviceHeartbeat,
} from "@/lib/server/pagomovil-store";
import {
  adminManualConfirmPagoMovil,
  computeHmacSha256Hex,
  getPagoMovilOrderPublicStatus,
  ingestBotNotification,
  PagoMovilAuthError,
  refreshPagoMovilOrderRate,
  verifyOrderPagoMovilClaim,
} from "@/lib/server/payments/pagomovil-bot";
import { parseBancamigaNotification } from "@/lib/server/payments/parsers/bancamiga";
import { parseBankNotification } from "@/lib/server/payments/parsers";
import {
  getOrderById,
  getUserCreditBalanceCents,
  revealOrderCodes,
  setBsRateCents,
  transitionOrderStatus,
  updateProviderConfig,
} from "@/lib/server/repository";
import {
  getSandboxState,
  resetSandboxStateForTests,
} from "@/lib/server/sandbox-db";
import type { SessionUser } from "@/types";

const PSN_10_VARIANT_ID = "20000000-0000-4000-8000-000000000101";

const CUSTOMER_SESSION: SessionUser = {
  id: "00000000-0000-4000-8000-00000000c001",
  email: "carlos@storycheap.com",
  role: "customer",
  aal: "aal1",
  isSandbox: true,
};

const ADMIN_SESSION: SessionUser = {
  id: SANDBOX_DEFAULT_ADMIN_ID,
  email: "admin@storycheap.com",
  role: "admin",
  aal: "aal2",
  isSandbox: true,
};

async function setupActivePagoMovilEnvironment(bsRateCents = 5000) {
  await updateProviderConfig("pagomovil", { enabled: true }, ADMIN_SESSION.id);
  await setBsRateCents(bsRateCents, ADMIN_SESSION.id);
  const receiver = await saveReceiverBankAccount(
    {
      bankCode: "0172",
      bankName: "Bancamiga Banco Universal",
      accountType: "natural",
      phone: "04121234567",
      dni: "V-24123456",
      holderName: "StoryCheap Personal",
      allowedPackages: ["com.bancamiga.suite", "com.bancamiga", "SMS", "EMAIL"],
      active: true,
    },
    ADMIN_SESSION.id
  );
  const { device, plainSecret } = await registerBotDevice(
    {
      name: "Android Bancamiga QA",
      channelType: "ANDROID_PUSH",
      allowPlainBearer: true,
    },
    ADMIN_SESSION.id
  );
  await updateBotDeviceHeartbeat(device.id, {
    batteryLevel: 92,
    networkType: "WIFI",
    appVersion: "1.0.0",
  });
  return { receiver, device, plainSecret };
}

function signBotHeaders(args: {
  deviceIdentifier: string;
  secret: string;
  rawBody: string;
  tsOverride?: number;
}) {
  const ts = String(args.tsOverride ?? Math.floor(Date.now() / 1000));
  const signature = computeHmacSha256Hex(args.secret, ts, args.rawBody);
  return {
    "x-bot-device-id": args.deviceIdentifier,
    "x-bot-timestamp": ts,
    "x-bot-signature": signature,
  };
}

describe("StoryPay Pago Móvil Verifier Bot Engine", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.ENABLE_DEMO_SANDBOX = "true";
    resetSandboxStateForTests();
  });

  describe("1. Venezuelan Bank Parsers", () => {
    it("parses Bancamiga push notifications with Venezuelan decimal format (Bs. 1.250,45)", () => {
      const parsed = parseBancamigaNotification({
        title: "Pago Móvil Recibido",
        content:
          "Has recibido un Pago Movil de V-20111222 0412-5559988 Banesco (0134) por Bs. 1.250,45 Ref: 84930219",
        appPackage: "com.bancamiga.suite",
        sourceType: "APP_PUSH",
      });

      expect(parsed.isIncomingPayment).toBe(true);
      expect(parsed.matched).toBe(true);
      expect(parsed.amountBsCents).toBe(125045);
      expect(parsed.referenceFull).toBe("84930219");
      expect(parsed.referenceLast6).toBe("930219");
      expect(parsed.referenceLast4).toBe("0219");
      expect(parsed.senderBankCode).toBe("0134");
      expect(parsed.senderPhone).toBe("04125559988");
      expect(parsed.senderDni).toBe("V-20111222");
    });

    it("parses generic SMS notifications with US-dot amounts (Bs 865.00)", () => {
      const parsed = parseBankNotification({
        title: "SMS",
        content:
          "MERCANTIL: Recibiste Pago Movil de 04141112233 por Bs 865.00 Ref 00391827",
        appPackage: "SMS",
        sourceType: "SMS",
      });

      expect(parsed.isIncomingPayment).toBe(true);
      expect(parsed.matched).toBe(true);
      expect(parsed.amountBsCents).toBe(86500);
      expect(parsed.referenceFull).toBe("00391827");
      expect(parsed.bankHint).toBe("0105");
      // Does not mistake the receiving bank SMS prefix for the sender bank
      expect(parsed.senderBankCode).toBeNull();
      expect(parsed.senderPhone).toBe("04141112233");

      const crossBank = parseBankNotification({
        title: "SMS",
        content:
          "BANCAMIGA: Recibiste Pago Movil desde Banesco 04141112233 Bs 865.00 Ref 00391827",
        appPackage: "SMS",
        sourceType: "SMS",
        preferredBankCode: "0172",
      });
      expect(crossBank.senderBankCode).toBe("0134");
    });

    it("blocks outgoing debit notifications as IGNORED (never credits debits)", () => {
      const parsed = parseBancamigaNotification({
        title: "Pago Móvil Enviado",
        content: "Enviaste Pago Movil exitoso por Bs. 500,00 Ref: 77441122",
        appPackage: "com.bancamiga.suite",
        sourceType: "APP_PUSH",
      });

      expect(parsed.isIncomingPayment).toBe(false);
      expect(parsed.matched).toBe(false);
    });
  });

  describe("2. HMAC Security, Anti-Replay & Package Allowlist", () => {
    it("rejects tampered HMAC signature and stale timestamps > 300s", async () => {
      const { device, plainSecret } = await setupActivePagoMovilEnvironment();
      const rawBody = JSON.stringify({
        title: "Pago Móvil Recibido",
        content: "Recibiste Bs. 525,00 Ref: 11223344",
        app_package: "com.bancamiga.suite",
      });

      await expect(
        ingestBotNotification({
          rawBody,
          headers: {
            "x-bot-device-id": device.deviceIdentifier,
            "x-bot-timestamp": String(Math.floor(Date.now() / 1000)),
            "x-bot-signature": "0".repeat(64),
          },
        })
      ).rejects.toThrowError(PagoMovilAuthError);

      await expect(
        ingestBotNotification({
          rawBody,
          headers: signBotHeaders({
            deviceIdentifier: device.deviceIdentifier,
            secret: plainSecret,
            rawBody,
            tsOverride: Math.floor(Date.now() / 1000) - 450,
          }),
        })
      ).rejects.toThrowError(PagoMovilAuthError);
    });

    it("marks spoofed notifications from untrusted Android packages (e.g. WhatsApp) as IGNORED", async () => {
      const { device, plainSecret } = await setupActivePagoMovilEnvironment();
      const rawBody = JSON.stringify({
        title: "WhatsApp",
        content: "Recibiste Pago Movil por Bs. 525,00 Ref: 88887777",
        app_package: "com.whatsapp",
        source_type: "APP_PUSH",
      });

      const ingested = await ingestBotNotification({
        rawBody,
        headers: signBotHeaders({
          deviceIdentifier: device.deviceIdentifier,
          secret: plainSecret,
          rawBody,
        }),
      });

      expect(ingested.notification.status).toBe("IGNORED");
      expect(ingested.notification.parserUsed).toBe("package_guard");
      expect(ingested.autoMatchedOrderId).toBeNull();
    });
  });

  describe("3. Race-Free Two-Way Matching & Fulfillment", () => {
    it("Case A: matches push notification arriving BEFORE customer submits reference and releases code", async () => {
      const { device, plainSecret } = await setupActivePagoMovilEnvironment(5000);

      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      expect(checkout.order.amountDueCents).toBe(1050);
      expect(checkout.order.totalBsCents).toBe(52500);
      expect(checkout.checkoutUrl).toContain(`/pay/pagomovil/${checkout.order.id}`);

      const rawBody = JSON.stringify({
        title: "Pago Móvil Recibido",
        content:
          "Has recibido un Pago Movil de V-19000111 0414-0001122 Banesco (0134) por Bs. 525,00 Ref: 84930219",
        app_package: "com.bancamiga.suite",
        source_type: "APP_PUSH",
      });

      const ingested = await ingestBotNotification({
        rawBody,
        headers: signBotHeaders({
          deviceIdentifier: device.deviceIdentifier,
          secret: plainSecret,
          rawBody,
        }),
      });
      expect(ingested.notification.status).toBe("UNMATCHED");

      const verification = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "30219",
        senderBankCode: "0134",
      });

      expect(verification.ok).toBe(true);
      expect(verification.code).toBe("COMPLETED");

      const deliveredOrder = await getOrderById(checkout.order.id);
      expect(deliveredOrder?.status).toBe("DELIVERED");
      expect(deliveredOrder?.fulfillments.length).toBe(1);

      const codes = await revealOrderCodes({
        orderId: checkout.order.id,
        actorUserId: CUSTOMER_SESSION.id,
      });
      expect(codes.length).toBe(1);
      expect(codes[0]?.code.length).toBeGreaterThan(5);
    });

    it("Case B: queues WAITING_BANK_CONFIRMATION when customer reports first, then auto-fulfills on push arrival", async () => {
      const { device, plainSecret } = await setupActivePagoMovilEnvironment(5000);

      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      const claim = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "991122",
      });

      expect(claim.ok).toBe(true);
      expect(claim.code).toBe("WAITING_BANK_CONFIRMATION");

      const rawBody = JSON.stringify({
        title: "SMS",
        content: "BANCAMIGA: Recibiste Pago Movil Bs. 525,00 Ref: 0000991122",
        app_package: "SMS",
        source_type: "SMS",
      });

      const ingested = await ingestBotNotification({
        rawBody,
        headers: signBotHeaders({
          deviceIdentifier: device.deviceIdentifier,
          secret: plainSecret,
          rawBody,
        }),
      });

      expect(ingested.autoMatchedOrderId).toBe(checkout.order.id);
      expect(ingested.notification.status).toBe("MATCHED");

      const updatedOrder = await getOrderById(checkout.order.id);
      expect(updatedOrder?.status).toBe("DELIVERED");
      expect(updatedOrder?.fulfillments.length).toBe(1);
    });

    it("supports partial store credit (pays only amountDueBsCents) and credits Bs overpayment in USD", async () => {
      const { device, plainSecret } = await setupActivePagoMovilEnvironment(5000);

      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: true,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      // $10.50 subtotal - $3.50 store credit = $7.00 due => Bs 350.00
      expect(checkout.order.amountDueCents).toBe(700);
      expect(checkout.order.totalBsCents).toBe(52500);
      const report = await getOrderPagoMovilReport(checkout.order.id);
      expect(report?.amountDueBsCents).toBe(35000);
      expect(await getUserCreditBalanceCents(CUSTOMER_SESSION.id)).toBe(0);

      // Customer accidentally pays Bs 450.00 (+Bs 100.00 extra = +$2.00 USD surplus at 50 Bs/USD)
      const rawBody = JSON.stringify({
        title: "Pago Móvil Recibido",
        content: "Has recibido un Pago Movil por Bs. 450,00 Ref: 55667788",
        app_package: "com.bancamiga.suite",
      });

      await ingestBotNotification({
        rawBody,
        headers: signBotHeaders({
          deviceIdentifier: device.deviceIdentifier,
          secret: plainSecret,
          rawBody,
        }),
      });

      const verification = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "55667788",
      });

      expect(verification.ok).toBe(true);
      expect(verification.code).toBe("COMPLETED");

      const delivered = await getOrderById(checkout.order.id);
      expect(delivered?.status).toBe("DELIVERED");
      expect(await getUserCreditBalanceCents(CUSTOMER_SESSION.id)).toBe(200);
    });
  });

  describe("4. Error Handling: Underpayment, Duplicate Reference, Collision, Expiry & Manual Recovery", () => {
    it("blocks underpayment in both Case A and Case B and never releases gift cards", async () => {
      const { device, plainSecret } = await setupActivePagoMovilEnvironment(5000);

      // Case A underpaid
      const checkoutA = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      const rawUnderA = JSON.stringify({
        title: "Pago Móvil Recibido",
        content: "Has recibido un Pago Movil por Bs. 200,00 Ref: 12123434",
        app_package: "com.bancamiga.suite",
      });
      await ingestBotNotification({
        rawBody: rawUnderA,
        headers: signBotHeaders({
          deviceIdentifier: device.deviceIdentifier,
          secret: plainSecret,
          rawBody: rawUnderA,
        }),
      });

      const verifyA = await verifyOrderPagoMovilClaim({
        orderId: checkoutA.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "12123434",
      });
      expect(verifyA.ok).toBe(false);
      expect(verifyA.code).toBe("AMOUNT_MISMATCH");
      const orderA = await getOrderById(checkoutA.order.id);
      expect(orderA?.status).toBe("PENDING_PAYMENT");
      expect(orderA?.needsAttention).toBe(true);
      expect(orderA?.fulfillments.length).toBe(0);

      // Case B underpaid (claim first, then underpaid push arrives)
      const checkoutB = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      const claimB = await verifyOrderPagoMovilClaim({
        orderId: checkoutB.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "90908080",
      });
      expect(claimB.code).toBe("WAITING_BANK_CONFIRMATION");

      const rawUnderB = JSON.stringify({
        title: "Pago Móvil Recibido",
        content: "Has recibido un Pago Movil por Bs. 300,00 Ref: 90908080",
        app_package: "com.bancamiga.suite",
      });
      const ingestB = await ingestBotNotification({
        rawBody: rawUnderB,
        headers: signBotHeaders({
          deviceIdentifier: device.deviceIdentifier,
          secret: plainSecret,
          rawBody: rawUnderB,
        }),
      });
      expect(ingestB.autoMatchedOrderId).toBeNull();

      const statusB = await getPagoMovilOrderPublicStatus({
        orderId: checkoutB.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
      });
      expect(statusB.lastErrorCode).toBe("AMOUNT_MISMATCH");
      expect(statusB.waitingBankConfirmation).toBe(false);
      expect((await getOrderById(checkoutB.order.id))?.fulfillments.length).toBe(0);
    });

    it("rejects reusing an already claimed bank reference (DUPLICATE_REFERENCE)", async () => {
      const { device, plainSecret } = await setupActivePagoMovilEnvironment(5000);

      const order1 = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      const rawBody = JSON.stringify({
        title: "Pago Móvil Recibido",
        content: "Has recibido un Pago Movil por Bs. 525,00 Ref: 77889900",
        app_package: "com.bancamiga.suite",
      });
      await ingestBotNotification({
        rawBody,
        headers: signBotHeaders({
          deviceIdentifier: device.deviceIdentifier,
          secret: plainSecret,
          rawBody,
        }),
      });

      const res1 = await verifyOrderPagoMovilClaim({
        orderId: order1.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "77889900",
      });
      expect(res1.code).toBe("COMPLETED");

      // Second order tries to reuse the exact same reference
      const order2 = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      const res2 = await verifyOrderPagoMovilClaim({
        orderId: order2.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "89900",
      });
      expect(res2.ok).toBe(false);
      expect(res2.code).toBe("DUPLICATE_REFERENCE");
      expect((await getOrderById(order2.order.id))?.fulfillments.length).toBe(0);
    });

    it("detects AMBIGUOUS_REFERENCE on short 4-digit collision and resolves with full reference", async () => {
      const { device, plainSecret } = await setupActivePagoMovilEnvironment(5000);

      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      for (const ref of ["11119988", "22229988"]) {
        const rawBody = JSON.stringify({
          title: "Pago Móvil Recibido",
          content: `Has recibido un Pago Movil por Bs. 525,00 Ref: ${ref}`,
          app_package: "com.bancamiga.suite",
        });
        await ingestBotNotification({
          rawBody,
          headers: signBotHeaders({
            deviceIdentifier: device.deviceIdentifier,
            secret: plainSecret,
            rawBody,
          }),
        });
      }

      const ambiguous = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "9988",
      });
      expect(ambiguous.ok).toBe(false);
      expect(ambiguous.code).toBe("AMBIGUOUS_REFERENCE");

      const resolved = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "22229988",
      });
      expect(resolved.ok).toBe(true);
      expect(resolved.code).toBe("COMPLETED");
    });

    it("handles RATE_EXPIRED and refreshes order Bs snapshot via refreshPagoMovilOrderRate", async () => {
      await setupActivePagoMovilEnvironment(5000);

      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      // Force rate window expired
      await saveOrderPagoMovilReport(checkout.order.id, {
        rateExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const expiredClaim = await verifyOrderPagoMovilClaim({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
        referenceDigits: "445566",
      });
      expect(expiredClaim.ok).toBe(false);
      expect(expiredClaim.code).toBe("RATE_EXPIRED");

      // Raise rate to 60 Bs/USD and refresh
      await setBsRateCents(6000, ADMIN_SESSION.id);
      const refreshed = await refreshPagoMovilOrderRate({
        orderId: checkout.order.id,
        actorUser: CUSTOMER_SESSION,
        hasOrderCookie: false,
      });

      expect(refreshed.bsRateCents).toBe(6000);
      expect(refreshed.amountDueBsCents).toBe(63000);

      const postRefreshOrder = await getOrderById(checkout.order.id);
      expect(postRefreshOrder?.bsRateCents).toBe(6000);
    });

    it("flags late notification on EXPIRED order and recovers via adminManualConfirmPagoMovil (owner_manual)", async () => {
      const { device, plainSecret } = await setupActivePagoMovilEnvironment(5000);

      const checkout = await initiateCheckout({
        email: CUSTOMER_SESSION.email,
        items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
        applyStoreCredit: false,
        paymentGateway: "pagomovil",
        sessionUser: CUSTOMER_SESSION,
        ipAddress: "127.0.0.1",
      });

      await saveOrderPagoMovilReport(checkout.order.id, {
        reportedReference: "33445566",
      });

      // Expire order
      const transitioned = await transitionOrderStatus({
        orderId: checkout.order.id,
        expectedStatuses: ["PENDING_PAYMENT"],
        nextStatus: "EXPIRED",
      });
      expect(transitioned).toBe(true);

      // Late bank push arrives
      const rawBody = JSON.stringify({
        title: "Pago Móvil Recibido",
        content: "Has recibido un Pago Movil por Bs. 525,00 Ref: 33445566",
        app_package: "com.bancamiga.suite",
      });
      const ingested = await ingestBotNotification({
        rawBody,
        headers: signBotHeaders({
          deviceIdentifier: device.deviceIdentifier,
          secret: plainSecret,
          rawBody,
        }),
      });
      expect(ingested.autoMatchedOrderId).toBeNull();

      const flaggedOrder = await getOrderById(checkout.order.id);
      expect(flaggedOrder?.needsAttention).toBe(true);
      expect(flaggedOrder?.attentionReason).toContain("tardío");

      // Owner manually confirms attaching that notification
      const recovery = await adminManualConfirmPagoMovil({
        orderId: checkout.order.id,
        adminUser: ADMIN_SESSION,
        referenceDigits: "33445566",
        notificationId: ingested.notification.id,
        note: "Pago confirmado en app Bancamiga",
      });
      expect(recovery.notification.status).toBe("MATCHED");

      const recoveredOrder = await getOrderById(checkout.order.id);
      expect(recoveredOrder?.status).toBe("DELIVERED");
      expect(recoveredOrder?.fulfillments.length).toBe(1);
    });

    it("enforces watchdog offline blocking when enforceWatchdog=true and sensors are offline", async () => {
      await setupActivePagoMovilEnvironment(5000);
      await savePagoMovilBotSettings({ enforceWatchdog: true }, ADMIN_SESSION.id);
      // Force device heartbeat to 2 hours ago
      const state = getSandboxState();
      state.pagoMovil.devices[0].lastHeartbeatAt = new Date(
        Date.now() - 120 * 60_000
      ).toISOString();

      await expect(
        initiateCheckout({
          email: CUSTOMER_SESSION.email,
          items: [{ variantId: PSN_10_VARIANT_ID, quantity: 1 }],
          applyStoreCredit: false,
          paymentGateway: "pagomovil",
          sessionUser: CUSTOMER_SESSION,
          ipAddress: "127.0.0.1",
        })
      ).rejects.toThrowError(/fuera de línea/i);

      // Re-verify watchdog settings read back properly
      const settings = await getPagoMovilBotSettings();
      expect(settings.enforceWatchdog).toBe(true);
    });
  });
});
