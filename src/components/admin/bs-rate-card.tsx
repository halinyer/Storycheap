"use client";

import React, { useState } from "react";
import { updateBsRateAction } from "@/app/admin/actions";
import { DollarSign, Save } from "lucide-react";
import { toast } from "sonner";

export function BsRateCard({
  initialRateCents,
}: {
  initialRateCents: number | null;
}) {
  const [rateInput, setRateInput] = useState(
    initialRateCents ? (initialRateCents / 100).toFixed(2) : ""
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = rateInput.trim().replace(",", ".");
    const parsed = trimmed === "" ? null : Number.parseFloat(trimmed);

    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      toast.error("Ingresa una tasa Bs/USD válida (ej. 54.35).");
      return;
    }

    setSaving(true);
    try {
      await updateBsRateAction(parsed);
      toast.success(
        parsed === null
          ? "Tasa Bs/USD limpiada"
          : `Tasa congelada para nuevas ventas: Bs ${parsed.toFixed(2)} / $1 USD`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la tasa");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSave(e)}
      className="flex flex-wrap items-center gap-2 rounded-2xl apple-glass px-3.5 py-2 border border-white/10"
    >
      <div className="flex items-center gap-1.5 text-xs text-slate-300">
        <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
        <span className="font-bold">Tasa Bs/USD:</span>
      </div>
      <input
        type="number"
        step="0.01"
        min="0.01"
        placeholder="Ej. 54.35"
        value={rateInput}
        onChange={(e) => setRateInput(e.target.value)}
        className="w-24 rounded-lg bg-slate-950 border border-white/15 px-2.5 py-1 text-xs text-white font-mono"
      />
      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-[11px] disabled:opacity-50"
      >
        <Save className="w-3 h-3" />
        <span>{saving ? "..." : "Guardar"}</span>
      </button>
    </form>
  );
}
