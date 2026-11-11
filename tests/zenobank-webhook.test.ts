import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { Webhook } from "svix";
import { verifyZenoBankWebhookWithSecret } from "@/lib/server/payments/zenobank";

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
});
