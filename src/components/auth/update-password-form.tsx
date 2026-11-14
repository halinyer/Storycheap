"use client";

import React, { useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface UpdatePasswordFormProps {
  submitLabel?: string;
  onSuccess?: () => void;
}

export function UpdatePasswordForm({
  submitLabel = "Guardar nueva contraseña",
  onSuccess,
}: UpdatePasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "No se pudo actualizar la contraseña.");
      }

      setSaved(true);
      setPassword("");
      setConfirmPassword("");
      toast.success("Contraseña actualizada con éxito");
      onSuccess?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error actualizando contraseña"
      );
    } finally {
      setLoading(false);
    }
  };

  if (saved) {
    return (
      <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-5 text-center space-y-2">
        <CheckCircle2 className="w-7 h-7 text-emerald-400 mx-auto" />
        <p className="text-sm font-black text-white">
          Contraseña guardada correctamente
        </p>
        <p className="text-xs text-emerald-100/90 leading-relaxed">
          Ya puedes iniciar sesión con tu correo y tu nueva contraseña en cualquier dispositivo.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="new-password"
          className="block text-xs font-bold text-slate-300 mb-2"
        >
          Nueva contraseña
        </label>
        <div className="relative">
          <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
          <input
            id="new-password"
            type={showPassword ? "text" : "password"}
            required
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            className="w-full rounded-2xl bg-slate-950/80 border border-white/15 pl-10 pr-11 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-3 top-3 text-slate-400 hover:text-white p-0.5"
            aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      <div>
        <label
          htmlFor="confirm-new-password"
          className="block text-xs font-bold text-slate-300 mb-2"
        >
          Confirmar nueva contraseña
        </label>
        <div className="relative">
          <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
          <input
            id="confirm-new-password"
            type={showPassword ? "text" : "password"}
            required
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repite la nueva contraseña"
            className="w-full rounded-2xl bg-slate-950/80 border border-white/15 pl-10 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-2xl bg-white hover:bg-sky-300 text-slate-950 font-black text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        <span>{loading ? "Guardando..." : submitLabel}</span>
      </button>
    </form>
  );
}
