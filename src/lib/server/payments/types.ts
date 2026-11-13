import "server-only";
import type { PaymentGatewayId } from "@/types";

export interface CreateCheckoutInput {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  successRedirectUrl: string;
}

export interface GatewayCheckoutSession {
  gateway: PaymentGatewayId;
  checkoutId: string;
  checkoutUrl: string;
  expiresAt: string | null;
  status: "OPEN" | "COMPLETED" | "PARTIALLY_PAID" | "EXPIRED" | "CANCELLED";
  priceCents: number;
  paidCents: number;
  isSandbox: boolean;
}

export interface NormalizedPaymentWebhookEvent {
  gateway: PaymentGatewayId;
  eventId: string;
  eventType: "checkout.completed" | "checkout.partially_paid" | "checkout.expired";
  orderId: string;
  checkoutId: string;
  priceCents: number;
  paidCents: number;
  status: "OPEN" | "COMPLETED" | "PARTIALLY_PAID" | "EXPIRED" | "CANCELLED";
  expiresAt?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface PaymentGatewayAdapter {
  readonly id: PaymentGatewayId;
  createCheckout(input: CreateCheckoutInput): Promise<GatewayCheckoutSession>;
  getCheckout(checkoutId: string): Promise<GatewayCheckoutSession>;
  verifyWebhook(args: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<NormalizedPaymentWebhookEvent>;
}
