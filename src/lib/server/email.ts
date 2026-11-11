import "server-only";
import { Resend } from "resend";
import { getSiteUrl, isResendConfigured } from "./env";

function getFromEmail(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() || "StoryCheap <no-reply@storycheap.com>"
  );
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
  const subject = params.partial
    ? `Tus primeros códigos de StoryCheap están listos (${params.orderNumber})`
    : `Tus códigos de StoryCheap están listos (${params.orderNumber})`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
      <h2 style="margin: 0 0 12px; font-size: 20px;">StoryCheap — Confirmación de entrega</h2>
      <p style="margin: 0 0 16px; color: #334155; line-height: 1.5;">
        ${
          params.partial
            ? `Tu orden <strong>${params.orderNumber}</strong> ya tiene códigos disponibles en tu bóveda segura mientras nuestro equipo verifica el resto.`
            : `Tu orden <strong>${params.orderNumber}</strong> (${params.itemCount} tarjeta${params.itemCount === 1 ? "" : "s"}) ha sido confirmada y tus códigos están listos.`
        }
      </p>
      <p style="margin: 0 0 20px; color: #475569; font-size: 14px;">
        Por tu seguridad, nunca enviamos códigos en texto plano por correo. Haz clic abajo para revelarlos en tu bóveda cifrada:
      </p>
      <a href="${orderUrl}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; font-weight: 600; padding: 12px 22px; border-radius: 10px;">
        Ver mi código en StoryCheap
      </a>
      <p style="margin: 24px 0 0; color: #64748b; font-size: 12px;">
        ¿Necesitas ayuda? Escríbenos a soporte@storycheap.com indicando tu número de orden ${params.orderNumber}.
      </p>
    </div>
  `;

  if (!isResendConfigured()) {
    if (process.env.NODE_ENV !== "test") {
      console.info(
        `[StoryCheap Email Sandbox] To=${params.to} Subject="${subject}" Link=${orderUrl}`
      );
    }
    return { sent: false, sandboxLogged: true };
  }

  const resend = new Resend(process.env.RESEND_API_KEY!);
  await resend.emails.send({
    from: getFromEmail(),
    to: params.to,
    subject,
    html,
  });
  return { sent: true, sandboxLogged: false };
}

export async function sendCreditAdjustmentEmail(params: {
  to: string;
  orderNumber?: string;
  amountCents: number;
  reasonText: string;
}) {
  const accountUrl = `${getSiteUrl()}/account`;
  const dollars = (params.amountCents / 100).toFixed(2);
  const subject = `Saldo a favor acreditado en StoryCheap ($${dollars} USD)`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
      <h2 style="margin: 0 0 12px; font-size: 20px;">Saldo a favor actualizado</h2>
      <p style="margin: 0 0 16px; color: #334155; line-height: 1.5;">
        Se acreditaron <strong>$${dollars} USD</strong> en tu saldo a favor interno${params.orderNumber ? ` (Orden ${params.orderNumber})` : ""}.
      </p>
      <p style="margin: 0 0 20px; color: #475569; font-size: 14px;">Motivo: ${params.reasonText}</p>
      <a href="${accountUrl}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; font-weight: 600; padding: 12px 22px; border-radius: 10px;">
        Ir a Mi Cuenta
      </a>
    </div>
  `;

  if (!isResendConfigured()) {
    if (process.env.NODE_ENV !== "test") {
      console.info(
        `[StoryCheap Email Sandbox] To=${params.to} Subject="${subject}"`
      );
    }
    return { sent: false, sandboxLogged: true };
  }

  const resend = new Resend(process.env.RESEND_API_KEY!);
  await resend.emails.send({
    from: getFromEmail(),
    to: params.to,
    subject,
    html,
  });
  return { sent: true, sandboxLogged: false };
}
