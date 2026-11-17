"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  replySupportTicketAdminAction,
  updateSupportSettingsAdminAction,
} from "@/app/admin/actions";
import {
  normalizeWhatsAppUrl,
  SUPPORT_STATUS_META,
  SUPPORT_TOPIC_LABELS,
} from "@/lib/support-channels";
import type {
  SupportSettingsDTO,
  SupportTicketDTO,
  SupportTicketStatus,
} from "@/types";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Headset,
  Inbox,
  Mail,
  MessageCircle,
  Save,
  Search,
  Send,
} from "lucide-react";
import { toast } from "sonner";

function TicketCard({ ticket }: { ticket: SupportTicketDTO }) {
  const router = useRouter();
  const [replyText, setReplyText] = useState("");
  const [nextStatus, setNextStatus] = useState<SupportTicketStatus>(
    ticket.status === "OPEN" ? "RESOLVED" : ticket.status
  );
  const [saving, setSaving] = useState(false);

  const statusMeta = SUPPORT_STATUS_META[ticket.status];

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await replySupportTicketAdminAction({
        ticketId: ticket.id,
        status: nextStatus,
        reply: replyText.trim() || null,
      });
      setReplyText("");
      if (replyText.trim()) {
        toast.success(
          res.emailSent
            ? `Respuesta enviada por correo (${ticket.ticketNumber})`
            : `Respuesta guardada en bandeja (${ticket.ticketNumber})`
        );
      } else {
        toast.success(`Estado actualizado (${ticket.ticketNumber})`);
      }
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo actualizar el ticket"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-black text-sky-300">
              {ticket.ticketNumber}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusMeta.badgeClass}`}
            >
              {statusMeta.label}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/10 text-[10px] font-semibold text-slate-300">
              {SUPPORT_TOPIC_LABELS[ticket.topic]}
            </span>
            {ticket.orderNumber && (
              <Link
                href={`/admin/orders?q=${encodeURIComponent(ticket.orderNumber)}`}
                className="px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-400/30 text-[10px] font-mono font-bold text-indigo-200 hover:bg-indigo-500/25"
              >
                Orden {ticket.orderNumber}
              </Link>
            )}
          </div>
          <h3 className="text-sm font-bold text-white">{ticket.subject}</h3>
          <div className="text-[11px] text-slate-400">
            <strong className="text-slate-200">{ticket.customerName}</strong> ·{" "}
            <a
              href={`mailto:${ticket.customerEmail}`}
              className="text-sky-300 hover:underline font-mono"
            >
              {ticket.customerEmail}
            </a>{" "}
            · {new Date(ticket.createdAt).toLocaleString("es-VE")}
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-slate-950/80 border border-white/[0.06] p-3.5 text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
        {ticket.message}
      </div>

      {ticket.adminReply && (
        <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-400/25 p-3.5 space-y-1">
          <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
            <span>Última respuesta ({ticket.repliedBy ?? "Soporte"})</span>
            {ticket.repliedAt && (
              <span className="font-mono text-emerald-200/75">
                {new Date(ticket.repliedAt).toLocaleString("es-VE")}
              </span>
            )}
          </div>
          <p className="text-xs text-emerald-50 whitespace-pre-wrap leading-relaxed">
            {ticket.adminReply}
          </p>
        </div>
      )}

      <form
        onSubmit={handleReplySubmit}
        className="pt-2 border-t border-white/[0.06] space-y-2.5"
      >
        <textarea
          rows={2}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Escribe una respuesta para enviarla por correo al cliente y registrarla en su cuenta (opcional si solo cambias estado)..."
          className="w-full rounded-xl bg-slate-950 border border-white/10 focus:border-sky-400 focus:outline-none px-3 py-2 text-xs text-white placeholder-slate-500 resize-y"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <select
            value={nextStatus}
            onChange={(e) =>
              setNextStatus(e.target.value as SupportTicketStatus)
            }
            className="rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none"
          >
            <option value="OPEN">Estado: Abierto</option>
            <option value="IN_PROGRESS">Estado: En revisión</option>
            <option value="RESOLVED">Estado: Respondido / Resuelto</option>
          </select>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-bold text-xs transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {saving
                ? "Guardando…"
                : replyText.trim()
                  ? "Enviar respuesta y guardar"
                  : "Actualizar estado"}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

export function SupportConsole({
  initialSettings,
  initialTickets,
}: {
  initialSettings: SupportSettingsDTO;
  initialTickets: SupportTicketDTO[];
}) {
  const router = useRouter();
  const [settings, setSettings] =
    useState<SupportSettingsDTO>(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ALL" | SupportTicketStatus>(
    "ALL"
  );
  const [query, setQuery] = useState("");

  const previewWaUrl = normalizeWhatsAppUrl(settings.whatsappNumber);

  const counts = useMemo(() => {
    let open = 0;
    let inProgress = 0;
    let resolved = 0;
    for (const t of initialTickets) {
      if (t.status === "OPEN") open += 1;
      else if (t.status === "IN_PROGRESS") inProgress += 1;
      else resolved += 1;
    }
    return { open, inProgress, resolved };
  }, [initialTickets]);

  const filteredTickets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialTickets.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.ticketNumber.toLowerCase().includes(q) ||
        t.customerName.toLowerCase().includes(q) ||
        t.customerEmail.toLowerCase().includes(q) ||
        (t.orderNumber ?? "").toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.message.toLowerCase().includes(q)
      );
    });
  }, [initialTickets, statusFilter, query]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const saved = await updateSupportSettingsAdminAction({
        ...settings,
        adminNotifyEmail: settings.adminNotifyEmail?.trim() || null,
      });
      setSettings(saved);
      toast.success("Canales y configuración de soporte guardados");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo guardar configuración"
      );
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-400">
            Atención al Cliente
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5 flex items-center gap-2.5">
            <Headset className="w-6 h-6 text-sky-400" />
            <span>Soporte y Canales de Contacto</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Configura tu enlace directo de WhatsApp y correo de soporte, y responde los tickets enviados desde la tienda.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-400/25 text-xs font-mono text-amber-200">
            Abiertos: <strong>{counts.open}</strong>
          </span>
          <span className="px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-400/25 text-xs font-mono text-sky-200">
            En revisión: <strong>{counts.inProgress}</strong>
          </span>
          <span className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-400/25 text-xs font-mono text-emerald-200">
            Resueltos: <strong>{counts.resolved}</strong>
          </span>
          <Link
            href="/ayuda"
            target="_blank"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] text-xs font-semibold text-slate-200 transition-colors"
          >
            <span>Ver página pública</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Direct Channels Configuration */}
      <form
        onSubmit={handleSaveSettings}
        className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white">
              Canales públicos configurables (WhatsApp, Correo y Widget)
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Los cambios se reflejan al instante en `/ayuda`, el botón flotante de la tienda y el resumen de órdenes.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.floatingWidgetEnabled}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  floatingWidgetEnabled: e.target.checked,
                }))
              }
              className="accent-sky-400 w-4 h-4"
            />
            <span>Mostrar botón flotante &ldquo;Soporte&rdquo; en la tienda</span>
          </label>
        </div>

        {/* WhatsApp */}
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.07] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
              <MessageCircle className="w-4 h-4" />
              <span>Canal directo de WhatsApp</span>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.whatsappEnabled}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    whatsappEnabled: e.target.checked,
                  }))
                }
                className="accent-emerald-400 w-4 h-4"
              />
              <span>Activo</span>
            </label>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Número con código de país (sin signos o con +)
            </label>
            <input
              type="text"
              value={settings.whatsappNumber}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  whatsappNumber: e.target.value,
                }))
              }
              placeholder="Ej. +584121234567"
              className="w-full rounded-xl bg-slate-950 border border-white/10 focus:border-emerald-400 focus:outline-none px-3 py-2 text-xs text-white font-mono"
            />
            {previewWaUrl && (
              <div className="mt-1.5 text-[10px] font-mono text-emerald-300/90 truncate">
                Enlace generado: {previewWaUrl}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              <Mail className="w-3 h-3 inline mr-1" />
              Correo público visible al cliente
            </label>
            <input
              type="email"
              required
              value={settings.supportEmail}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  supportEmail: e.target.value,
                }))
              }
              className="w-full rounded-xl bg-slate-950 border border-white/10 focus:border-indigo-400 focus:outline-none px-3 py-2 text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Correo donde recibes alertas (Admin Inbox)
            </label>
            <input
              type="email"
              value={settings.adminNotifyEmail ?? ""}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  adminNotifyEmail: e.target.value,
                }))
              }
              placeholder={`Igual al público (${settings.supportEmail})`}
              className="w-full rounded-xl bg-slate-950 border border-white/10 focus:border-indigo-400 focus:outline-none px-3 py-2 text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              <Clock className="w-3 h-3 inline mr-1" />
              Horario de atención mostrado
            </label>
            <input
              type="text"
              required
              value={settings.supportHours}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  supportHours: e.target.value,
                }))
              }
              className="w-full rounded-xl bg-slate-950 border border-white/10 focus:border-indigo-400 focus:outline-none px-3 py-2 text-xs text-white"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex-1">
            <label className="block text-[11px] text-slate-400 mb-1">
              Mensaje de bienvenida en soporte y widget flotante
            </label>
            <input
              type="text"
              required
              value={settings.welcomeMessage}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  welcomeMessage: e.target.value,
                }))
              }
              className="w-full rounded-xl bg-slate-950 border border-white/10 focus:border-indigo-400 focus:outline-none px-3 py-2 text-xs text-white"
            />
          </div>

          <button
            type="submit"
            disabled={savingSettings}
            className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>{savingSettings ? "Guardando…" : "Guardar canales"}</span>
          </button>
        </div>
      </form>

      {/* Tickets Inbox */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Inbox className="w-4 h-4 text-sky-400" />
            <span>Bandeja de tickets y consultas ({filteredTickets.length})</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar SUP-, email, orden SC-..."
                className="w-full rounded-xl bg-[#0d101b] border border-white/10 pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="inline-flex rounded-xl bg-[#0d101b] border border-white/10 p-1 gap-1">
              {(
                [
                  { id: "ALL", label: "Todos" },
                  { id: "OPEN", label: `Abiertos (${counts.open})` },
                  { id: "IN_PROGRESS", label: `Revisión (${counts.inProgress})` },
                  { id: "RESOLVED", label: `Resueltos (${counts.resolved})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                    statusFilter === tab.id
                      ? "bg-indigo-500 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredTickets.length === 0 ? (
          <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-12 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="text-xs text-slate-400">
              No hay tickets que coincidan con este filtro.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
