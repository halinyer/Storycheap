import "server-only";
import {
  ZenoBankClient,
  WebhookVerificationError,
  MissingWebhookHeadersError,
  type CheckoutResponseDto,
} from "@zenobank/sdk";
import { getSiteUrl, isDemoSandboxEnabled, isZenoBankConfigured } from "../env";
import type {
  CreateCheckoutInput,
  GatewayCheckoutSession,
  NormalizedPaymentWebhookEvent,
  PaymentGatewayAdapter,
} from "./types";

function parseUsdToCents(amountStr: string | undefined | null): number {
  if (!amountStr) return 0;
  const parsed = Number.parseFloat(amountStr);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function getHeaderCaseInsensitive(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

function createZenoClient(): ZenoBankClient {
  const apiKey = process.env.ZENOBANK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ZENOBANK_API_KEY is not configured.");
  }
  return new ZenoBankClient({
    apiKey,
    baseUrl: process.env.ZENOBANK_BASE_URL?.trim() || "https://api.zenobank.io",
  });
}

function mapCheckoutDto(
  dto: CheckoutResponseDto,
  isSandbox = false
): GatewayCheckoutSession {
  return {
    gateway: "zenobank",
    checkoutId: dto.id,
    checkoutUrl: dto.checkoutUrl,
    expiresAt: dto.expiresAt,
    status: dto.status,
    priceCents: parseUsdToCents(dto.priceAmount),
    paidCents: parseUsdToCents(dto.paidAmount),
    isSandbox,
  };
}

/**
 * Pure verification helper exported for unit testing against Svix-signed payloads.
 */
export function verifyZenoBankWebhookWithSecret(args: {
  secret: string;
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
}): NormalizedPaymentWebhookEvent {
  // We instantiate ZenoBankClient with a placeholder apiKey because webhooks.verify only uses the webhook secret locally via Svix.
  const client = new ZenoBankClient({
    apiKey: process.env.ZENOBANK_API_KEY?.trim() || "webhook-verify-only",
  });
  const verified = client.webhooks.verify({
    secret: args.secret,
    rawBody: args.rawBody,
    headers: args.headers,
  });

  const svixId =
    getHeaderCaseInsensitive(args.headers, "svix-id") ??
    getHeaderCaseInsensitive(args.headers, "zeno-id");

  const eventId = svixId
    ? `${verified.type}:${svixId}`
    : `${verified.type}:${verified.data.id}:${verified.data.paidAmount}`;

  return {
    gateway: "zenobank",
    eventId,
    eventType: verified.type,
    orderId: verified.data.orderId,
    checkoutId: verified.data.id,
    priceCents: parseUsdToCents(verified.data.priceAmount),
    paidCents: parseUsdToCents(verified.data.paidAmount),
    status: verified.data.status,
    rawPayload: verified as unknown as Record<string, unknown>,
  };
}

// Local sandbox state for ZenoBank simulated checkouts (dev/tests only)
const sandboxCheckouts = new Map<string, CheckoutResponseDto>();

export function setSandboxZenoCheckout(dto: CheckoutResponseDto) {
  sandboxCheckouts.set(dto.id, dto);
}

export function getSandboxZenoCheckout(checkoutId: string) {
  return sandboxCheckouts.get(checkoutId) ?? null;
}

export class ZenoBankAdapter implements PaymentGatewayAdapter {
  readonly id = "zenobank" as const;

  async createCheckout(
    input: CreateCheckoutInput
  ): Promise<GatewayCheckoutSession> {
    if (!isZenoBankConfigured()) {
      if (!isDemoSandboxEnabled()) {
        throw new Error("ZenoBank gateway is not configured.");
      }
      const checkoutId = `zbk_sbx_${input.orderId.slice(0, 8)}_${Date.now()}`;
      const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      const dto: CheckoutResponseDto = {
        id: checkoutId,
        orderId: input.orderId,
        priceCurrency: input.currency,
        priceAmount: (input.amountCents / 100).toFixed(2),
        paidAmount: "0.00",
        status: "OPEN",
        expiresAt,
        checkoutUrl: `${getSiteUrl()}/order/${input.orderId}?sandboxCheckout=${encodeURIComponent(checkoutId)}`,
        createdAt: new Date().toISOString(),
        successRedirectUrl: input.successRedirectUrl,
      };
      sandboxCheckouts.set(checkoutId, dto);
      return mapCheckoutDto(dto, true);
    }

    const client = createZenoClient();
    const dto = await client.checkouts.create({
      orderId: input.orderId,
      priceAmount: (input.amountCents / 100).toFixed(2),
      priceCurrency: input.currency,
      successRedirectUrl: input.successRedirectUrl,
    });
    return mapCheckoutDto(dto, false);
  }

  async getCheckout(checkoutId: string): Promise<GatewayCheckoutSession> {
    if (!isZenoBankConfigured()) {
      if (!isDemoSandboxEnabled()) {
        throw new Error("ZenoBank gateway is not configured.");
      }
      const existing = sandboxCheckouts.get(checkoutId);
      if (!existing) {
        throw new Error(`Sandbox ZenoBank checkout not found: ${checkoutId}`);
      }
      return mapCheckoutDto(existing, true);
    }

    const client = createZenoClient();
    const dto = await client.checkouts.get(checkoutId);
    return mapCheckoutDto(dto, false);
  }

  async verifyWebhook(args: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<NormalizedPaymentWebhookEvent> {
    const secret = process.env.ZENOBANK_WEBHOOK_SECRET?.trim();
    if (!secret) {
      throw new WebhookVerificationError(
        "ZENOBANK_WEBHOOK_SECRET is not configured."
      );
    }
    return verifyZenoBankWebhookWithSecret({
      secret,
      rawBody: args.rawBody,
      headers: args.headers,
    });
  }
}

export { WebhookVerificationError, MissingWebhookHeadersError };
