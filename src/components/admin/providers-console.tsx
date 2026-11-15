"use client";

import React, { useState } from "react";
import { toggleProviderConfigAction } from "@/app/admin/actions";
import { SupplierPortfolioList } from "@/components/admin/supplier-portfolio-list";
import {
  TreasuryMovementModal,
  type TreasuryMovementModalPreset,
} from "@/components/admin/treasury-movement-modal";
import type {
  ProviderConfigDTO,
  SupplierPortfolioRow,
  WebhookEventDTO,
} from "@/types";
import { AlertTriangle, Power, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export function ProvidersConsole({
  initialProviders,
  webhooks,
  suppliers,
  totalSuppliersUsdCents,
}: {
  initialProviders: ProviderConfigDTO[];
  webhooks: WebhookEventDTO[];
  suppliers: SupplierPortfolioRow[];
  totalSuppliersUsdCents: number;
}) {
  const [providers, setProviders] = useState(initialProviders);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPreset, setModalPreset] = useState<
    TreasuryMovementModalPreset | undefined
  >(undefined);

  const handleToggle = async (p: ProviderConfigDTO) => {
    const next = !p.enabled;
    setTogglingId(p.id);
    try {
      await toggleProviderConfigAction({
        id: p.id,
        enabled: next,
      });
      setProviders((prev) =>
        prev.map((row) =>
          row.id === p.id
            ? { ...row, enabled: next, updatedAt: new Date().toISOString() }
            : row
        )
      );
      toast.success(
        `${p.label} ${next ? "habilitado" : "pausado (Kill Switch)"}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-400">
          Canales y Conectividad
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
          Distribuidores, APIs y Kill Switches
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Estado en vivo de cada distribuidor conectado, control de emergencia para
          pausar pasarelas/proveedores e historial de webhooks entrantes.
        </p>
      </div>

      {/* Scalable vertical list of N suppliers from SUPPLIER_REGISTRY */}
      <SupplierPortfolioList
        suppliers={suppliers}
        totalSuppliersUsdCents={totalSuppliersUsdCents}
        periodLabel="histórico"
        mode="full"
        title="Portafolio de Distribuidores (Escalable)"
        subtitle="Saldos exactos hasta 4 decimales, fondeos recibidos en caja y alertas de recarga."
        onTopup={(s) => {
          setModalPreset({
            movementType: "SUPPLIER_TOPUP",
            sourceAccount: "zenobank",
            targetAccount: s.id,
          });
          setModalOpen(true);
        }}
      />

      {/* Kill Switches */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07]">
          <h2 className="text-sm font-bold text-white">
            Kill Switches de Proveedores y Pasarelas
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Deshabilita instantáneamente un canal de pago o proveedor si detectas
            inestabilidad o agotamiento de saldo.
          </p>
        </div>

        <div className="divide-y divide-white/[0.05]">
          {providers.map((p) => (
            <div
              key={p.id}
              className="px-5 py-4 flex flex-wrap items-center justify-between gap-4 hover:bg-white/[0.015] transition-colors"
            >
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-bold text-white">{p.label}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                      p.enabled
                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/25"
                        : "bg-rose-500/15 text-rose-300 border-rose-400/30"
                    }`}
                  >
                    {p.enabled ? "Activo" : "Pausado"}
                  </span>
                  {p.sandboxMode && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-400/25 text-[10px] font-bold">
                      SANDBOX
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                  id: {p.id} · actualizado{" "}
                  {new Date(p.updatedAt).toLocaleString()}
                </div>
              </div>

              <button
                type="button"
                disabled={togglingId === p.id}
                onClick={() => handleToggle(p)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-colors border ${
                  p.enabled
                    ? "bg-rose-500/15 hover:bg-rose-500/25 border-rose-400/30 text-rose-200"
                    : "bg-emerald-500 hover:bg-emerald-400 border-emerald-400 text-slate-950"
                }`}
              >
                {p.enabled ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Pausar Canal</span>
                  </>
                ) : (
                  <>
                    <Power className="w-3.5 h-3.5" />
                    <span>Reactivar</span>
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Webhooks */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <div>
            <h2 className="text-sm font-bold text-white">
              Últimos Webhooks de Pagos
            </h2>
            <p className="text-[11px] text-slate-400">
              Notificaciones recibidas desde pasarelas externas y validación Svix.
            </p>
          </div>
        </div>

        {webhooks.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Sin eventos webhook registrados aún.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/[0.06]">
                <tr>
                  <th className="px-5 py-3">Fecha</th>
                  <th className="px-5 py-3">Gateway / Evento</th>
                  <th className="px-5 py-3">Event ID</th>
                  <th className="px-5 py-3">Firma</th>
                  <th className="px-5 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {webhooks.map((w) => (
                  <tr key={w.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-3 text-slate-400 whitespace-nowrap">
                      {new Date(w.processedAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-bold text-white">
                      {w.gateway} • {w.eventType}
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px] text-slate-300">
                      {w.eventId}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                          w.signatureValid
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        {w.signatureValid ? "Svix OK" : "Inválida"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-300">{w.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TreasuryMovementModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        suppliers={suppliers}
        preset={modalPreset}
      />
    </div>
  );
}
