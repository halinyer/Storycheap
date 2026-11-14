import "server-only";
import { Resend } from "resend";
import { getSiteUrl, isResendConfigured } from "./env";

function getFromEmail(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    "StoryCheap <noreply@storycheap.com>"
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

interface SummaryRow {
  label: string;
  value: string;
  mono?: boolean;
}

function renderEmailShell(params: {
  preheader: string;
  headerRight: string;
  title: string;
  intro: string;
  rows: SummaryRow[];
  ctaLabel: string;
  ctaUrl: string;
  securityNote: string;
}): string {
  const rowsHtml = params.rows
    .map(
      (row, idx) => `
      <tr>
        <td style="padding: 12px 0; font-size: 13px; color: #6e6e73; border-bottom: ${
          idx === params.rows.length - 1 ? "none" : "1px solid #e8e8ed"
        };">
          ${escapeHtml(row.label)}
        </td>
        <td align="right" style="padding: 12px 0; font-size: 13px; font-weight: 500; color: #1d1d1f; ${
          row.mono
            ? "font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"
            : ""
        } border-bottom: ${
        idx === params.rows.length - 1 ? "none" : "1px solid #e8e8ed"
      };">
          ${escapeHtml(row.value)}
        </td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(params.title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1d1d1f; -webkit-font-smoothing: antialiased;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">
    ${escapeHtml(params.preheader)}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f5f7; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border: 1px solid #e5e5ea; border-radius: 12px;">
          <tr>
            <td style="padding: 28px 32px 20px; border-bottom: 1px solid #e8e8ed;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size: 16px; font-weight: 600; letter-spacing: -0.02em; color: #1d1d1f;">
                    StoryCheap
                  </td>
                  <td align="right" style="font-size: 12px; color: #6e6e73;">
                    ${escapeHtml(params.headerRight)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px 32px;">
              <h1 style="margin: 0 0 10px; font-size: 22px; line-height: 1.25; font-weight: 600; letter-spacing: -0.02em; color: #1d1d1f;">
                ${escapeHtml(params.title)}
              </h1>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.55; color: #424245;">
                ${escapeHtml(params.intro)}
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 26px; border-top: 1px solid #e8e8ed; border-bottom: 1px solid #e8e8ed;">
                ${rowsHtml}
              </table>

              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 0 22px;">
                <tr>
                  <td style="border-radius: 8px; background-color: #111827;">
                    <a href="${escapeHtml(params.ctaUrl)}" style="display: inline-block; padding: 12px 22px; font-size: 14px; font-weight: 500; color: #ffffff; text-decoration: none; letter-spacing: -0.01em;">
                      ${escapeHtml(params.ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 12px; line-height: 1.55; color: #6e6e73;">
                ${escapeHtml(params.securityNote)}
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 540px;">
          <tr>
            <td style="padding: 18px 8px 0; text-align: center; font-size: 12px; line-height: 1.5; color: #86868b;">
              ¿Necesitas ayuda? Responde a este correo o escribe a
              <a href="mailto:soporte@storycheap.com" style="color: #1d1d1f; text-decoration: underline;">soporte@storycheap.com</a>.<br />
              StoryCheap · Correo transaccional automático
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
  const subject = params.partial
    ? `Entrega parcial disponible · Pedido ${params.orderNumber}`
    : `Tu pedido ${params.orderNumber} está listo`;

  const html = renderEmailShell({
    preheader: params.partial
      ? `Ya tienes códigos disponibles para el pedido ${params.orderNumber}.`
      : `Confirmamos tu pago. Accede para revelar tus códigos del pedido ${params.orderNumber}.`,
    headerRight: `Pedido ${params.orderNumber}`,
    title: params.partial
      ? "Primeros códigos disponibles"
      : "Tu pedido está listo",
    intro: params.partial
      ? "Algunos artículos de tu compra ya fueron emitidos y puedes verlos ahora mientras completamos el resto."
      : "Confirmamos tu pago y emitimos tus tarjetas digitales. Ya puedes consultarlas desde tu cuenta.",
    rows: [
      { label: "N.° de pedido", value: params.orderNumber, mono: true },
      {
        label: "Artículos",
        value: `${params.itemCount} tarjeta${params.itemCount === 1 ? "" : "s"}`,
      },
      {
        label: "Estado",
        value: params.partial ? "Entrega parcial" : "Disponible",
      },
    ],
    ctaLabel: "Ver mis códigos",
    ctaUrl: orderUrl,
    securityNote:
      "Por tu seguridad, los pines y códigos digitales nunca se envían en texto plano por correo electrónico.",
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
  const subject = `Saldo a favor acreditado ($${dollars} USD) · StoryCheap`;

  const rows: SummaryRow[] = [
    { label: "Monto acreditado", value: `$${dollars} USD` },
  ];
  if (params.orderNumber) {
    rows.push({ label: "N.° de pedido", value: params.orderNumber, mono: true });
  }
  rows.push({ label: "Motivo", value: params.reasonText });

  const html = renderEmailShell({
    preheader: `Se acreditaron $${dollars} USD en tu saldo de StoryCheap.`,
    headerRight: "Aviso de cuenta",
    title: `Se acreditaron $${dollars} USD`,
    intro:
      "Este saldo quedó disponible en tu cuenta de StoryCheap y se aplicará automáticamente cuando quieras en tu próximo pedido.",
    rows,
    ctaLabel: "Ir a mi cuenta",
    ctaUrl: accountUrl,
    securityNote:
      "Este movimiento quedó registrado en el historial de tu cuenta.",
  });

  return dispatchEmail({
    to: params.to,
    subject,
    html,
  });
}

export async function sendAuthVerificationEmail(params: {
  to: string;
  actionUrl: string;
  kind: "signup" | "magiclink";
}) {
  const isSignup = params.kind === "signup";
  const subject = isSignup
    ? "Confirma tu cuenta en StoryCheap"
    : "Tu enlace de acceso a StoryCheap";

  const html = renderEmailShell({
    preheader: isSignup
      ? "Confirma tu correo electrónico para activar tu cuenta de StoryCheap."
      : "Usa este enlace personal para iniciar sesión en StoryCheap.",
    headerRight: isSignup ? "Registro de cuenta" : "Acceso seguro",
    title: isSignup ? "Confirma tu correo" : "Inicia sesión en StoryCheap",
    intro: isSignup
      ? "Gracias por registrarte en StoryCheap. Haz clic en el botón de abajo para confirmar tu correo y continuar."
      : "Solicitaste un enlace de acceso rápido para entrar a tu cuenta y ver tus códigos.",
    rows: [
      { label: "Cuenta", value: params.to },
      {
        label: "Acción",
        value: isSignup ? "Confirmar registro" : "Acceso único",
      },
    ],
    ctaLabel: isSignup ? "Confirmar cuenta" : "Iniciar sesión",
    ctaUrl: params.actionUrl,
    securityNote:
      "Si no solicitaste este correo, puedes ignorarlo de forma segura. El enlace es personal y expira automáticamente.",
  });

  return dispatchEmail({
    to: params.to,
    subject,
    html,
    sandboxLink: params.actionUrl,
  });
}
