"use client";

import React from "react";
import { CheckCircle2, Clock, Radio, ShieldCheck, Smartphone } from "lucide-react";
import { formatCents } from "@/lib/catalog-seed";
import {
  CardNetworksBadge,
  PagoMovilBrandMark,
  ZenoBankBrandMark,
} from "./payment-brand-marks";
import { formatBsNumber } from "./payment-helpers";

export interface PagoMovilAvailabilityInfo {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  bsRateCents: number | null;
  watchdogOnline: boolean;
  watchdogRequired: boolean;
  activeDevices: number;
  lastHeartbeatAt: string | null;
  receiverBankName: string | null;
  receiverAccountType: "natural" | "juridical" | null;
}

interface StripePaymentMethodSelectorProps {
  selectedGateway: "zenobank" | "pagomovil";
  onSelectGateway: (gateway: "zenobank" | "pagomovil") => void;
  amountDueCents: number;
  pagoMovilInfo: PagoMovilAvailabilityInfo | null;
  loadingPagoMovil: boolean;
}

export function StripePaymentMethodSelector({
  selectedGateway,
  onSelectGateway,
  amountDueCents,
  pagoMovilInfo,
  loadingPagoMovil,
}: StripePaymentMethodSelectorProps) {
  const pmAvailable = Boolean(pagoMovilInfo?.available);
  const bsRateCents = pagoMovilInfo?.bsRateCents ?? null;
  const estimatedBsCents =
    bsRateCents && amountDueCents > 0
      ? Math.round((amountDueCents * bsRateCents) / 100)
      : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Método de pago
        </span>
        <span className="text-[11px] text-slate-500">
          Selecciona cómo completar la compra
        </span>
      </div>

      {/* Unified Stripe Payment Element Accordion Container */}
      <div className="rounded-2xl border border-white/[0.1] bg-[#0b0d14] divide-y divide-white/[0.07] overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
        {/* Option 1: ZenoBank */}
        <div
          className={`transition-colors ${
            selectedGateway === "zenobank" ? "bg-[#10131e]" : "hover:bg-white/[0.02]"
          }`}
        >
          <button
            type="button"
            onClick={() => onSelectGateway("zenobank")}
            aria-pressed={selectedGateway === "zenobank"}
            className="w-full px-4 sm:px-5 py-4 flex items-center justify-between gap-3 text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              {/* Stripe-style radio circle */}
              <span
                className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                  selectedGateway === "zenobank"
                    ? "border-sky-400 bg-sky-400/20 ring-4 ring-sky-400/10"
                    : "border-white/25 bg-transparent"
                }`}
              >
                {selectedGateway === "zenobank" && (
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                )}
              </span>

              <ZenoBankBrandMark className="w-8 h-8" />

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-white">
                    Cripto y Tarjetas
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-400/20 text-[10px] font-bold text-sky-300">
                    ZenoBank
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  USDT, USDC, Bitcoin, Binance Pay y tarjetas
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1 shrink-0">
              <CardNetworksBadge />
              <span className="text-[11px] font-mono font-semibold text-slate-300 tabular-nums">
                {formatCents(amountDueCents)} USD
              </span>
            </div>
          </button>

          {selectedGateway === "zenobank" && (
            <div className="px-4 sm:px-5 pb-4 pt-0.5">
              <div className="rounded-xl bg-[#090b10] border border-white/[0.07] p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">Importe en pasarela USD</span>
                  <span className="font-mono font-bold text-white tabular-nums">
                    {formatCents(amountDueCents)} USD
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-400 pt-2 border-t border-white/[0.06]">
                  <span className="inline-flex items-center gap-1.5 text-slate-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    Redirección segura en tiempo real
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    Confirmación instantánea
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Option 2: Pago Móvil (Bs) */}
        <div
          className={`transition-colors ${
            selectedGateway === "pagomovil"
              ? "bg-[#0e1518]"
              : pmAvailable || loadingPagoMovil
                ? "hover:bg-white/[0.02]"
                : "opacity-65"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              if (pmAvailable) onSelectGateway("pagomovil");
            }}
            disabled={!pmAvailable && !loadingPagoMovil}
            aria-pressed={selectedGateway === "pagomovil"}
            className="w-full px-4 sm:px-5 py-4 flex items-center justify-between gap-3 text-left disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                  selectedGateway === "pagomovil"
                    ? "border-emerald-400 bg-emerald-400/20 ring-4 ring-emerald-400/10"
                    : "border-white/25 bg-transparent"
                }`}
              >
                {selectedGateway === "pagomovil" && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                )}
              </span>

              <PagoMovilBrandMark className="w-8 h-8" />

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-white">
                    Pago Móvil
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/20 text-[10px] font-bold text-emerald-300">
                    Bolívares (Bs)
                  </span>
                  {loadingPagoMovil && (
                    <span className="text-[10px] text-slate-400">
                      Consultando tasa...
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {pagoMovilInfo?.receiverBankName
                    ? `Transferencia nacional a ${pagoMovilInfo.receiverBankName}`
                    : "Transferencia nacional instantánea en Venezuela"}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1 shrink-0">
              {pmAvailable && estimatedBsCents > 0 ? (
                <>
                  <span className="text-xs font-mono font-bold text-emerald-300 tabular-nums">
                    Bs. {formatBsNumber(estimatedBsCents)}
                  </span>
                  {bsRateCents && (
                    <span className="text-[10px] text-slate-500 tabular-nums">
                      Tasa {formatBsNumber(bsRateCents)}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[10px] font-semibold text-slate-400">
                  {loadingPagoMovil ? "..." : "No disponible"}
                </span>
              )}
            </div>
          </button>

          {selectedGateway === "pagomovil" && (
            <div className="px-4 sm:px-5 pb-4 pt-0.5">
              {pmAvailable ? (
                <div className="rounded-xl bg-[#090d11] border border-emerald-500/20 p-3.5 space-y-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-slate-400">
                      Monto exacto a transferir
                    </span>
                    <span className="text-base font-mono font-black text-emerald-300 tabular-nums">
                      Bs. {formatBsNumber(estimatedBsCents)}
                    </span>
                  </div>

                  {bsRateCents && (
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span>Tasa congelada en esta orden</span>
                      <span className="font-mono text-slate-200 tabular-nums">
                        1 USD = Bs. {formatBsNumber(bsRateCents)}
                      </span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1.5 text-slate-300">
                      <Smartphone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      Verás los datos Bancamiga al confirmar
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      {pagoMovilInfo?.watchdogOnline ? (
                        <>
                          <Radio className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-300 font-semibold">
                            Verificación automática activa
                          </span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>Reserva de tasa automática</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-3 text-xs text-amber-200">
                  {!pagoMovilInfo?.enabled
                    ? "Pago Móvil está temporalmente deshabilitado. Puedes pagar con ZenoBank."
                    : !pagoMovilInfo?.configured
                      ? "Falta configurar la cuenta bancaria receptora o tasa Bs del día."
                      : pagoMovilInfo?.watchdogRequired && !pagoMovilInfo?.watchdogOnline
                        ? "El verificador bancario automático está en mantenimiento en este momento. Usa ZenoBank o intenta en unos minutos."
                        : "Pago Móvil no está disponible en este momento. Puedes pagar con ZenoBank."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
