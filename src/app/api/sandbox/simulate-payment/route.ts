import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSessionUser } from "@/lib/server/auth";
import { isDemoSandboxEnabled, isZenoBankConfigured } from "@/lib/server/env";
import { processVerifiedWebhookEvent } from "@/lib/server/fulfillment";
import { hasOrderAccessCookie } from "@/lib/server/order-access";
import { setSandboxZenoCheckout } from "@/lib/server/payments/zenobank";
import { getOrderById } from "@/lib/server/repository";

const simulateSchema = z.object({
  orderId: z.string().uuid(),
  outcome: z.enum(["completed", "underpaid", "overpaid", "expired"]),
});

/**
 * Strictly non-production Demo Sandbox endpoint allowing testers on localhost
 * without live ZenoBank credentials to exercise the full webhook + fulfillment pipeline.
 */
export async function POST(request: NextRequest) {
  if (!isDemoSandboxEnabled() || isZenoBankConfigured()) {
    return NextResponse.json(
      { error: "Sandbox payment simulator is disabled in this environment." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const parsed = simulateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const order = await getOrderById(parsed.data.orderId);
  if (!order || !order.gatewayCheckoutId) {
    return NextResponse.json(
      { error: "Orden o sesión sandbox de pago no encontrada." },
      { status: 404 }
    );
  }

  const sessionUser = await getServerSessionUser();
  const isOwner = Boolean(sessionUser && order.userId === sessionUser.id);
  const hasCookieCap = await hasOrderAccessCookie(order.id);
  if (!isOwner && !hasCookieCap && sessionUser?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const due = order.amountDueCents;
  let paidCents = due;
  let status: "COMPLETED" | "PARTIALLY_PAID" | "EXPIRED" = "COMPLETED";
  let eventType:
    | "checkout.completed"
    | "checkout.partially_paid"
    | "checkout.expired" = "checkout.completed";

  if (parsed.data.outcome === "underpaid") {
    paidCents = Math.max(100, Math.floor(due * 0.5));
    status = "COMPLETED"; // Simulate gateway closing short payment
    eventType = "checkout.completed";
  } else if (parsed.data.outcome === "overpaid") {
    paidCents = due + 250; // +$2.50 surplus -> must credit credit_ledger
    status = "COMPLETED";
    eventType = "checkout.completed";
  } else if (parsed.data.outcome === "expired") {
    paidCents = 0;
    status = "EXPIRED";
    eventType = "checkout.expired";
  }

  setSandboxZenoCheckout({
    id: order.gatewayCheckoutId,
    orderId: order.id,
    priceCurrency: "USD",
    priceAmount: (due / 100).toFixed(2),
    paidAmount: (paidCents / 100).toFixed(2),
    status,
    expiresAt: order.expiresAt,
    checkoutUrl: order.gatewayCheckoutUrl ?? "",
    createdAt: order.createdAt,
    successRedirectUrl: null,
  });

  const result = await processVerifiedWebhookEvent({
    gateway: "zenobank",
    eventId: `sbx_evt_${crypto.randomUUID()}`,
    eventType,
    orderId: order.id,
    checkoutId: order.gatewayCheckoutId,
    priceCents: due,
    paidCents,
    status,
    rawPayload: { sandboxSimulated: true, outcome: parsed.data.outcome },
  });

  const updated = await getOrderById(order.id);
  return NextResponse.json({ ok: true, result, order: updated });
}
