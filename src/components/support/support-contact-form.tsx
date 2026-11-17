"use client";

import React, { useState } from "react";
import { useStore } from "@/context/store-context";
import {
  buildWhatsAppOrderUrl,
  SUPPORT_TOPIC_LABELS,
} from "@/lib/support-channels";
import type { SupportTicketTopic } from "@/types";
import { CheckCircle2, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";

interface SupportContactFormProps {
  initialOrderNumber?: string;
  initialTopic?: SupportTicketTopic;
  whatsappUrl?: string | null;
  compact?: boolean;
  onSuccess?: (ticketNumber: string) => void;
}

export function SupportContactForm({
  initialOrderNumber = "",
  initialTopic = "GENERAL",
  whatsappUrl = null,
  compact = false,
  onSuccess,
}: SupportContactFormProps) {
  const { sessionUser } = useStore();
  const [name, setName] = useState("");
  const [emailOverride, setEmailOverride] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [topic, setTopic] = useState<SupportTicketTopic>(initialTopic);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedTicket, setSubmittedTicket] = useState<string | null>(null);

  const email = emailOverride ?? sessionUser?.email ?? "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          orderNumber: orderNumber.trim() || null,
          topic,
          subject,
          message,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        ticket?: { ticketNumber: string };
      };
      if (!res.ok || !data.ticket) {
        throw new Error(data.error ?? "No se pudo enviar tu solicitud.");
      }

      setSubmittedTicket(data.ticket.ticketNumber);
      setSubject("");
      setMessage("");
      toast.success(`Mensaje enviado (${data.ticket.ticketNumber})`);
      onSuccess?.(data.ticket.ticketNumber);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error enviando tu mensaje"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedTicket) {
    return (
      <div className="rounded-2xl bg-emerald-500/10 border border-emerald-400/25 p-5 text-center space-y-3">
        <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
        <div className="space-y-1">
          <div className="text-sm font-black text-white">
            ¡Mensaje recibido! · <span className="font-mono">{submittedTicket}</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Enviamos confirmación a{" "}
            <strong className="text-white">{email}</strong>. Nuestro equipo te responderá por correo y también verás la respuesta dentro de{" "}
            <strong>Mi Cuenta</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSubmittedTicket(null)}
          className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold text-white transition-colors"
        >
          Enviar otra consulta
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={compact ? "space-y-3" : "space-y-4"}>
      <div className={compact ? "grid grid-cols-1 gap-2.5" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
        <div>
          <label className="block text-[11px] font-bold text-slate-300 mb-1">
            Tu nombre
          </label>
          <input
            type="text"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Carlos Pérez"
            className="w-full rounded-xl bg-slate-950/90 border border-white/15 focus:border-sky-400 focus:outline-none px-3 py-2 text-xs text-white placeholder-slate-500"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-300 mb-1">
            Correo para responderte
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmailOverride(e.target.value)}
            placeholder="tucorreo@ejemplo.com"
            className="w-full rounded-xl bg-slate-950/90 border border-white/15 focus:border-sky-400 focus:outline-none px-3 py-2 text-xs text-white placeholder-slate-500"
          />
        </div>
      </div>

      <div className={compact ? "grid grid-cols-1 gap-2.5" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
        <div>
          <label className="block text-[11px] font-bold text-slate-300 mb-1">
            Motivo
          </label>
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value as SupportTicketTopic)}
            className="w-full rounded-xl bg-slate-950/90 border border-white/15 focus:border-sky-400 focus:outline-none px-3 py-2 text-xs text-white"
          >
            {(Object.keys(SUPPORT_TOPIC_LABELS) as SupportTicketTopic[]).map(
              (key) => (
                <option key={key} value={key}>
                  {SUPPORT_TOPIC_LABELS[key]}
                </option>
              )
            )}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-300 mb-1">
            N.° de orden (opcional)
          </label>
          <input
            type="text"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="Ej. SC-123456"
            className="w-full rounded-xl bg-slate-950/90 border border-white/15 focus:border-sky-400 focus:outline-none px-3 py-2 text-xs text-white font-mono placeholder-slate-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-bold text-slate-300 mb-1">
          Asunto
        </label>
        <input
          type="text"
          required
          minLength={3}
          maxLength={120}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Ej. Confirmación de Pago Móvil o duda con tarjeta PlayStation USA"
          className="w-full rounded-xl bg-slate-950/90 border border-white/15 focus:border-sky-400 focus:outline-none px-3 py-2 text-xs text-white placeholder-slate-500"
        />
      </div>

      <div>
        <label className="block text-[11px] font-bold text-slate-300 mb-1">
          Mensaje
        </label>
        <textarea
          required
          minLength={10}
          maxLength={3000}
          rows={compact ? 3 : 4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe brevemente tu consulta o el inconveniente con tu orden..."
          className="w-full rounded-xl bg-slate-950/90 border border-white/15 focus:border-sky-400 focus:outline-none px-3 py-2 text-xs text-white placeholder-slate-500 resize-y"
        />
      </div>

      <div className={whatsappUrl ? "grid grid-cols-1 sm:grid-cols-2 gap-2.5" : ""}>
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-500 hover:from-sky-300 hover:to-indigo-400 disabled:opacity-50 text-slate-950 font-black text-xs inline-flex items-center justify-center gap-2 transition-all shadow-lg shadow-sky-500/20"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Enviando mensaje...</span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>Enviar por correo / ticket</span>
            </>
          )}
        </button>

        {whatsappUrl && (
          <a
            href={
              buildWhatsAppOrderUrl(
                whatsappUrl,
                [
                  "Hola Soporte StoryCheap,",
                  name.trim() ? `Nombre: ${name.trim()}` : null,
                  `Motivo: ${SUPPORT_TOPIC_LABELS[topic]}`,
                  orderNumber.trim()
                    ? `Orden: ${orderNumber.trim().toUpperCase()}`
                    : null,
                  subject.trim() ? `Asunto: ${subject.trim()}` : null,
                  message.trim() ? `Mensaje: ${message.trim()}` : null,
                ]
                  .filter(Boolean)
                  .join("\n")
              ) ?? whatsappUrl
            }
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/35 text-emerald-200 font-black text-xs inline-flex items-center justify-center gap-2 transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Enviar por WhatsApp</span>
          </a>
        )}
      </div>
    </form>
  );
}
