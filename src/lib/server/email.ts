import "server-only";
import { Resend } from "resend";
import { getSiteUrl, isResendConfigured } from "./env";

function getFromEmail(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "StoryCheap Pedidos <pedidos@storycheap.com>"
  );
}

function getReplyToEmail(): string {
  return process.env.RESEND_REPLY_TO?.trim() || "soporte@storycheap.com";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmailShell(params: {
  badge: string;
  title: string;
  introHtml: string;
  noteHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  footerText: string;
}): string {
  return `
  <div style="margin: 0; padding: 32px 16px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
    <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.06);">
      <div style="background: linear-gradient(135deg, #08090e 0%, #0f172a 100%); padding: 24px 28px; border-bottom: 1px solid #1e293b;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #38bdf8; margin-bottom: 6px;">
          ${escapeHtml(params.badge)}
        </div>
        <div style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
          StoryCheap
        </div>
      </div>

      <div style="padding: 28px;">
        <h1 style="margin: 0 0 12px; font-size: 20px; line-height: 1.3; font-weight: 800; color: #0f172a;">
          ${escapeHtml(params.title)}
        </h1>
        <p style="margin: 0 0 18px; font-size: 15px; line-height: 1.6; color: #334155;">
          ${params.introHtml}
        </p>

        <div style="margin: 0 0 24px; padding: 14px 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 13px; line-height: 1.5; color: #475569;">
          ${params.noteHtml}
        </div>

        <a href="${escapeHtml(params.ctaUrl)}" style="display: inline-block; background-color: #0f172a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 13px 24px; border-radius: 10px;">
          ${escapeHtml(params.ctaLabel)}
        </a>

        <p style="margin: 24px 0 0; padding-top: 18px; border-top: 1px solid #e2e8f0; font-size: 12px; line-height: 1.5; color: #64748b;">
          ${escapeHtml(params.footerText)} Si tienes alguna consulta, responde directamente a este correo o escríbenos a
          <a href="mailto:soporte@storycheap.com" style="color: #0284c7; text-decoration: none; font-weight: 600;">soporte@storycheap.com</a>.
        </p>
      </div>
    </div>
  </div>`;
}

async function dispatchEmail(params: {
  to: string;
  subject: string;
  html: string;
  sandboxLink?: string;
}): Promise<{ sent: boolean; sandboxLogged: boolean; error?: string }> {
  if (!isResendConfigured()) {
    if (process.env.NODE_ENV !== "test") {
      console.info(
        `[StoryCheap Email Sandbox] To=${params.to} Subject="${params.subject}"${
          params.sandboxLink ? ` Link=${params.sandboxLink}` : ""
        }`
      );
    }
    return { sent: false, sandboxLogged: true };
  }

  const resend = new Resend(process.env.RESEND_API_KEY!.trim());
  const { error } = await resend.emails.send({
    from: getFromEmail(),
    replyTo: getReplyToEmail(),
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  if (error) {
    console.error(
      `[StoryCheap Email Error] To=${params.to} Subject="${params.subject}": ${error.message}`
    );
    return { sent: false, sandboxLogged: false, error: error.message };
  }

  return { sent: true, sandboxLogged: false };
}

/**
 * Sends order readiness notification linking securely to `/order/[id]`.
 * NEVER embeds plaintext digital codes or PINs inside email bodies.
 */
export async function sendOrderReadyEmail(params: {
  to: string;
  orderId: string;
  orderNumber: string;
  itemCount: number;
  partial?: boolean;
}) {
  const orderUrl = `${getSiteUrl()}/order/${params.orderId}`;
  const safeOrderNumber = escapeHtml(params.orderNumber);
  const subject = params.partial
    ? `Entrega parcial disponible: Pedido ${params.orderNumber} — StoryCheap`
    : `Pedido ${params.orderNumber} confirmado: tus códigos están listos`;

  const html = renderEmailShell({
    badge: "Entrega Digital Segura",
    title: params.partial
      ? "Primeros códigos disponibles en tu bóveda"
      : "Tu entrega digital está lista",
    introHtml: params.partial
      ? `Tu pedido <strong>${safeOrderNumber}</strong> ya cuenta con códigos listos en tu bóveda segura mientras completamos la validación restante.`
      : `Confirmamos tu pago para el pedido <strong>${safeOrderNumber}</strong> (${params.itemCount} tarjeta${params.itemCount === 1 ? "" : "s"}). Ya puedes acceder a tus pines digitales.`,
    noteHtml:
      "Por tu seguridad, nunca enviamos códigos ni PINs en texto plano por correo electrónico. Solo tú puedes revelarlos desde tu bóveda cifrada.",
    ctaLabel: "Acceder a mi bóveda y ver códigos",
    ctaUrl: orderUrl,
    footerText: `Referencia de pedido: ${params.orderNumber}.`,
  });

  return dispatchEmail({
    to: params.to,
    subject,
    html,
    sandboxLink: orderUrl,
  });
}

export async function sendCreditAdjustmentEmail(params: {
  to: string;
  orderNumber?: string;
  amountCents: number;
  reasonText: string;
}) {
  const accountUrl = `${getSiteUrl()}/account`;
  const dollars = (params.amountCents / 100).toFixed(2);
  const subject = `Saldo a favor acreditado ($${dollars} USD) — StoryCheap`;
  const safeReason = escapeHtml(params.reasonText);
  const orderSuffix = params.orderNumber
    ? ` correspondiente al pedido <strong>${escapeHtml(params.orderNumber)}</strong>`
    : "";

  const html = renderEmailShell({
    badge: "Actualización de Cuenta",
    title: `Se acreditaron $${dollars} USD a tu saldo`,
    introHtml: `Hemos abonado <strong>$${dollars} USD</strong> en tu saldo a favor dentro de StoryCheap${orderSuffix}. Puedes usarlo automáticamente en tu próxima compra.`,
    noteHtml: `<strong>Motivo:</strong> ${safeReason}`,
    ctaLabel: "Ver saldo en Mi Cuenta",
    ctaUrl: accountUrl,
    footerText: params.orderNumber
      ? `Referencia de pedido: ${params.orderNumber}.`
      : "Movimiento registrado en tu cuenta StoryCheap.",
  });

  return dispatchEmail({
    to: params.to,
    subject,
    html,
  });
}
