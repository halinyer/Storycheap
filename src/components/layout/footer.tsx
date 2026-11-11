import React from "react";
import Link from "next/link";
import { ShieldCheck, Mail, Lock } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-white/[0.08] bg-[#06070b] mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-10 border-b border-white/[0.06]">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-base font-black text-white">StoryCheap</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-[10px] font-bold text-emerald-300">
                storycheap.com
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
              Tienda de tarjetas digitales oficiales con verificación cripto automática vía ZenoBank y entrega protegida en tu bóveda cifrada.
            </p>
          </div>

          <div className="space-y-2.5 text-xs">
            <h3 className="font-extrabold text-white uppercase tracking-wider text-[11px]">
              Navegación y Soporte
            </h3>
            <ul className="space-y-2 text-slate-400">
              <li>
                <Link href="/" className="hover:text-white transition-colors">
                  Catálogo de Gift Cards
                </Link>
              </li>
              <li>
                <Link href="/account" className="hover:text-white transition-colors">
                  Mis Órdenes y Bóveda de Códigos
                </Link>
              </li>
              <li>
                <Link href="/ayuda" className="hover:text-white transition-colors">
                  Política de Regiones, Reembolsos y Ayuda
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-3 text-xs">
            <h3 className="font-extrabold text-white uppercase tracking-wider text-[11px]">
              Garantías de Seguridad
            </h3>
            <div className="space-y-2 text-slate-400">
              <div className="flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>Códigos cifrados con AES-256-GCM en servidor</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Saldo a favor garantizado ante pagos parciales</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Soporte directo: soporte@storycheap.com</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
          <p>© 2026 StoryCheap. Todos los derechos reservados.</p>
          <p>
            Las marcas mostradas pertenecen a sus respectivos propietarios. Verifica siempre la región antes de comprar.
          </p>
        </div>
      </div>
    </footer>
  );
}
