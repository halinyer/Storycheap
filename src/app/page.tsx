import React, { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { CatalogFilters } from "@/components/storefront/catalog-filters";
import { GiftCardGrid } from "@/components/storefront/gift-card-grid";
import { HeroSection } from "@/components/storefront/hero-section";
import { PayYourWay } from "@/components/storefront/pay-your-way";
import { listCatalog } from "@/lib/server/repository";
import { isStorePreviewMode } from "@/lib/server/env";
import { CheckCircle2, Lock, ShieldCheck, Zap } from "lucide-react";

async function CatalogSectionLoader() {
  await connection();
  const products = await listCatalog(false);
  return <GiftCardGrid initialProducts={products} />;
}

export default function HomePage() {
  return (
    <div className="min-h-screen pb-16">
      <HeroSection />
      <PayYourWay variant="strip" />

      {/* Catalog Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-2">
        {isStorePreviewMode() && (
          <div className="mb-4 rounded-2xl bg-sky-500/10 border border-sky-500/25 px-4 py-3 text-xs text-sky-100 text-center">
            Estamos terminando los últimos detalles. Las compras se abrirán muy pronto.
          </div>
        )}
        <CatalogFilters />
        <Suspense
          fallback={
            <div className="py-12 text-center text-xs text-slate-400">
              Cargando catálogo oficial...
            </div>
          }
        >
          <CatalogSectionLoader />
        </Suspense>
      </section>

      {/* Honest 3-Step Flow (Direct Checkout — No Wallet Required) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 mt-20">
        <div className="rounded-[32px] apple-glass p-8 sm:p-10">
          <div className="text-center max-w-xl mx-auto mb-10">
            <span className="text-[11px] font-black uppercase tracking-widest text-sky-400">
              Compra directa y transparente
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-white mt-2">
              ¿Cómo funciona StoryCheap?
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center font-black text-sm">
                01
              </div>
              <h3 className="text-base font-extrabold text-white">
                Elige tarjeta y región
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Selecciona tu marca, verifica que coincida con el país de tu cuenta y agrégala directo al carrito.
              </p>
            </div>

            <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-black text-sm">
                02
              </div>
              <h3 className="text-base font-extrabold text-white">
                Inicia sesión y paga el monto exacto
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Tu orden queda protegida en tu cuenta StoryCheap. Si tienes saldo a favor se descuenta automáticamente y, si un pago cripto queda incompleto, puedes cubrir la diferencia o acreditarlo al instante.
              </p>
            </div>

            <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center font-black text-sm">
                03
              </div>
              <h3 className="text-base font-extrabold text-white">
                Recibe correo y revela en tu bóveda
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Al confirmarse el pago te enviamos un correo automático desde{" "}
                <span className="text-slate-200 font-semibold">pedidos@storycheap.com</span>{" "}
                y desbloqueamos tu código cifrado en pantalla y en tu cuenta.
              </p>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-5">
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-sky-400" /> Cifrado AES-256-GCM
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Reserva automática de stock
              </span>
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" /> Protección ante pagos parciales
              </span>
            </div>
            <Link
              href="/ayuda"
              className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 font-bold"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Ver política de regiones y reembolsos</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
