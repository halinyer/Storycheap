import React, { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { SupportContactForm } from "@/components/support/support-contact-form";
import { getSupportSettings } from "@/lib/server/repository";
import { toPublicSupportConfig } from "@/lib/support-channels";
import type { SupportTicketTopic } from "@/types";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  ExternalLink,
  Headset,
  HelpCircle,
  Lock,
  Mail,
  MessageCircle,
  ShieldCheck,
  Wallet,
} from "lucide-react";

function normalizeTopicParam(raw: string | undefined): SupportTicketTopic {
  if (
    raw === "ORDER_ISSUE" ||
    raw === "PAYMENT" ||
    raw === "CODE_REDEEM" ||
    raw === "GENERAL"
  ) {
    return raw;
  }
  return "GENERAL";
}

async function HelpPageContent({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; topic?: string }>;
}) {
  await connection();
  const [sp, settings] = await Promise.all([searchParams, getSupportSettings()]);
  const support = toPublicSupportConfig(settings);
  const initialOrder = sp.order?.trim() ?? "";
  const initialTopic = normalizeTopicParam(sp.topic);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Volver al catálogo</span>
      </Link>

      <div className="rounded-3xl apple-glass p-8 space-y-3">
        <div className="inline-flex items-center gap-2 text-xs font-bold text-sky-400">
          <HelpCircle className="w-4 h-4" />
          <span>Soporte Directo y Políticas</span>
        </div>
        <h1 className="text-3xl font-black text-white">
          Estamos aquí para ayudarte
        </h1>
        <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
          {support.welcomeMessage} Contáctanos por tu canal preferido o envíanos un ticket directo indicando tu número de orden si ya realizaste una compra.
        </p>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-[11px] font-semibold text-slate-300">
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          <span>Horario de atención: {support.supportHours}</span>
        </div>
      </div>

      {/* Contact Channels + Ticket Form */}
      <div id="contacto" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Direct Channels */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-3xl apple-glass p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Headset className="w-5 h-5 text-sky-400" />
              <h2 className="text-base font-black text-white">
                Canales directos
              </h2>
            </div>

            <div className="space-y-3">
              {support.whatsappUrl && (
                <a
                  href={support.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-2xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 p-4 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shrink-0">
                      <MessageCircle className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-black text-white">
                        WhatsApp Soporte
                      </div>
                      <div className="text-[11px] font-mono text-emerald-200 truncate">
                        {support.whatsappDisplay}
                      </div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-emerald-300 shrink-0" />
                </a>
              )}

              <a
                href={`mailto:${support.supportEmail}`}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 p-4 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shrink-0">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-black text-white">
                      Correo electrónico
                    </div>
                    <div className="text-[11px] font-mono text-slate-300 truncate">
                      {support.supportEmail}
                    </div>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
              </a>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
              ¿Tu orden quedó en estado &quot;En revisión&quot;? No vuelvas a pagar. Ten a mano tu código{" "}
              <span className="font-mono text-white">SC-XXXXXX</span> para agilizar la atención.
            </p>
          </div>
        </div>

        {/* Right: Web Support Ticket Form */}
        <div className="lg:col-span-7 rounded-3xl apple-glass p-6 sm:p-8 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-black text-white">
              Envíanos un mensaje directo
            </h2>
            <p className="text-xs text-slate-400">
              Recibirás un número de ticket por correo y nuestra respuesta directamente en tu bandeja y dentro de{" "}
              <Link href="/account" className="text-sky-400 hover:underline font-semibold">
                Mi Cuenta
              </Link>
              .
            </p>
          </div>
          <SupportContactForm
            initialOrderNumber={initialOrder}
            initialTopic={initialTopic}
            whatsappUrl={support.whatsappUrl}
          />
        </div>
      </div>

      {/* Policy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-3xl apple-glass p-6 space-y-3">
          <AlertTriangle className="w-6 h-6 text-amber-400" />
          <h2 className="text-base font-black text-white">
            Bloqueo por región (Muy importante)
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            Las gift cards digitales de PlayStation, Nintendo, Xbox, Apple y Netflix están restringidas al país de tu cuenta. Por ejemplo, una tarjeta USA solo se puede canjear en cuentas configuradas en Estados Unidos.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Una vez que un código digital es emitido o revelado en tu bóveda, no puede ser devuelto ni revendido. Por eso mostramos siempre el aviso regional antes de comprar.
          </p>
        </div>

        <div className="rounded-3xl apple-glass p-6 space-y-3">
          <Wallet className="w-6 h-6 text-emerald-400" />
          <h2 className="text-base font-black text-white">
            Pagos parciales, expirados o excedentes
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            Si envías por error menos cripto de lo indicado (por ejemplo por comisión de red) o un monto superior, nunca pierdes ni un centavo:
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Desde la página de tu orden puedes{" "}
            <strong className="text-white">cubrir la diferencia al instante con tu saldo a favor</strong>{" "}
            para recibir el código de inmediato, o{" "}
            <strong className="text-white">convertir el pago parcial en saldo a favor en un clic</strong>{" "}
            sin esperar a que expire el cronómetro. Cualquier excedente también se acredita automáticamente 1:1.
          </p>
        </div>

        <div className="rounded-3xl apple-glass p-6 space-y-3">
          <Lock className="w-6 h-6 text-sky-400" />
          <h2 className="text-base font-black text-white">
            Notificación por correo y bóveda cifrada
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            Apenas se confirma tu pago, te enviamos un correo automático con el recibo y el enlace directo a tu orden. Por seguridad, tu PIN permanece cifrado con AES-256-GCM y solo se descifra al hacer clic en &quot;Revelar códigos&quot; dentro de tu bóveda (jamás enviamos códigos ni pedimos contraseñas por chat o WhatsApp).
          </p>
        </div>

        <div className="rounded-3xl apple-glass p-6 space-y-3">
          <ShieldCheck className="w-6 h-6 text-indigo-400" />
          <h2 className="text-base font-black text-white">
            Atención humana garantizada
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            Cualquier incidencia con Pago Móvil, confirmaciones de red cripto o disponibilidad de códigos queda respaldada por nuestro equipo de soporte en{" "}
            <span className="font-mono text-white">{support.supportEmail}</span> y desde los canales oficiales listados arriba.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; topic?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 text-center text-xs text-slate-400">
          Cargando centro de soporte...
        </div>
      }
    >
      <HelpPageContent searchParams={searchParams} />
    </Suspense>
  );
}
