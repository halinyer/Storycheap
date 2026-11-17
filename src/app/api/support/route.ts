import { NextResponse, type NextRequest } from "next/server";
import { connection } from "next/server";
import { z } from "zod";
import { getServerSessionUser } from "@/lib/server/auth";
import {
  sendSupportTicketConfirmationEmailToCustomer,
  sendSupportTicketReceivedEmailToAdmin,
} from "@/lib/server/email";
import { checkRateLimit } from "@/lib/server/rate-limit";
import {
  createSupportTicket,
  getSupportSettings,
  listSupportTicketsForUser,
} from "@/lib/server/repository";
import {
  SUPPORT_TOPIC_LABELS,
  toPublicSupportConfig,
} from "@/lib/support-channels";

const createTicketSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Ingresa tu nombre (mínimo 2 caracteres).")
    .max(80),
  email: z.string().trim().email("Ingresa un correo electrónico válido."),
  orderNumber: z
    .string()
    .trim()
    .max(32)
    .optional()
    .nullable(),
  topic: z
    .enum(["ORDER_ISSUE", "PAYMENT", "CODE_REDEEM", "GENERAL"])
    .default("GENERAL"),
  subject: z
    .string()
    .trim()
    .min(3, "Escribe un asunto breve (mínimo 3 caracteres).")
    .max(120),
  message: z
    .string()
    .trim()
    .min(10, "Cuéntanos con más detalle cómo ayudarte (mínimo 10 caracteres).")
    .max(3000),
});

export async function GET() {
  await connection();
  const [settings, sessionUser] = await Promise.all([
    getSupportSettings(),
    getServerSessionUser(),
  ]);

  const myTickets = sessionUser
    ? await listSupportTicketsForUser(sessionUser.id, sessionUser.email)
    : [];

  return NextResponse.json(
    {
      config: toPublicSupportConfig(settings),
      myTickets,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  await connection();
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const rl = checkRateLimit({
    key: `support:${ip}`,
    limit: 6,
    windowMs: 10 * 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          "Has enviado varios mensajes seguidos. Espera unos minutos antes de enviar otro.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload JSON inválido." }, { status: 400 });
  }

  const parsed = createTicketSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Revisa los campos del formulario.",
      },
      { status: 400 }
    );
  }

  const [sessionUser, settings] = await Promise.all([
    getServerSessionUser(),
    getSupportSettings(),
  ]);

  const ticket = await createSupportTicket({
    userId: sessionUser?.id ?? null,
    customerName: parsed.data.name,
    customerEmail: sessionUser?.email ?? parsed.data.email,
    orderNumber: parsed.data.orderNumber || null,
    topic: parsed.data.topic,
    subject: parsed.data.subject,
    message: parsed.data.message,
  });

  const adminInbox = settings.adminNotifyEmail || settings.supportEmail;
  await Promise.allSettled([
    sendSupportTicketReceivedEmailToAdmin({
      adminTo: adminInbox,
      ticketNumber: ticket.ticketNumber,
      customerName: ticket.customerName,
      customerEmail: ticket.customerEmail,
      orderNumber: ticket.orderNumber,
      topicLabel: SUPPORT_TOPIC_LABELS[ticket.topic],
      subject: ticket.subject,
      message: ticket.message,
    }),
    sendSupportTicketConfirmationEmailToCustomer({
      to: ticket.customerEmail,
      replyTo: settings.supportEmail,
      customerName: ticket.customerName,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      orderNumber: ticket.orderNumber,
    }),
  ]);

  return NextResponse.json(
    {
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        createdAt: ticket.createdAt,
      },
    },
    { status: 201 }
  );
}
