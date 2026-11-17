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
  replyTo?: string;
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
    replyTo: params.replyTo?.trim() || getReplyToEmail(),
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

type AuthEmailKind = "signup" | "magiclink" | "recovery";

const AUTH_EMAIL_COPY: Record<
  AuthEmailKind,
  {
    subject: string;
    preheader: string;
    headerRight: string;
    title: string;
    intro: string;
    actionValue: string;
    ctaLabel: string;
  }
> = {
  signup: {
    subject: "Confirma tu cuenta en StoryCheap",
    preheader: "Confirma tu correo electrónico para activar tu cuenta de StoryCheap.",
    headerRight: "Registro de cuenta",
    title: "Confirma tu correo",
    intro:
      "Gracias por registrarte en StoryCheap. Haz clic en el botón de abajo para confirmar tu correo y continuar.",
    actionValue: "Confirmar registro",
    ctaLabel: "Confirmar cuenta",
  },
  magiclink: {
    subject: "Tu enlace de acceso a StoryCheap",
    preheader: "Usa este enlace personal para iniciar sesión en StoryCheap.",
    headerRight: "Acceso seguro",
    title: "Inicia sesión en StoryCheap",
    intro:
      "Solicitaste un enlace de acceso rápido para entrar a tu cuenta y ver tus códigos.",
    actionValue: "Acceso único",
    ctaLabel: "Iniciar sesión",
  },
  recovery: {
    subject: "Restablece tu contraseña en StoryCheap",
    preheader: "Usa este enlace personal para crear una nueva contraseña en StoryCheap.",
    headerRight: "Recuperación de clave",
    title: "Restablece tu contraseña",
    intro:
      "Recibimos una solicitud para cambiar la contraseña de tu cuenta en StoryCheap. Haz clic en el botón de abajo para definir una nueva clave.",
    actionValue: "Restablecer contraseña",
    ctaLabel: "Crear nueva contraseña",
  },
};

export async function sendAuthVerificationEmail(params: {
  to: string;
  actionUrl: string;
  kind: AuthEmailKind;
}) {
  const copy = AUTH_EMAIL_COPY[params.kind];

  const html = renderEmailShell({
    preheader: copy.preheader,
    headerRight: copy.headerRight,
    title: copy.title,
    intro: copy.intro,
    rows: [
      { label: "Cuenta", value: params.to },
      { label: "Acción", value: copy.actionValue },
    ],
    ctaLabel: copy.ctaLabel,
    ctaUrl: params.actionUrl,
    securityNote:
      "Si no solicitaste este correo, puedes ignorarlo de forma segura. El enlace es personal y expira automáticamente.",
  });

  return dispatchEmail({
    to: params.to,
    subject: copy.subject,
    html,
    sandboxLink: params.actionUrl,
  });
}

export async function sendSupportTicketReceivedEmailToAdmin(params: {
  adminTo: string;
  ticketNumber: string;
  customerName: string;
  customerEmail: string;
  orderNumber?: string | null;
  topicLabel: string;
  subject: string;
  message: string;
}) {
  const adminUrl = `${getSiteUrl()}/admin/support`;
  const html = renderEmailShell({
    preheader: `Nuevo ticket ${params.ticketNumber} de ${params.customerName}: ${params.subject}`,
    headerRight: `Soporte · ${params.ticketNumber}`,
    title: `Nuevo mensaje: ${params.subject}`,
    intro: `${params.customerName} (${params.customerEmail}) envió una consulta desde la web: "${params.message}"`,
    rows: [
      { label: "Ticket", value: params.ticketNumber, mono: true },
      { label: "Cliente", value: `${params.customerName} (${params.customerEmail})` },
      { label: "Motivo", value: params.topicLabel },
      ...(params.orderNumber
        ? [{ label: "Orden asociada", value: params.orderNumber, mono: true }]
        : []),
    ],
    ctaLabel: "Responder en Admin ERP",
    ctaUrl: adminUrl,
    securityNote:
      "También puedes responder directamente a este correo: el Reply-To apunta al email del cliente.",
  });

  return dispatchEmail({
    to: params.adminTo,
    replyTo: params.customerEmail,
    subject: `[Soporte ${params.ticketNumber}] ${params.subject}`,
    html,
    sandboxLink: adminUrl,
  });
}

export async function sendSupportTicketConfirmationEmailToCustomer(params: {
  to: string;
  replyTo?: string;
  customerName: string;
  ticketNumber: string;
  subject: string;
  orderNumber?: string | null;
}) {
  const helpUrl = `${getSiteUrl()}/account`;
  const html = renderEmailShell({
    preheader: `Recibimos tu consulta ${params.ticketNumber}. Te responderemos muy pronto.`,
    headerRight: `Ticket ${params.ticketNumber}`,
    title: "Recibimos tu mensaje de soporte",
    intro: `Hola ${params.customerName}, registramos tu solicitud correctamente. Nuestro equipo la está revisando y te responderá por este mismo correo y en tu cuenta.`,
    rows: [
      { label: "N.° de ticket", value: params.ticketNumber, mono: true },
      { label: "Asunto", value: params.subject },
      ...(params.orderNumber
        ? [{ label: "Orden referenciada", value: params.orderNumber, mono: true }]
        : []),
      { label: "Estado", value: "Abierto" },
    ],
    ctaLabel: "Ver estado en Mi Cuenta",
    ctaUrl: helpUrl,
    securityNote:
      "Por tu seguridad, jamás compartas contraseñas ni códigos revelados con terceros. Solo respondemos desde canales oficiales.",
  });

  return dispatchEmail({
    to: params.to,
    replyTo: params.replyTo,
    subject: `Ticket recibido · ${params.ticketNumber} · StoryCheap`,
    html,
    sandboxLink: helpUrl,
  });
}

export async function sendSupportTicketReplyEmail(params: {
  to: string;
  replyTo?: string;
  customerName: string;
  ticketNumber: string;
  subject: string;
  replyMessage: string;
  orderNumber?: string | null;
}) {
  const accountUrl = `${getSiteUrl()}/account`;
  const html = renderEmailShell({
    preheader: `Respuesta a tu ticket ${params.ticketNumber}: ${params.replyMessage}`,
    headerRight: `Soporte · ${params.ticketNumber}`,
    title: `Respuesta a: ${params.subject}`,
    intro: `Hola ${params.customerName}, nuestro equipo de soporte respondió tu solicitud (${params.ticketNumber}): "${params.replyMessage}"`,
    rows: [
      { label: "N.° de ticket", value: params.ticketNumber, mono: true },
      ...(params.orderNumber
        ? [{ label: "Orden", value: params.orderNumber, mono: true }]
        : []),
      { label: "Asunto", value: params.subject },
    ],
    ctaLabel: "Ver historial en Mi Cuenta",
    ctaUrl: accountUrl,
    securityNote:
      "Si necesitas agregar más detalles sobre este caso, responde directamente a este correo o escríbenos desde Centro de Ayuda.",
  });

  return dispatchEmail({
    to: params.to,
    replyTo: params.replyTo,
    subject: `Re: ${params.subject} (${params.ticketNumber}) · StoryCheap`,
    html,
    sandboxLink: accountUrl,
  });
}
