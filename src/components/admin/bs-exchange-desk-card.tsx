"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchLiveVenezuelaRatesAction,
  saveBsRateAutoSyncPolicyAction,
  updateBsRateAction,
} from "@/app/admin/actions";
import { formatCents } from "@/lib/catalog-seed";
import { formatBsCents } from "@/lib/server/sales-metrics";
import type {
  BsRateAutoSyncPolicy,
  LiveVenezuelaRatesSnapshot,
  TreasuryPositionSummary,
  VenezuelaRateBenchmarkKey,
} from "@/types";
import {
  ArrowRightLeft,
  Check,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

export interface BsExchangeDeskCardProps {
  bsRateCents: number | null;
  initialPolicy?: BsRateAutoSyncPolicy | null;
  initialLiveRates?: LiveVenezuelaRatesSnapshot | null;
  position?: Pick<
    TreasuryPositionSummary,
    | "pagomovilBalanceBsCents"
    | "pagomovilBalanceUsdCents"
    | "pagomovilMarkToMarketUsdtCents"
    | "unrealizedExchangeDiffUsdCents"
    | "exchangeDiffUsdCents"
    | "pagomovilRealNetProfitUsdCents"
    | "pagomovilSalesGrossUsdCents"
    | "weightedBookBsRateCents"
    | "pagomovilBreakEvenRateCents"
  > | null;
  onOpenSwapModal?: () => void;
  compact?: boolean;
}

const SPREAD_PRESETS = [0, 2, 3, 5, 7];

export function BsExchangeDeskCard({
  bsRateCents,
  initialPolicy,
  initialLiveRates,
  position,
  onOpenSwapModal,
  compact = false,
}: BsExchangeDeskCardProps) {
  const router = useRouter();
  const [liveRates, setLiveRates] = useState<LiveVenezuelaRatesSnapshot | null>(
    initialLiveRates ?? null
  );
  const [benchmark, setBenchmark] = useState<VenezuelaRateBenchmarkKey>(
    initialPolicy?.benchmark ?? "binance_p2p"
  );
  const [spreadInput, setSpreadInput] = useState<string>(
    String(initialPolicy?.spreadPct ?? 5)
  );
  const [autoMode, setAutoMode] = useState<boolean>(
    initialPolicy ? initialPolicy.mode === "auto" : true
  );
  const [manualRateInput, setManualRateInput] = useState<string>(
    bsRateCents ? (bsRateCents / 100).toFixed(2) : ""
  );
  const [showManualOverride, setShowManualOverride] = useState(false);
  const [busy, setBusy] = useState<"refresh" | "apply" | "manual" | null>(null);

  const spreadPct = useMemo(() => {
    const parsed = Number(spreadInput.replace(",", "."));
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(35, Math.max(-10, parsed));
  }, [spreadInput]);

  const baseReferenceBs = useMemo(() => {
    if (!liveRates) return null;
    if (benchmark === "binance_p2p") {
      return liveRates.binanceP2p ?? liveRates.paralelo ?? liveRates.euroBcv;
    }
    if (benchmark === "euro_bcv") {
      return liveRates.euroBcv ?? liveRates.officialBcv;
    }
    if (benchmark === "official_bcv") {
      return liveRates.officialBcv;
    }
    if (benchmark === "paralelo") {
      return liveRates.paralelo ?? liveRates.binanceP2p;
    }
    const vals = [
      liveRates.binanceP2p,
      liveRates.paralelo,
      liveRates.euroBcv,
      liveRates.officialBcv,
    ].filter((v): v is number => typeof v === "number" && v > 0);
    return vals.length > 0 ? Math.max(...vals) : null;
  }, [liveRates, benchmark]);

  const calculatedTargetBs = useMemo(() => {
    if (!baseReferenceBs || baseReferenceBs <= 0) return null;
    return Math.round(baseReferenceBs * (1 + spreadPct / 100) * 100) / 100;
  }, [baseReferenceBs, spreadPct]);

  const cushionBs = useMemo(() => {
    if (!baseReferenceBs || !calculatedTargetBs) return 0;
    return Math.round((calculatedTargetBs - baseReferenceBs) * 100) / 100;
  }, [baseReferenceBs, calculatedTargetBs]);

  const handleRefreshRates = async () => {
    setBusy("refresh");
    try {
      const snap = await fetchLiveVenezuelaRatesAction();
      setLiveRates(snap);
      toast.success("Cotizaciones actualizadas en vivo");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo actualizar tasas"
      );
    } finally {
      setBusy(null);
    }
  };

  const handleApplyCalculatedRate = async () => {
    setBusy("apply");
    try {
      const res = await saveBsRateAutoSyncPolicyAction({
        mode: autoMode ? "auto" : "manual",
        benchmark,
        spreadPct,
        onlyIncrease: true,
        autoSyncIntervalMinutes: 15,
        syncNow: true,
      });
      if (res.rates) {
        setLiveRates(res.rates);
      }
      toast.success(
        res.bsRateCents
          ? `Tasa activa actualizada a Bs ${(res.bsRateCents / 100).toFixed(2)} / $1 USD`
          : "Configuración de tasa guardada"
      );
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo aplicar la tasa"
      );
    } finally {
      setBusy(null);
    }
  };

  const handleApplyManualRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(manualRateInput.trim().replace(",", "."));
    if (!Number.isFinite(val) || val <= 0) {
      toast.error("Ingresa un monto válido en Bs.");
      return;
    }
    setBusy("manual");
    try {
      await saveBsRateAutoSyncPolicyAction({
        mode: "manual",
        benchmark,
        spreadPct,
        onlyIncrease: true,
        autoSyncIntervalMinutes: 15,
        syncNow: false,
      });
      await updateBsRateAction(val);
      setAutoMode(false);
      setShowManualOverride(false);
      toast.success(`Tasa manual fijada en Bs ${val.toFixed(2)} / $1 USD`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error guardando tasa manual"
      );
    } finally {
      setBusy(null);
    }
  };

  const hasBsSales = Boolean(
    position && position.pagomovilSalesGrossUsdCents > 0
  );
  const netRealProfitCents = position?.pagomovilRealNetProfitUsdCents ?? 0;
  const isWinningInBs = netRealProfitCents >= 0;

  return (
    <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 space-y-5">
      {/* Header: Active Store Rate + Auto-Pilot Status */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-sky-400">
              Mesa de Cambio · Bolívares y Tasa USDT
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                autoMode
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
                  : "bg-white/[0.06] text-slate-300 border-white/10"
              }`}
            >
              {autoMode ? "Piloto Automático Activo" : "Modo Manual"}
            </span>
          </div>
          <h3 className="text-base font-bold text-white mt-1">
            ¿A cuánto cobramos el dólar hoy y cómo van las cuentas en Bs?
          </h3>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Tasa Activa en Tienda Hoy
            </div>
            <div className="text-xl font-black font-mono tabular-nums text-emerald-300">
              {bsRateCents
                ? `Bs ${(bsRateCents / 100).toFixed(2)} / $1`
                : "Sin configurar"}
            </div>
          </div>
          <button
            type="button"
            disabled={busy === "refresh"}
            onClick={() => void handleRefreshRates()}
            title="Consultar precios actuales de Binance P2P y BCV"
            className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-slate-300 hover:text-white transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${
                busy === "refresh" ? "animate-spin text-emerald-400" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {/* Main 2-Column Layout: Left = Rate Calculator (+5% Cushion), Right = Bs Profit/Loss & Bank Balance */}
      <div
        className={`grid grid-cols-1 ${
          compact ? "" : "xl:grid-cols-12"
        } gap-5 items-stretch`}
      >
        {/* LEFT COLUMN (7 cols): Simple 1-2-3 Rate Calculator */}
        <div
          className={`${
            compact ? "" : "xl:col-span-7"
          } rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-4 flex flex-col justify-between`}
        >
          <div className="space-y-4">
            {/* Step 1: Pick Base Reference */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white">
                  1. Elige la tasa base de referencia
                </span>
                <button
                  type="button"
                  onClick={() => setShowManualOverride((v) => !v)}
                  className="text-[11px] font-semibold text-slate-400 hover:text-white underline"
                >
                  {showManualOverride
                    ? "Volver a calculadora"
                    : "Escribir tasa fija a mano"}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  {
                    id: "binance_p2p" as const,
                    label: "USDT P2P",
                    sub: "Binance",
                    value: liveRates?.binanceP2p ?? null,
                  },
                  {
                    id: "euro_bcv" as const,
                    label: "Euro BCV",
                    sub: "Oficial EUR",
                    value: liveRates?.euroBcv ?? null,
                  },
                  {
                    id: "official_bcv" as const,
                    label: "Dólar BCV",
                    sub: "Oficial USD",
                    value: liveRates?.officialBcv ?? null,
                  },
                  {
                    id: "highest" as const,
                    label: "La Más Alta",
                    sub: "Máx protección",
                    value:
                      liveRates
                        ? Math.max(
                            liveRates.binanceP2p ?? 0,
                            liveRates.paralelo ?? 0,
                            liveRates.euroBcv ?? 0,
                            liveRates.officialBcv ?? 0
                          ) || null
                        : null,
                  },
                ].map((opt) => {
                  const selected = benchmark === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setBenchmark(opt.id)}
                      className={`text-left rounded-xl p-2.5 border transition-all ${
                        selected
                          ? "bg-indigo-500/15 border-indigo-400 text-white"
                          : "bg-slate-950/60 hover:bg-white/[0.04] border-white/[0.08] text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-bold">{opt.label}</span>
                        {selected && (
                          <Check className="w-3 h-3 text-indigo-300 shrink-0" />
                        )}
                      </div>
                      <div className="text-sm font-black font-mono tabular-nums text-white mt-1">
                        {opt.value ? `Bs ${opt.value.toFixed(2)}` : "—"}
                      </div>
                      <div className="text-[10px] text-slate-400">{opt.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {showManualOverride ? (
              <form
                onSubmit={(e) => void handleApplyManualRate(e)}
                className="rounded-xl bg-slate-950 border border-white/10 p-3.5 space-y-2.5"
              >
                <label className="block text-xs font-bold text-slate-200">
                  Fijar tasa manual exacta (Bs por cada $1 USD):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="Ej. 1120.00"
                    value={manualRateInput}
                    onChange={(e) => setManualRateInput(e.target.value)}
                    className="flex-1 rounded-xl bg-slate-900 border border-white/15 px-3 py-2 text-sm font-mono tabular-nums font-bold text-white"
                  />
                  <button
                    type="submit"
                    disabled={busy === "manual"}
                    className="px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs"
                  >
                    {busy === "manual" ? "Guardando..." : "Fijar Manual"}
                  </button>
                </div>
              </form>
            ) : (
              /* Step 2: Protective Cushion (+%) */
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-white">
                    2. Suma tu colchón de protección (%)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Te protege si el USDT sube mientras cambias los Bs
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {SPREAD_PRESETS.map((preset) => {
                    const active = Math.abs(spreadPct - preset) < 0.01;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setSpreadInput(String(preset))}
                        className={`px-3 py-1.5 rounded-xl text-xs font-mono tabular-nums font-bold border transition-colors ${
                          active
                            ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
                            : "bg-slate-950/60 hover:bg-white/[0.06] border-white/10 text-slate-300"
                        }`}
                      >
                        +{preset}%
                      </button>
                    );
                  })}

                  <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-[11px] text-slate-400">Otro %:</span>
                    <input
                      type="number"
                      step="0.5"
                      min={-10}
                      max={35}
                      value={spreadInput}
                      onChange={(e) => setSpreadInput(e.target.value)}
                      className="w-20 rounded-xl bg-slate-950 border border-white/15 px-2.5 py-1.5 text-xs font-mono tabular-nums font-bold text-white text-right"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Live Visual Equation & Apply Button */}
          {!showManualOverride && (
            <div className="rounded-xl bg-slate-950/90 border border-white/10 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                <div className="text-slate-300">
                  Base:{" "}
                  <strong className="text-white">
                    {baseReferenceBs ? `Bs ${baseReferenceBs.toFixed(2)}` : "—"}
                  </strong>
                  {"  +  "}
                  Colchón ({spreadPct >= 0 ? `+${spreadPct}%` : `${spreadPct}%`}):{" "}
                  <strong className="text-emerald-300">
                    {cushionBs >= 0 ? `+Bs ${cushionBs.toFixed(2)}` : `Bs ${cushionBs.toFixed(2)}`}
                  </strong>
                </div>
                <div className="text-sm font-black text-emerald-300">
                  = Cobrarás a:{" "}
                  {calculatedTargetBs
                    ? `Bs ${calculatedTargetBs.toFixed(2)} / $1`
                    : "—"}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/[0.07]">
                <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoMode}
                    onChange={(e) => setAutoMode(e.target.checked)}
                    className="rounded border-white/25 bg-slate-900 text-emerald-400"
                  />
                  <span>
                    Si mañana sube el mercado, subir mi tasa sola manteniendo el{" "}
                    <strong className="text-white">+{spreadPct}%</strong> (nunca baja sola)
                  </span>
                </label>

                <button
                  type="button"
                  disabled={busy === "apply" || !calculatedTargetBs}
                  onClick={() => void handleApplyCalculatedRate()}
                  className="px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {busy === "apply"
                      ? "Aplicando..."
                      : calculatedTargetBs
                        ? `Aplicar Bs ${calculatedTargetBs.toFixed(2)}/$`
                        : "Aplicar Tasa"}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN (5 cols): Clear Bs Health & Bank Balance Summary */}
        {position && (
          <div
            className={`${
              compact ? "" : "xl:col-span-5"
            } rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 flex flex-col justify-between gap-4`}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white">
                  3. Tu Dinero en Bolívares Ahora Mismo
                </span>
                {hasBsSales && (
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                      isWinningInBs
                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
                        : "bg-rose-500/15 text-rose-300 border-rose-400/30"
                    }`}
                  >
                    {isWinningInBs ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    <span>
                      {isWinningInBs ? "Ganando en Bs" : "Alerta Devaluación"}
                    </span>
                  </span>
                )}
              </div>

              {/* Box A: Bs in Bank -> Frozen at collection vs How many USDT it buys today */}
              <div className="rounded-xl bg-slate-950/70 border border-white/[0.07] p-3.5 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    Bolívares en tu banco (congelados):
                  </span>
                  <span className="text-base font-black font-mono tabular-nums text-white">
                    {formatBsCents(position.pagomovilBalanceBsCents)}
                  </span>
                </div>

                {position.weightedBookBsRateCents && (
                  <div className="flex items-baseline justify-between gap-2 text-[11px] font-mono tabular-nums">
                    <span className="text-slate-400 font-sans">
                      Tasa promedio a la que cayeron:
                    </span>
                    <span className="text-slate-200 font-bold">
                      Bs {(position.weightedBookBsRateCents / 100).toFixed(2)} / $1
                    </span>
                  </div>
                )}

                <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-white/[0.06]">
                  <span className="text-[11px] text-slate-400">
                    Valían al cobrar (congelado):
                  </span>
                  <span className="text-xs font-bold font-mono tabular-nums text-slate-200">
                    {formatCents(position.pagomovilBalanceUsdCents)} USD
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    Compran hoy en Binance P2P:
                  </span>
                  <span className="text-sm font-black font-mono tabular-nums text-sky-300">
                    ≈ {formatCents(position.pagomovilMarkToMarketUsdtCents)} USDT
                    {position.pagomovilBalanceBsCents > 0 &&
                      position.unrealizedExchangeDiffUsdCents !== 0 && (
                        <span
                          className={`ml-1.5 text-xs ${
                            position.unrealizedExchangeDiffUsdCents >= 0
                              ? "text-emerald-300"
                              : "text-rose-300"
                          }`}
                        >
                          ({position.unrealizedExchangeDiffUsdCents >= 0 ? "+" : ""}
                          {formatCents(position.unrealizedExchangeDiffUsdCents)})
                        </span>
                      )}
                  </span>
                </div>
              </div>

              {/* Box B: Plain-Spanish Verdict + Old-Rate Devaluation Alert */}
              <div
                className={`rounded-xl p-3.5 border space-y-1.5 ${
                  !hasBsSales
                    ? "bg-white/[0.02] border-white/[0.07]"
                    : isWinningInBs
                      ? "bg-emerald-500/[0.07] border-emerald-400/25"
                      : "bg-rose-500/[0.08] border-rose-400/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-200">
                    Ganancia / Pérdida Real en Ventas Bs:
                  </span>
                  <span
                    className={`text-base font-black font-mono tabular-nums ${
                      !hasBsSales
                        ? "text-slate-300"
                        : isWinningInBs
                          ? "text-emerald-300"
                          : "text-rose-300"
                    }`}
                  >
                    {netRealProfitCents >= 0 ? "+" : ""}
                    {formatCents(netRealProfitCents)} USD
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {!hasBsSales
                    ? "Lo que ya cayó en tu Pago Móvil nunca cambia cuando subes la tasa de la tienda: cada pago queda congelado a la tasa del momento en que entró."
                    : position.pagomovilBalanceBsCents > 0 &&
                        position.unrealizedExchangeDiffUsdCents < 0
                      ? isWinningInBs
                        ? `Aviso de tasa vieja: estos Bs entraron a Bs ${((position.weightedBookBsRateCents ?? 0) / 100).toFixed(2)}/$ y con la subida actual compran ${formatCents(Math.abs(position.unrealizedExchangeDiffUsdCents))} menos en USDT, pero tu colchón/margen absorbió la subida y sigues ganando +${formatCents(netRealProfitCents)} netos.`
                        : `Alerta de pérdida por tasa vieja: cobraste estos Bs a Bs ${((position.weightedBookBsRateCents ?? 0) / 100).toFixed(2)}/$ y la subida del dólar ya superó tu margen (${formatCents(netRealProfitCents)}). Pásalos a USDT para frenar la devaluación.`
                      : isWinningInBs
                        ? "Ya descontando lo que te costaron las gift cards en dólares y el cambio a USDT P2P, tus ventas en Bolívares están dando ganancia real."
                        : "El USDT subió respecto a la tasa a la que cobraste. Sube tu colchón (%) o pasa tus Bs del banco a USDT."}
                </p>
                {hasBsSales && position.pagomovilBreakEvenRateCents && (
                  <div className="text-[10px] font-mono tabular-nums text-slate-400 pt-1 border-t border-white/[0.06]">
                    Tasa límite sin perder (Break-Even costo):{" "}
                    <strong className="text-slate-200">
                      Bs {(position.pagomovilBreakEvenRateCents / 100).toFixed(2)} / USDT
                    </strong>
                  </div>
                )}
              </div>
            </div>

            {onOpenSwapModal && (
              <button
                type="button"
                onClick={onOpenSwapModal}
                className="w-full py-2.5 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors"
              >
                <ArrowRightLeft className="w-3.5 h-3.5 text-sky-400" />
                <span>Registrar Cambio de Bs a Binance USDT →</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
