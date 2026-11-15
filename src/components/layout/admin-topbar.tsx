"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  setAdminIncludeTestsAction,
  updateBsRateAction,
} from "@/app/admin/actions";
import { formatCents } from "@/lib/catalog-seed";
import {
  Bell,
  Check,
  DollarSign,
  ExternalLink,
  FlaskConical,
  Menu,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

export interface AdminTopbarProps {
  totalLiveEquityUsdCents: number;
  totalSuppliersUsdCents: number;
  totalReceiversUsdCents: number;
  bsRateCents: number | null;
  includeTestOrders: boolean;
  needsAttentionCount: number;
  lowStockCount: number;
  unhealthySuppliersCount: number;
  adminEmail: string;
}

export function AdminTopbar({
  totalLiveEquityUsdCents,
  totalSuppliersUsdCents,
  totalReceiversUsdCents,
  bsRateCents,
  includeTestOrders,
  needsAttentionCount,
  lowStockCount,
  unhealthySuppliersCount,
  adminEmail,
}: AdminTopbarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rateOpen, setRateOpen] = useState(false);
  const [rateInput, setRateInput] = useState(
    bsRateCents ? (bsRateCents / 100).toFixed(2) : ""
  );
  const [savingRate, setSavingRate] = useState(false);

  const totalAlerts =
    needsAttentionCount + lowStockCount + unhealthySuppliersCount;

  const handleToggleTests = () => {
    const next = !includeTestOrders;
    startTransition(async () => {
      try {
        await setAdminIncludeTestsAction(next);
        toast.success(
          next
            ? "Mostrando órdenes de prueba en métricas"
            : "Modo operación real: pruebas ocultas"
        );
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "No se pudo cambiar filtro de pruebas"
        );
      }
    });
  };

  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = rateInput.trim().replace(",", ".");
    const parsed = trimmed === "" ? null : Number.parseFloat(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      toast.error("Ingresa una tasa Bs/USD válida (ej. 54.35).");
      return;
    }
    setSavingRate(true);
    try {
      await updateBsRateAction(parsed);
      toast.success(
        parsed === null
          ? "Tasa Bs/USD limpiada"
          : `Tasa actualizada: Bs ${parsed.toFixed(2)} / USD`
      );
      setRateOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la tasa");
    } finally {
      setSavingRate(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-white/[0.07] bg-[#0b0d16]/95 backdrop-blur-xl">
      <div className="max-w-[1680px] mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
        {/* Brand Identity */}
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/admin" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/25 via-sky-500/15 to-emerald-500/20 border border-indigo-400/30 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.18)]">
              <span className="text-xs font-black tracking-tight text-white">
                SC
              </span>
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white group-hover:text-indigo-200 transition-colors">
                  StoryCheap
                </span>
                <span className="hidden sm:inline-flex px-1.5 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-400/25 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                  Admin ERP
                </span>
              </div>
              <p className="hidden sm:block text-[11px] text-slate-500 truncate">
                {adminEmail}
              </p>
            </div>
          </Link>
        </div>

        {/* Right Utility Strip (FazerCards / Central One aesthetic) */}
        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap justify-end">
          {/* Test Orders Mode Switch */}
          <button
            type="button"
            disabled={isPending}
            onClick={handleToggleTests}
            title="Alternar entre operación real y vista con órdenes de prueba incluidas"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-all disabled:opacity-50 ${
              includeTestOrders
                ? "bg-amber-500/15 border-amber-400/35 text-amber-200"
                : "bg-white/[0.03] border-white/[0.08] text-slate-300 hover:bg-white/[0.07]"
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden md:inline">
              {includeTestOrders ? "Pruebas: Visibles" : "Pruebas: Ocultas"}
            </span>
          </button>

          {/* Compact Bs Rate Pill + Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setRateOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.08] text-[11px] font-semibold text-slate-200 transition-colors"
            >
              <DollarSign className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-mono">
                {bsRateCents ? `${(bsRateCents / 100).toFixed(2)} Bs/$` : "Sin tasa Bs"}
              </span>
            </button>

            {rateOpen && (
              <form
                onSubmit={(e) => void handleSaveRate(e)}
                className="absolute right-0 mt-2 w-64 rounded-2xl bg-[#121523] border border-white/15 p-3.5 shadow-2xl space-y-2.5 z-50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    Tasa congelada Bs/USD
                  </span>
                  <button
                    type="button"
                    onClick={() => setRateOpen(false)}
                    className="text-slate-500 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="Ej. 54.35"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    className="flex-1 rounded-xl bg-slate-950 border border-white/15 px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-400"
                  />
                  <button
                    type="submit"
                    disabled={savingRate}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{savingRate ? "..." : "OK"}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Live Total Equity Pill */}
          <Link
            href="/admin/treasury"
            title={`Receptoras ${formatCents(totalReceiversUsdCents)} + Distribuidores ${formatCents(totalSuppliersUsdCents)}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#131727] hover:bg-[#191f34] border border-white/[0.1] text-xs font-semibold text-white transition-colors"
          >
            <Wallet className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="font-mono font-bold">
              {formatCents(totalLiveEquityUsdCents)}
            </span>
          </Link>

          {/* Operational Alerts Bell */}
          <Link
            href={needsAttentionCount > 0 ? "/admin/orders?attention=1" : "/admin/inventory"}
            title="Alertas operativas (órdenes, bajo stock o APIs)"
            className="relative inline-flex items-center justify-center w-9 h-9 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 hover:text-white transition-colors"
          >
            <Bell className="w-4 h-4" />
            {totalAlerts > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center shadow">
                {totalAlerts}
              </span>
            )}
          </Link>

          {/* Exit to Public Store */}
          <Link
            href="/"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-xs font-medium text-slate-200 transition-colors"
          >
            <span>Tienda</span>
            <ExternalLink className="w-3 h-3 text-slate-400" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function AdminMobileHintIcon() {
  return <Menu className="w-4 h-4" />;
}
