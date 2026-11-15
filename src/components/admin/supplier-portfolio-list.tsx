"use client";

import React from "react";
import Link from "next/link";
import { formatCents, formatExactUsd } from "@/lib/catalog-seed";
import type { SupplierPortfolioRow } from "@/types";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Package,
  Plus,
  Server,
  XCircle,
} from "lucide-react";

export function SupplierPortfolioList({
  suppliers,
  totalSuppliersUsdCents,
  periodLabel = "en período",
  mode = "compact",
  onTopup,
  title = "Distribuidores Conectados",
  subtitle = "Capital disponible en tiempo real por proveedor, consumo real y fondeo acumulado.",
}: {
  suppliers: SupplierPortfolioRow[];
  totalSuppliersUsdCents: number;
  periodLabel?: string;
  mode?: "compact" | "full";
  onTopup?: (supplier: SupplierPortfolioRow) => void;
  title?: string;
  subtitle?: string;
}) {
  const activeCount = suppliers.filter((s) => s.enabled && s.configured).length;
  const alertCount = suppliers.filter((s) => s.needsTopup).length;

  return (
    <section className="rounded-2xl bg-[#0d101b] border border-white/[0.08] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white">{title}</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-400/20">
              {activeCount} activos · {suppliers.length} totales
            </span>
            {alertCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-400/25">
                {alertCount} por recargar
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-right mr-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              Capital Total en Stock
            </div>
            <div className="text-sm font-black font-mono text-white">
              {formatCents(totalSuppliersUsdCents)}
            </div>
          </div>
          {mode === "compact" && (
            <Link
              href="/admin/providers"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs font-semibold text-slate-200 transition-colors"
            >
              <span>Configurar APIs</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>

      {/* Desktop/Tablet Enterprise Table + Mobile Stacked Rows */}
      <div className="divide-y divide-white/[0.05]">
        {suppliers.map((s) => {
          const bal = s.balanceCents ?? 0;
          const sharePct =
            totalSuppliersUsdCents > 0 && bal > 0
              ? Math.min(100, Math.round((bal / totalSuppliersUsdCents) * 100))
              : 0;

          const statusTone = !s.enabled
            ? "bg-slate-800/80 text-slate-400 border-slate-700"
            : !s.configured
              ? "bg-slate-800/60 text-slate-400 border-slate-700/80"
              : !s.healthy
                ? "bg-rose-500/15 text-rose-300 border-rose-400/30"
                : s.needsTopup
                  ? "bg-amber-500/15 text-amber-300 border-amber-400/30"
                  : "bg-emerald-500/15 text-emerald-300 border-emerald-400/25";

          const statusLabel = !s.enabled
            ? "Pausado"
            : !s.configured
              ? "Sin credenciales"
              : !s.healthy
                ? "Error API"
                : s.needsTopup
                  ? "Saldo bajo"
                  : "En línea";

          const exactDisplay =
            s.balanceCents === null
              ? "—"
              : formatExactUsd(s.balanceCents, s.exactBalanceUsd);

          return (
            <div
              key={s.id}
              className="px-5 py-4 hover:bg-white/[0.02] transition-colors flex flex-col xl:flex-row xl:items-center justify-between gap-4"
            >
              {/* Left: Identity & Health */}
              <div className="flex items-start sm:items-center gap-3.5 min-w-[240px] xl:w-[30%]">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-white/10"
                  style={{ backgroundColor: `${s.accentColor}1a` }}
                >
                  {s.kind === "api" ? (
                    <Server className="w-4 h-4" style={{ color: s.accentColor }} />
                  ) : (
                    <Package className="w-4 h-4" style={{ color: s.accentColor }} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-white truncate">
                      {s.label}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusTone}`}
                    >
                      {!s.healthy && s.configured && s.enabled ? (
                        <XCircle className="w-2.5 h-2.5" />
                      ) : s.needsTopup ? (
                        <AlertTriangle className="w-2.5 h-2.5" />
                      ) : s.enabled && s.configured ? (
                        <CheckCircle2 className="w-2.5 h-2.5" />
                      ) : null}
                      <span>{statusLabel}</span>
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {s.errorMessage && !s.healthy ? (
                      <span className="text-rose-300">{s.errorMessage}</span>
                    ) : (
                      s.subtitle
                    )}
                  </div>
                </div>
              </div>

              {/* Center: Exact Balance + Share Bar + Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 items-center">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    Saldo Real
                  </div>
                  <div className="text-sm font-black font-mono text-white mt-0.5">
                    {exactDisplay}
                  </div>
                  <div className="mt-1.5 h-1.5 w-full max-w-[110px] rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${sharePct}%`,
                        backgroundColor: s.accentColor,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    Consumo {periodLabel}
                  </div>
                  <div className="text-xs font-bold font-mono text-slate-200 mt-0.5">
                    {formatCents(s.periodConsumedCents)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {s.periodCodesCount}{" "}
                    {s.periodCodesCount === 1 ? "código" : "códigos"}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    Ganancia {periodLabel}
                  </div>
                  <div
                    className={`text-xs font-bold font-mono mt-0.5 ${
                      s.periodProfitCents >= 0
                        ? "text-emerald-300"
                        : "text-rose-300"
                    }`}
                  >
                    {formatCents(s.periodProfitCents)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Histórico: {formatCents(s.allTimeConsumedCents)}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    {mode === "full" && s.kind === "api"
                      ? "Fondeado / Mín."
                      : s.id === "manual"
                        ? "Stock CSV"
                        : "Fondeado (Caja)"}
                  </div>
                  <div className="text-xs font-bold font-mono text-indigo-200 mt-0.5">
                    {s.id === "manual"
                      ? `${s.codesAvailableCount ?? 0} disp.`
                      : formatCents(s.fundedCents)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {s.minBalanceAlertCents > 0
                      ? `Alerta < ${formatCents(s.minBalanceAlertCents)}`
                      : "Sin alerta mínima"}
                  </div>
                </div>
              </div>

              {/* Right: Quick Action */}
              {onTopup && s.kind === "api" && (
                <div className="flex items-center justify-end gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onTopup(s)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                      s.needsTopup
                        ? "bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/40 text-amber-200"
                        : "bg-indigo-500/15 hover:bg-indigo-500/25 border-indigo-400/30 text-indigo-200"
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Recargar</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
