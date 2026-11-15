"use client";

import React from "react";
import Link from "next/link";
import { formatCents } from "@/lib/catalog-seed";
import type { CapitalSnapshotRecord } from "@/lib/server/repository";
import type { CentralOneOrdersReport } from "@/lib/server/suppliers/centralone";
import type {
  FazerCardsApiOrderSummary,
  SupplierOrdersReport,
} from "@/lib/server/suppliers/fazercards";
import { AlertCircle, Camera, CheckCircle2, RefreshCw } from "lucide-react";

export function ApiAuditSection({
  fazerBalanceCents,
  fazerHealthy,
  fazerError,
  fazerOrdersReport,
  dbFazerConsumedCents,
  dbFazerCodes,
  centralOneBalanceCents,
  centralOneHealthy,
  centralOneError,
  centralOneOrdersReport,
  dbCentralOneConsumedCents,
  dbCentralOneCodes,
  snapshots,
  currentMonthKey,
  capturing,
  onCaptureSnapshot,
}: {
  fazerBalanceCents: number | null;
  fazerHealthy: boolean;
  fazerError?: string;
  fazerOrdersReport: SupplierOrdersReport<FazerCardsApiOrderSummary> | null;
  dbFazerConsumedCents: number;
  dbFazerCodes: number;
  centralOneBalanceCents: number | null;
  centralOneHealthy: boolean;
  centralOneError?: string;
  centralOneOrdersReport: CentralOneOrdersReport | null;
  dbCentralOneConsumedCents: number;
  dbCentralOneCodes: number;
  snapshots: CapitalSnapshotRecord[];
  currentMonthKey: string;
  capturing: boolean;
  onCaptureSnapshot: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Auditoría directa APIs vs. Base de Datos
          </h2>
          <p className="text-xs text-slate-400">
            Órdenes consultadas en vivo desde FazerCards y Central One comparadas contra lo registrado en StoryCheap.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={capturing}
            onClick={onCaptureSnapshot}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Camera className="w-3.5 h-3.5 text-sky-400" />
            <span>{capturing ? "Guardando..." : `Guardar foto (${currentMonthKey})`}</span>
          </button>
          <Link
            href="/admin/providers"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs font-medium text-slate-300 hover:text-white"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Configurar APIs</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* FazerCards Live Audit */}
        <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">FazerCards API v2</h3>
              <p className="text-[11px] text-slate-400">GET /balance + GET /orders</p>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                fazerHealthy && (fazerOrdersReport?.healthy ?? true)
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-rose-500/15 text-rose-300"
              }`}
            >
              {fazerHealthy ? (
                <>
                  <CheckCircle2 className="w-3 h-3" /> En línea
                </>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3" /> Error API
                </>
              )}
            </span>
          </div>

          {(fazerError || fazerOrdersReport?.errorMessage) && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/25 px-3 py-2 text-xs text-rose-200">
              {fazerError || fazerOrdersReport?.errorMessage}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2.5 text-xs">
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">Saldo API</div>
              <div className="text-base font-bold text-white mt-0.5">
                {fazerBalanceCents !== null ? formatCents(fazerBalanceCents) : "Error"}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">Gastado API real</div>
              <div className="text-base font-bold text-amber-300 mt-0.5">
                {fazerOrdersReport?.healthy
                  ? formatCents(fazerOrdersReport.totalSpentCents)
                  : "—"}
              </div>
              <div className="text-[10px] text-slate-500">
                {fazerOrdersReport?.completedCount ?? 0} órd. completadas
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">DB StoryCheap</div>
              <div className="text-base font-bold text-emerald-400 mt-0.5">
                {formatCents(dbFazerConsumedCents)}
              </div>
              <div className="text-[10px] text-slate-500">{dbFazerCodes} cód. histórico</div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Últimas órdenes en FazerCards API
            </div>
            {!fazerOrdersReport || fazerOrdersReport.orders.length === 0 ? (
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 text-center text-xs text-slate-500">
                Sin órdenes disponibles en FazerCards API.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06] max-h-60 overflow-y-auto rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs">
                {fazerOrdersReport.orders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-white truncate">{ord.title}</div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {ord.id} · x{ord.quantity} · {ord.status}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-white">
                        {formatCents(ord.totalUsdCents)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {ord.createdAt ? new Date(ord.createdAt).toLocaleDateString() : "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Central One Live Audit */}
        <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">Central One API</h3>
              <p className="text-[11px] text-slate-400">GET /balance + GET /orders</p>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                centralOneHealthy && (centralOneOrdersReport?.healthy ?? true)
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-rose-500/15 text-rose-300"
              }`}
            >
              {centralOneHealthy ? (
                <>
                  <CheckCircle2 className="w-3 h-3" /> En línea
                </>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3" /> Error API
                </>
              )}
            </span>
          </div>

          {(centralOneError || centralOneOrdersReport?.errorMessage) && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/25 px-3 py-2 text-xs text-rose-200">
              {centralOneError || centralOneOrdersReport?.errorMessage}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2.5 text-xs">
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">Saldo API</div>
              <div className="text-base font-bold text-white mt-0.5">
                {centralOneBalanceCents !== null
                  ? formatCents(centralOneBalanceCents)
                  : "Error"}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">Gastado API real</div>
              <div className="text-base font-bold text-amber-300 mt-0.5">
                {centralOneOrdersReport?.healthy
                  ? formatCents(centralOneOrdersReport.totalSpentCents)
                  : "—"}
              </div>
              <div className="text-[10px] text-slate-500">
                {centralOneOrdersReport?.completedCount ?? 0} órd. ejecutadas
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">DB StoryCheap</div>
              <div className="text-base font-bold text-emerald-400 mt-0.5">
                {formatCents(dbCentralOneConsumedCents)}
              </div>
              <div className="text-[10px] text-slate-500">
                {dbCentralOneCodes} cód. histórico
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Últimas órdenes en Central One API
            </div>
            {!centralOneOrdersReport || centralOneOrdersReport.orders.length === 0 ? (
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 text-center text-xs text-slate-500">
                Sin órdenes disponibles en Central One API.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06] max-h-60 overflow-y-auto rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs">
                {centralOneOrdersReport.orders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-medium text-white truncate">
                        {ord.id}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Ref: {ord.referenceCode ?? "—"} · {ord.lineCount} ítem(s) ·{" "}
                        {ord.status}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-white">
                        {formatCents(ord.totalSaleCents)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {ord.createdAt ? new Date(ord.createdAt).toLocaleDateString() : "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Snapshots mensuales guardados */}
      <div className="rounded-2xl bg-slate-900/75 border border-white/[0.08] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            Fotos de Capital Mensual
          </h3>
          <span className="text-[11px] text-slate-400">
            {snapshots.length} registro(s)
          </span>
        </div>
        {snapshots.length === 0 ? (
          <p className="text-xs text-slate-500">
            Aún no hay fotos de capital guardadas. Usa el botón de arriba para registrar el cierre del mes actual ({currentMonthKey}).
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {snapshots.slice(0, 8).map((snap) => (
              <div
                key={snap.month}
                className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">{snap.month}</span>
                  <span className="font-bold text-emerald-400">
                    {formatCents(snap.totalCents)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Fazer {formatCents(snap.byProvider?.fazercards ?? 0)} · C1{" "}
                  {formatCents(snap.byProvider?.centralone ?? 0)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
