"use client";

import React, { useState } from "react";
import { useStore } from "@/context/store-context";
import {
  Check,
  Shield,
  SlidersHorizontal,
  User,
  UserX,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Sandbox-only quick role switcher. Completely hidden whenever production
 * Supabase Auth is active or ENABLE_DEMO_SANDBOX is disabled.
 */
export function DevRoleSwitcher() {
  const { sandboxEnabled, sessionUser, signInSandbox, signOut } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!sandboxEnabled) return null;

  const currentMode = !sessionUser
    ? "guest"
    : sessionUser.role === "admin"
    ? "admin"
    : "customer";

  const handleSwitch = async (mode: "customer" | "admin" | "guest") => {
    setLoading(true);
    try {
      if (mode === "guest") {
        await signOut();
        toast.info("Sesión cerrada (Modo Invitado)");
      } else if (mode === "admin") {
        await signInSandbox("admin@storycheap.com", "admin");
        toast.success("Sesión Admin Sandbox activa");
      } else {
        await signInSandbox("carlos@storycheap.com", "customer");
        toast.success("Sesión Cliente Demo activa (carlos@storycheap.com)");
      }
      setIsOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cambiar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {isOpen && (
        <div className="mb-3 w-80 rounded-[28px] apple-glass p-4 shadow-2xl border border-white/20 backdrop-blur-2xl">
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-black text-white uppercase tracking-wider">
                Sandbox Dev Auth
              </span>
            </div>
            <span className="text-[10px] text-amber-300 font-bold bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
              Local Only
            </span>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleSwitch("customer")}
              className={`w-full flex items-center justify-between p-2.5 rounded-2xl text-left text-xs transition-all ${
                currentMode === "customer"
                  ? "bg-white text-slate-950 font-black"
                  : "bg-white/[0.04] hover:bg-white/[0.08] text-slate-200"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <User className="w-4 h-4" />
                <div>
                  <div className="font-bold">Cliente Demo</div>
                  <div className="text-[11px] opacity-75">carlos@storycheap.com</div>
                </div>
              </div>
              {currentMode === "customer" && <Check className="w-4 h-4 text-emerald-600" />}
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => void handleSwitch("admin")}
              className={`w-full flex items-center justify-between p-2.5 rounded-2xl text-left text-xs transition-all ${
                currentMode === "admin"
                  ? "bg-amber-400 text-slate-950 font-black"
                  : "bg-white/[0.04] hover:bg-white/[0.08] text-slate-200"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4" />
                <div>
                  <div className="font-bold">Operador Admin</div>
                  <div className="text-[11px] opacity-75">Consola /admin</div>
                </div>
              </div>
              {currentMode === "admin" && <Check className="w-4 h-4" />}
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => void handleSwitch("guest")}
              className={`w-full flex items-center justify-between p-2.5 rounded-2xl text-left text-xs transition-all ${
                currentMode === "guest"
                  ? "bg-slate-200 text-slate-950 font-black"
                  : "bg-white/[0.04] hover:bg-white/[0.08] text-slate-200"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <UserX className="w-4 h-4" />
                <div>
                  <div className="font-bold">Visitante / Sin sesión</div>
                  <div className="text-[11px] opacity-75">Compra como invitado</div>
                </div>
              </div>
              {currentMode === "guest" && <Check className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-2 px-3.5 py-2 rounded-full apple-glass border border-white/20 text-xs font-bold text-slate-200 hover:text-white shadow-xl"
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400" />
        <span>Sandbox: {currentMode}</span>
      </button>
    </div>
  );
}
