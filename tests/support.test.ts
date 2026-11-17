import { beforeEach, describe, expect, it } from "vitest";
import {
  createSupportTicket,
  getSupportSettings,
  listSupportTicketsAdmin,
  listSupportTicketsForUser,
  replySupportTicketAdmin,
  saveSupportSettings,
} from "@/lib/server/repository";
import { resetSandboxStateForTests } from "@/lib/server/sandbox-db";
import {
  normalizeWhatsAppUrl,
  toPublicSupportConfig,
} from "@/lib/support-channels";

describe("Support channels & ticket repository", () => {
  beforeEach(() => {
    resetSandboxStateForTests();
  });

  it("normalizes WhatsApp links cleanly for public display", async () => {
    expect(
      normalizeWhatsAppUrl("+58 412-555-0199", "Hola orden SC-123")
    ).toBe(
      "https://wa.me/584125550199?text=Hola%20orden%20SC-123"
    );
    expect(normalizeWhatsAppUrl("123")).toBeNull();

    const saved = await saveSupportSettings({
      whatsappEnabled: true,
      whatsappNumber: "+58 414-999-8877",
      supportEmail: "ayuda@storycheap.com",
      adminNotifyEmail: "privado@storycheap.com",
      floatingWidgetEnabled: true,
    });

    const pub = toPublicSupportConfig(saved);
    expect(pub.whatsappUrl).toBe("https://wa.me/584149998877");
    expect(pub.whatsappDisplay).toBe("+584149998877");
    expect(pub.supportEmail).toBe("ayuda@storycheap.com");
    expect("adminNotifyEmail" in pub).toBe(false);

    const fetched = await getSupportSettings();
    expect(fetched.adminNotifyEmail).toBe("privado@storycheap.com");
  });

  it("creates tickets, scopes user lookup, and persists admin replies", async () => {
    const t1 = await createSupportTicket({
      userId: "00000000-0000-4000-8000-00000000c001",
      customerName: "Carlos",
      customerEmail: "carlos@storycheap.com",
      orderNumber: "sc-998811",
      topic: "PAYMENT",
      subject: "Pago Móvil enviado",
      message: "Adjunto referencia 4821 de Bancamiga para revisión.",
    });

    expect(t1.ticketNumber).toMatch(/^SUP-\d{6}$/);
    expect(t1.orderNumber).toBe("SC-998811");
    expect(t1.status).toBe("OPEN");

    await createSupportTicket({
      userId: null,
      customerName: "Visitante",
      customerEmail: "otro@ejemplo.com",
      topic: "GENERAL",
      subject: "Consulta catálogo",
      message: "¿Tienen gift cards de Amazon USA disponibles ahora mismo?",
    });

    const allAdmin = await listSupportTicketsAdmin();
    expect(allAdmin).toHaveLength(2);

    const userOnly = await listSupportTicketsForUser(
      "00000000-0000-4000-8000-00000000c001",
      "carlos@storycheap.com"
    );
    expect(userOnly).toHaveLength(1);
    expect(userOnly[0]?.id).toBe(t1.id);

    const replied = await replySupportTicketAdmin({
      ticketId: t1.id,
      status: "RESOLVED",
      reply: "Listo Carlos, validamos tu transferencia y liberamos tu código.",
      actorEmail: "admin@storycheap.com",
    });

    expect(replied.status).toBe("RESOLVED");
    expect(replied.adminReply).toContain("liberamos tu código");
    expect(replied.repliedBy).toBe("admin@storycheap.com");
  });
});
