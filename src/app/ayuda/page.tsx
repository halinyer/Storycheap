import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  HelpCircle,
  Lock,
  Mail,
  ShieldCheck,
  Wallet,
} from "lucide-react";

export default function HelpPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">
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
          <span>Centro de Ayuda y Políticas</span>
        </div>
        <h1 className="text-3xl font-black text-white">
          Compra con total claridad
        </h1>
        <p className="text-sm text-slate-300 leading-relaxed">
          Aquí explicamos cómo protegemos tu dinero, cómo funcionan los bloqueos regionales de las tarjetas y qué ocurre si un pago cripto llega parcial o fuera de tiempo.
        </p>
      </div>

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
            Apenas se confirma tu pago, te enviamos un correo automático desde{" "}
            <span className="font-mono text-white">pedidos@storycheap.com</span>{" "}
            con el recibo y el enlace directo a tu orden. Por seguridad contra accesos no autorizados a tu bandeja de correo, el PIN secreto permanece cifrado con AES-256-GCM y solo se descifra cuando haces clic en &quot;Revelar códigos&quot; dentro de tu cuenta (jamás pedimos datos ni enviamos códigos por WhatsApp).
          </p>
        </div>

        <div className="rounded-3xl apple-glass p-6 space-y-3">
          <ShieldCheck className="w-6 h-6 text-indigo-400" />
          <h2 className="text-base font-black text-white">
            Soporte directo humano
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            ¿Tu orden quedó en estado &quot;En revisión&quot; o tuviste algún problema al canjear? No vuelvas a pagar. Contáctanos indicando tu número de orden <span className="font-mono text-white">SC-XXXXXX</span>:
          </p>
          <div className="pt-1 flex items-center gap-2 text-xs font-bold text-sky-400">
            <Mail className="w-4 h-4" />
            <span>soporte@storycheap.com</span>
          </div>
        </div>
      </div>
    </div>
  );
}
