"use client";

import React, { useState } from "react";
import { runReconcileCronAction } from "@/app/admin/actions";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function ReconcileButton() {
  const [running, setRunning] = useState(false);

  const handleClick = async () => {
    setRunning(true);
    try {
      const res = await runReconcileCronAction();
      toast.success(
        `Reconciliación lista: ${res.releasedCodes} códigos liberados, ${res.expiredOrders} órdenes expiradas.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al reconciliar");
    } finally {
      setRunning(false);
    }
  };

  return (
    <button
      type="button"
      disabled={running}
      onClick={() => void handleClick()}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-white transition-colors"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
      <span>Liberar reservas expiradas</span>
    </button>
  );
}
