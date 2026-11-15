"use client";

import React, { useMemo, useState } from "react";
import { captureMonthlyCapitalSnapshotAction } from "@/app/admin/actions";
import { ApiAuditSection } from "@/components/admin/api-audit-section";
import type { CapitalSnapshotRecord } from "@/lib/server/repository";
import type { CentralOneOrdersReport } from "@/lib/server/suppliers/centralone";
import type {
  FazerCardsApiOrderSummary,
  SupplierOrdersReport,
} from "@/lib/server/suppliers/fazercards";
import type { AuditLogEntryDTO } from "@/types";
import { FileClock, Scale, Search } from "lucide-react";
import { toast } from "sonner";

export function AuditConsole({
  logs,
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
  initialSnapshots,
  currentMonthKey,
  includeTestOrders,
}: {
  logs: AuditLogEntryDTO[];
  fazerBalanceCents: number | null;
  fazerHealthy: boolean;
  fazerError?: string;
  fazerOrdersReport: SupplierOrdersReport<FazerCardsApiOrderSummary> | null;
  dbFazerConsumedCents: number;
  dbFazerCodes: number;
  centralOneBalanceCents: number | null;
  centralOneHealthy: boolean;
  centralOneError?: string;
  centralOneOrdersReport: CentralOneOrdersReport;
  dbCentralOneConsumedCents: number;
  dbCentralOneCodes: number;
  initialSnapshots: CapitalSnapshotRecord[];
  currentMonthKey: string;
  includeTestOrders: boolean;
}) {
  const [tab, setTab] = useState<"reconciliation" | "logs">("reconciliation");
  const [snapshots, setSnapshots] =
    useState<CapitalSnapshotRecord[]>(initialSnapshots);
  const [capturing, setCapturing] = useState(false);
  const [query, setQuery] = useState("");

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.targetType.toLowerCase().includes(q) ||
        l.targetId.toLowerCase().includes(q) ||
        l.actorRole.toLowerCase().includes(q) ||
        JSON.stringify(l.metadata ?? {}).toLowerCase().includes(q)
    );
  }, [logs, query]);

  const handleCaptureSnapshot = async () => {
    setCapturing(true);
    try {
      const updated = await captureMonthlyCapitalSnapshotAction(currentMonthKey);
      setSnapshots(updated);
      toast.success(`Cierre mensual guardado (${currentMonthKey})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error guardando cierre");
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-400">
            Control Interno y Compliance
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
            Auditoría API y Registro Inmutable
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Conciliación de consumo real por API contra órdenes locales ({includeTestOrders ? "incluye pruebas" : "solo órdenes reales"}) y bitácora de eventos administrativos.
          </p>
        </div>

        <div className="inline-flex rounded-xl bg-white/[0.04] border border-white/[0.08] p-1 gap-1">
          <button
            type="button"
            onClick={() => setTab("reconciliation")}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors ${
              tab === "reconciliation"
                ? "bg-indigo-500 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Conciliación APIs vs DB</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("logs")}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors ${
              tab === "logs"
                ? "bg-indigo-500 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <FileClock className="w-3.5 h-3.5" />
            <span>Bitácora ({logs.length})</span>
          </button>
        </div>
      </div>

      {tab === "reconciliation" ? (
        <ApiAuditSection
          fazerBalanceCents={fazerBalanceCents}
          fazerHealthy={fazerHealthy}
          fazerError={fazerError}
          fazerOrdersReport={fazerOrdersReport}
          dbFazerConsumedCents={dbFazerConsumedCents}
          dbFazerCodes={dbFazerCodes}
          centralOneBalanceCents={centralOneBalanceCents}
          centralOneHealthy={centralOneHealthy}
          centralOneError={centralOneError}
          centralOneOrdersReport={centralOneOrdersReport}
          dbCentralOneConsumedCents={dbCentralOneConsumedCents}
          dbCentralOneCodes={dbCentralOneCodes}
          snapshots={snapshots}
          currentMonthKey={currentMonthKey}
          capturing={capturing}
          onCaptureSnapshot={handleCaptureSnapshot}
        />
      ) : (
        <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">
                Eventos de Auditoría ({filteredLogs.length})
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Acciones sensibles de administración, movimientos y entregas registradas.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar acción, ID o detalle..."
                className="w-full rounded-xl bg-white/[0.04] border border-white/10 pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
              />
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No hay registros que coincidan con el filtro.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/[0.06]">
                  <tr>
                    <th className="px-5 py-3">Fecha</th>
                    <th className="px-5 py-3">Actor</th>
                    <th className="px-5 py-3">Acción</th>
                    <th className="px-5 py-3">Objetivo</th>
                    <th className="px-5 py-3">Metadata</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {filteredLogs.map((l) => (
                    <tr key={l.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3 text-slate-400 whitespace-nowrap">
                        {new Date(l.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 font-bold text-slate-200 uppercase">
                        {l.actorRole}
                      </td>
                      <td className="px-5 py-3 font-mono font-bold text-indigo-300">
                        {l.action}
                      </td>
                      <td className="px-5 py-3 text-slate-300">
                        {l.targetType} /{" "}
                        <span className="font-mono text-white">
                          {l.targetId.slice(0, 12)}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-[11px] text-slate-400 max-w-md truncate">
                        {JSON.stringify(l.metadata ?? {})}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
