import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { Webhook } from "svix";
import {
  extractZenoTransactionsFromPayload,
  verifyZenoBankWebhookWithSecret,
} from "@/lib/server/payments/zenobank";
import {
  getZenoBinanceReceiver,
  saveZenoBinanceReceiver,
} from "@/lib/server/repository";

const TEST_SECRET = `whsec_${crypto.randomBytes(24).toString("base64")}`;

function signSvixPayload(secret: string, body: string, msgId = "msg_test_001") {
  const wh = new Webhook(secret);
  const now = new Date();
  const sig = wh.sign(msgId, now, body);
  return {
    "svix-id": msgId,
    "svix-timestamp": String(Math.floor(now.getTime() / 1000)),
    "svix-signature": sig,
  };
}

describe("ZenoBank Svix Webhook Cryptographic Verification", () => {
  const samplePayload = JSON.stringify({
    type: "checkout.completed",
    data: {
      id: "chk_12345",
      orderId: "ord_999",
      priceCurrency: "USD",
      priceAmount: "25.00",
      paidAmount: "25.00",
      status: "COMPLETED",
      expiresAt: null,
      checkoutUrl: "https://pay.zenobank.io/chk_12345",
      createdAt: new Date().toISOString(),
      successRedirectUrl: null,
    },
  });

  it("accepts a genuine Svix-signed ZenoBank webhook and parses cents accurately", () => {
    const headers = signSvixPayload(TEST_SECRET, samplePayload, "msg_abc123");
    const event = verifyZenoBankWebhookWithSecret({
      secret: TEST_SECRET,
      rawBody: samplePayload,
      headers,
    });

    expect(event.eventId).toBe("checkout.completed:msg_abc123");
    expect(event.orderId).toBe("ord_999");
    expect(event.priceCents).toBe(2500);
    expect(event.paidCents).toBe(2500);
    expect(event.status).toBe("COMPLETED");
  });

  it("rejects forged signature, tampered body, or missing Svix headers", () => {
    const validHeaders = signSvixPayload(TEST_SECRET, samplePayload);

    // Tampered priceAmount in payload
    const tamperedBody = samplePayload.replace('"25.00"', '"999.00"');
    expect(() =>
      verifyZenoBankWebhookWithSecret({
        secret: TEST_SECRET,
        rawBody: tamperedBody,
        headers: validHeaders,
      })
    ).toThrow(/signature/i);

    // Wrong signature header
    expect(() =>
      verifyZenoBankWebhookWithSecret({
        secret: TEST_SECRET,
        rawBody: samplePayload,
        headers: { ...validHeaders, "svix-signature": "v1,invalidsig==" },
      })
    ).toThrow(/signature/i);

    // Missing headers
    expect(() =>
      verifyZenoBankWebhookWithSecret({
        secret: TEST_SECRET,
        rawBody: samplePayload,
        headers: {},
      })
    ).toThrow(/missing/i);
  });

  it("extracts receiver/TX details from ZenoBank webhook and poll payloads", () => {
    const webhookTxPayload = {
      type: "checkout.completed",
      data: {
        id: "chk_abc",
        transactions: [
          {
            uid: "tx_1",
            transactionId: "0xabc123",
            networkId: "BSC_MAINNET",
            tokenId: "USDT_BSC",
            tokenAmount: "25.00",
            from: "0xfrom",
            fromLabel: "Buyer Wallet",
            to: "0xbinance_dest",
            toLabel: "Binance Principal",
            createdAt: "2026-11-14T20:00:00Z",
          },
        ],
      },
    };
    const fromWebhook = extractZenoTransactionsFromPayload(webhookTxPayload);
    expect(fromWebhook).toHaveLength(1);
    expect(fromWebhook[0]?.toLabel).toBe("Binance Principal");
    expect(fromWebhook[0]?.to).toBe("0xbinance_dest");
    expect(fromWebhook[0]?.transactionId).toBe("0xabc123");

    const pollTxPayload = {
      source: "order_poll_reconcile",
      liveSession: {
        id: "chk_abc",
        transactions: [
          {
            uid: "tx_2",
            transactionId: "bp_987654",
            networkId: "BINANCE_PAY",
            tokenId: "USDT",
            tokenAmount: "10.00",
            from: null,
            fromLabel: "Binance User",
            to: "UID-555111",
            toLabel: "Mi Binance Store",
            createdAt: "2026-11-14T20:05:00Z",
          },
        ],
      },
    };
    const fromPoll = extractZenoTransactionsFromPayload(pollTxPayload);
    expect(fromPoll).toHaveLength(1);
    expect(fromPoll[0]?.to).toBe("UID-555111");
    expect(fromPoll[0]?.networkId).toBe("BINANCE_PAY");
  });

  it("stores and reads ZenoBank -> Binance receiver configuration", async () => {
    process.env.DEMO_SANDBOX = "true";
    const saved = await saveZenoBinanceReceiver({
      label: "Binance Principal",
      binanceAccount: "pagos@storycheap.com",
      network: "USDT TRC20",
      storeReference: "store_main",
      notes: "Cuenta vinculada a ZenoBank",
    });
    expect(saved.binanceAccount).toBe("pagos@storycheap.com");
    const loaded = await getZenoBinanceReceiver();
    expect(loaded?.label).toBe("Binance Principal");
    expect(loaded?.binanceAccount).toBe("pagos@storycheap.com");
  });
});
