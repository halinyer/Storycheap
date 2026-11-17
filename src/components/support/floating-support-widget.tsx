"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { SupportContactForm } from "@/components/support/support-contact-form";
import type { PublicSupportConfigDTO } from "@/types";
import {
  Clock,
  ExternalLink,
  Headset,
  Mail,
  MessageCircle,
  X,
} from "lucide-react";

export function FloatingSupportWidget() {
  const [config, setConfig] = useState<PublicSupportConfigDTO | null>(null);
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/support", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { config?: PublicSupportConfigDTO } | null) => {
        if (active && data?.config) {
          setConfig(data.config);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!config || !config.floatingWidgetEnabled) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[min(calc(100vw-2rem),380px)] rounded-3xl bg-[#0e111b]/95 backdrop-blur-2xl border border-white/15 shadow-[0_24px_70px_rgba(0,0,0,0.75)] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3 bg-gradient-to-r from-sky-500/15 via-indigo-500/10 to-transparent">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-300 shrink-0">
                <Headset className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-black text-white leading-tight">
                  Soporte StoryCheap
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-400 truncate mt-0.5">
                  <Clock className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="truncate">{config.supportHours}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar soporte"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">
            <p className="text-xs text-slate-300 leading-relaxed">
              {config.welcomeMessage}
            </p>

            {/* Quick External Channels */}
            <div className="space-y-2">
              {config.whatsappUrl && (
                <a
                  href={config.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-2xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 px-3.5 py-2.5 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <MessageCircle className="w-4 h-4 text-emerald-300 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-black text-white">
                        WhatsApp directo
                      </div>
                      <div className="text-[10px] font-mono text-emerald-200/80 truncate">
                        {config.whatsappDisplay}
                      </div>
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                </a>
              )}

              <a
                href={`mailto:${config.supportEmail}`}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 px-3.5 py-2.5 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Mail className="w-4 h-4 text-indigo-300 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white">
                      Correo oficial
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 truncate">
                      {config.supportEmail}
                    </div>
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </a>
            </div>

            {/* Inline Web Ticket Form */}
            {showForm ? (
              <div className="pt-2 border-t border-white/[0.08] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-sky-300">
                    Enviar ticket en la web
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="text-[11px] text-slate-400 hover:text-white"
                  >
                    Ocultar
                  </button>
                </div>
                <SupportContactForm compact whatsappUrl={config.whatsappUrl} />
              </div>
            ) : (
              <div className="pt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="py-2.5 px-3 rounded-xl bg-white hover:bg-sky-200 text-slate-950 font-black text-xs transition-colors"
                >
                  Escribir aquí
                </button>
                <Link
                  href="/ayuda"
                  onClick={() => setOpen(false)}
                  className="py-2.5 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white font-bold text-xs text-center transition-colors"
                >
                  Centro de Ayuda
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Abrir chat y canales de soporte"
        className="group inline-flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-black text-xs shadow-[0_10px_30px_rgba(14,165,233,0.45)] border border-sky-300/30 transition-all hover:scale-105"
      >
        {open ? (
          <X className="w-4 h-4" />
        ) : (
          <Headset className="w-4 h-4" />
        )}
        <span>{open ? "Cerrar" : "Soporte"}</span>
      </button>
    </div>
  );
}
