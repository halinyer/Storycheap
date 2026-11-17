import type {
  PublicSupportConfigDTO,
  SupportSettingsDTO,
  SupportTicketStatus,
  SupportTicketTopic,
} from "@/types";

export const SUPPORT_TOPIC_LABELS: Record<SupportTicketTopic, string> = {
  ORDER_ISSUE: "Problema con una orden",
  PAYMENT: "Pago (Cripto / Pago Móvil)",
  CODE_REDEEM: "Canje o región de código",
  GENERAL: "Consulta general",
};

export const SUPPORT_STATUS_META: Record<
  SupportTicketStatus,
  { label: string; badgeClass: string }
> = {
  OPEN: {
    label: "Abierto",
    badgeClass: "bg-amber-500/15 border-amber-400/30 text-amber-200",
  },
  IN_PROGRESS: {
    label: "En revisión",
    badgeClass: "bg-sky-500/15 border-sky-400/30 text-sky-200",
  },
  RESOLVED: {
    label: "Respondido / Resuelto",
    badgeClass: "bg-emerald-500/15 border-emerald-400/30 text-emerald-200",
  },
};

export function normalizeWhatsAppDigits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

export function normalizeWhatsAppUrl(
  raw: string | null | undefined,
  prefillText?: string
): string | null {
  const digits = normalizeWhatsAppDigits(raw);
  if (digits.length < 7) return null;
  const base = `https://wa.me/${digits}`;
  if (!prefillText?.trim()) return base;
  return `${base}?text=${encodeURIComponent(prefillText.trim())}`;
}

export function buildWhatsAppOrderUrl(
  baseUrl: string | null | undefined,
  prefillText: string
): string | null {
  if (!baseUrl) return null;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}text=${encodeURIComponent(prefillText)}`;
}

export function toPublicSupportConfig(
  settings: SupportSettingsDTO
): PublicSupportConfigDTO {
  const whatsappUrl = settings.whatsappEnabled
    ? normalizeWhatsAppUrl(settings.whatsappNumber)
    : null;
  const whatsappDigits = normalizeWhatsAppDigits(settings.whatsappNumber);

  return {
    supportEmail: settings.supportEmail || "soporte@storycheap.com",
    whatsappUrl,
    whatsappDisplay: whatsappUrl ? `+${whatsappDigits}` : null,
    supportHours:
      settings.supportHours || "Todos los días · 9:00 AM – 10:00 PM (VEN)",
    floatingWidgetEnabled: Boolean(settings.floatingWidgetEnabled),
    welcomeMessage:
      settings.welcomeMessage ||
      "¿Tienes dudas con tu orden o pago? Escríbenos y te respondemos directo.",
  };
}
