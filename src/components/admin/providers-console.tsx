"use client";

import React, { useState } from "react";
import { toggleProviderConfigAction } from "@/app/admin/actions";
import { formatCents } from "@/lib/catalog-seed";
import type { SupplierBalanceStatus } from "@/lib/server/suppliers/types";
import type { ProviderConfigDTO, WebhookEventDTO } from "@/types";
import { AlertTriangle, Power, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export function ProvidersConsole({
  providers,
  reloadlyStatus,
  centralOneStatus,
  webhooks,
}: {
  providers: ProviderConfigDTO[];
  reloadlyStatus: SupplierBalanceStatus;
  centralOneStatus: SupplierBalanceStatus;
  webhooks: WebhookEventDTO[];
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleToggle = async (cfg: ProviderConfigDTO) => {
    setBusyId(cfg.id);
    try {
      await toggleProviderConfigAction({
        id: cfg.id,
        enabled: !cfg.enabled,
      });
      toast.success(
        `${cfg.label}: ${!cfg.enabled ? "ACTIVADO" : "PAUSADO (Kill Switch)"}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Supplier Balances & Notices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-3xl bg-sky-500/10 border border-sky-500/25 p-5 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
          <div className="text-xs text-sky-100 leading-relaxed space-y-1">
            <div className="font-black text-sky-300">
              Central One API (Gift Cards)
            </div>
            <p>
              Webhook: <code>/api/webhooks/centralone</code>. No tiene modo sandbox: cada compra consume saldo real en Central One.
            </p>
            <p className="text-sky-200/90 font-bold">
              Saldo actual:{" "}
              {centralOneStatus.configured
                ? centralOneStatus.balanceCents !== null
                  ? `${formatCents(centralOneStatus.balanceCents)} ${centralOneStatus.currency}`
                  : centralOneStatus.errorMessage ?? "Error"
                : centralOneStatus.errorMessage}
            </p>
          </div>
        </div>

        <div className="rounded-3xl bg-amber-500/10 border border-amber-500/25 p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-100 leading-relaxed space-y-1">
            <div className="font-black text-amber-300">
              Política de Proveedor Reloadly (Seguridad de Capital)
            </div>
            <p>
              Mantén Reloadly desactivado (<code>enabled: false</code>) y opera con tu{" "}
              <strong>Inventario Propio CSV</strong> hasta contar con una cuenta Reloadly comercial verificada con KYC propio y sin VPN.
            </p>
            <p className="text-amber-200/80">
              Estado actual SDK:{" "}
              {reloadlyStatus.configured
                ? `Conectado (${reloadlyStatus.sandbox ? "Sandbox" : "Live"}) — Balance: ${
                    reloadlyStatus.balanceCents !== null
                      ? formatCents(reloadlyStatus.balanceCents)
                      : "Error"
                  }`
                : reloadlyStatus.errorMessage}
            </p>
          </div>
        </div>
      </div>

      {/* Kill Switches */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map((cfg) => (
          <div
            key={cfg.id}
            className="rounded-3xl apple-glass p-5 flex items-center justify-between gap-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <Power
                  className={`w-4 h-4 ${
                    cfg.enabled ? "text-emerald-400" : "text-slate-500"
                  }`}
                />
                <h3 className="text-sm font-black text-white">{cfg.label}</h3>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Modo: {cfg.sandboxMode ? "Sandbox / Test" : "Producción"} • ID:{" "}
                <code>{cfg.id}</code>
              </p>
            </div>

            <button
              type="button"
              disabled={busyId === cfg.id}
              onClick={() => void handleToggle(cfg)}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                cfg.enabled
                  ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                  : "bg-slate-800 text-slate-300 border border-white/10 hover:bg-slate-700"
              }`}
            >
              {cfg.enabled ? "Activo" : "Pausado"}
            </button>
          </div>
        ))}
      </div>

      {/* Webhook Audit Log */}
      <div className="rounded-3xl apple-glass overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-black text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <span>Eventos Webhook Verificados (ZenoBank Svix)</span>
          </h2>
          <span className="text-[11px] text-slate-400">
            Idempotencia por event_id
          </span>
        </div>

        {webhooks.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">
            Aún no se han recibido webhooks en esta sesión.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="px-5 py-3">Fecha</th>
                  <th className="px-5 py-3">Gateway / Evento</th>
                  <th className="px-5 py-3">Event ID</th>
                  <th className="px-5 py-3">Firma</th>
                  <th className="px-5 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {webhooks.map((w) => (
                  <tr key={w.id}>
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
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-bold text-[10px]">
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
    </div>
  );
}
