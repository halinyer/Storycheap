"use client";

import React, { useState } from "react";
import { adjustCustomerCreditAction } from "@/app/admin/actions";
import { formatCents } from "@/lib/catalog-seed";
import type { CustomerSummaryDTO } from "@/types";
import { Search, Wallet } from "lucide-react";
import { toast } from "sonner";

export function CustomersConsole({
  customers,
}: {
  customers: CustomerSummaryDTO[];
}) {
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [deltaUsd, setDeltaUsd] = useState("5.00");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = customers.filter((c) =>
    c.email.toLowerCase().includes(query.trim().toLowerCase())
  );

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    const cents = Math.round(Number.parseFloat(deltaUsd) * 100);
    if (!Number.isFinite(cents) || cents === 0) {
      toast.error("Ingresa un monto válido en USD (ej. 5.00 o -2.50)");
      return;
    }
    setSaving(true);
    try {
      await adjustCustomerCreditAction({
        userId: selectedUserId,
        deltaCents: cents,
        note,
      });
      toast.success("Ajuste contable registrado en credit_ledger");
      setSelectedUserId(null);
      setNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al ajustar saldo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cliente por correo..."
          className="w-full rounded-2xl bg-slate-950/80 border border-white/15 pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none"
        />
      </div>

      {selectedUserId && (
        <form
          onSubmit={handleAdjust}
          className="rounded-3xl apple-glass p-6 space-y-4 border border-amber-500/35"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-400" />
              <span>
                Ajustar Saldo a Favor —{" "}
                {customers.find((c) => c.id === selectedUserId)?.email}
              </span>
            </h3>
            <button
              type="button"
              onClick={() => setSelectedUserId(null)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancelar
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">
                Monto USD (+ sumar / - restar)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={deltaUsd}
                onChange={(e) => setDeltaUsd(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white font-mono"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-slate-400 mb-1">
                Motivo obligatorio (Audit Log)
              </label>
              <input
                type="text"
                required
                minLength={5}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej. Compensación por pago manual o corrección contable"
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2.5 rounded-xl bg-white hover:bg-sky-300 text-slate-950 font-black text-xs"
          >
            {saving ? "Registrando..." : "Aplicar asiento en ledger"}
          </button>
        </form>
      )}

      <div className="rounded-3xl apple-glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.04] text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="px-5 py-3">Correo</th>
                <th className="px-5 py-3">Rol</th>
                <th className="px-5 py-3">Órdenes</th>
                <th className="px-5 py-3">Total Comprado</th>
                <th className="px-5 py-3">Saldo a favor</th>
                <th className="px-5 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-white/[0.02]">
                  <td className="px-5 py-4 font-bold text-white">{c.email}</td>
                  <td className="px-5 py-4 uppercase text-[10px] text-slate-400">
                    {c.role}
                  </td>
                  <td className="px-5 py-4 text-slate-300">{c.ordersCount}</td>
                  <td className="px-5 py-4 text-slate-200">
                    {formatCents(c.totalSpentCents)} USD
                  </td>
                  <td className="px-5 py-4 font-black text-emerald-400">
                    {formatCents(c.creditBalanceCents)} USD
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedUserId(c.id)}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white text-white hover:text-slate-950 font-bold text-[11px] transition-colors"
                    >
                      Ajustar saldo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
