"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/context/store-context";
import { KeyRound, Lock, Mail, Shield, Sparkles } from "lucide-react";
import { toast } from "sonner";

type AuthMode = "password" | "register" | "magic-link";

function resolveInitialAuthMode(rawMode: string | null): AuthMode {
  if (rawMode === "register") return "register";
  if (rawMode === "magic-link") return "magic-link";
  return "password";
}

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/account";
  const safeNext =
    nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? nextPath
      : "/account";

  const { sandboxEnabled, refreshSession, signInSandbox } = useStore();
  const [authMode, setAuthMode] = useState<AuthMode>(() =>
    resolveInitialAuthMode(searchParams.get("mode"))
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSentMessage(null);

    try {
      if (authMode === "password") {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? "Credenciales inválidas.");
        }
        await refreshSession();
        toast.success("Sesión iniciada con éxito");
        router.push(safeNext);
      } else if (authMode === "register") {
        if (password.length < 6) {
          throw new Error("La contraseña debe tener al menos 6 caracteres.");
        }
        if (password !== confirmPassword) {
          throw new Error("Las contraseñas no coinciden.");
        }
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, next: safeNext }),
        });
        const data = (await res.json()) as {
          error?: string;
          mode?: string;
          message?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? "No se pudo crear tu cuenta.");
        }
        if (data.mode === "sandbox_signed_in" || data.mode === "signed_in") {
          await refreshSession();
          toast.success("Cuenta creada con éxito");
          router.push(safeNext);
        } else {
          setSentMessage(
            data.message ??
              "Te enviamos un correo para confirmar tu cuenta y continuar."
          );
        }
      } else {
        const res = await fetch("/api/auth/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, next: safeNext }),
        });
        const data = (await res.json()) as {
          error?: string;
          mode?: string;
          message?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? "No se pudo procesar el acceso.");
        }

        if (data.mode === "sandbox_signed_in") {
          await refreshSession();
          toast.success("Sesión Sandbox iniciada");
          router.push(safeNext);
        } else {
          setSentMessage(
            data.message ??
              "Revisa tu correo electrónico para abrir tu enlace mágico de acceso."
          );
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de acceso");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
      <div className="rounded-3xl apple-glass p-8 space-y-6">
        <div className="space-y-2 text-center">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center mx-auto text-sky-400">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-black text-white">
            {authMode === "register" ? "Crea tu cuenta" : "Accede a StoryCheap"}
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            {authMode === "password"
              ? "Ingresa con tu correo y contraseña para ver tu bóveda."
              : authMode === "register"
                ? "Registra tu cuenta para guardar tus códigos y saldo a favor."
                : "Te enviamos un enlace mágico a tu correo para entrar sin contraseña."}
          </p>
        </div>

        {/* Tab Selector */}
        <div className="grid grid-cols-3 p-1 rounded-2xl bg-slate-950/60 border border-white/10 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setAuthMode("password");
              setSentMessage(null);
            }}
            className={`py-2 rounded-xl transition-all ${
              authMode === "password"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode("register");
              setSentMessage(null);
            }}
            className={`py-2 rounded-xl transition-all ${
              authMode === "register"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Crear cuenta
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode("magic-link");
              setSentMessage(null);
            }}
            className={`py-2 rounded-xl transition-all ${
              authMode === "magic-link"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Enlace
          </button>
        </div>

        {sentMessage ? (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-5 text-center space-y-2">
            <Sparkles className="w-6 h-6 text-emerald-400 mx-auto" />
            <p className="text-sm font-bold text-white">Revisa tu bandeja de entrada</p>
            <p className="text-xs text-emerald-100 leading-relaxed">{sentMessage}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-bold text-slate-300 mb-2"
              >
                Correo electrónico
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu-correo@ejemplo.com"
                  className="w-full rounded-2xl bg-slate-950/80 border border-white/15 pl-10 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
            </div>

            {(authMode === "password" || authMode === "register") && (
              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-bold text-slate-300 mb-2"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  <input
                    id="login-password"
                    type="password"
                    required
                    minLength={authMode === "register" ? 6 : 1}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      authMode === "register" ? "Mínimo 6 caracteres" : "••••••••••••"
                    }
                    className="w-full rounded-2xl bg-slate-950/80 border border-white/15 pl-10 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  />
                </div>
              </div>
            )}

            {authMode === "register" && (
              <div>
                <label
                  htmlFor="register-password-confirm"
                  className="block text-xs font-bold text-slate-300 mb-2"
                >
                  Confirmar contraseña
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  <input
                    id="register-password-confirm"
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite tu contraseña"
                    className="w-full rounded-2xl bg-slate-950/80 border border-white/15 pl-10 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-2xl bg-white hover:bg-sky-300 text-slate-950 font-black text-sm transition-colors"
            >
              {loading
                ? "Procesando..."
                : authMode === "password"
                  ? "Iniciar sesión"
                  : authMode === "register"
                    ? "Crear cuenta"
                    : "Enviar enlace de acceso"}
            </button>
          </form>
        )}

        {sandboxEnabled && (
          <div className="pt-5 border-t border-white/10 space-y-3">
            <div className="text-[11px] font-black uppercase tracking-wider text-amber-300">
              Acceso rápido Sandbox (Local Dev)
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={async () => {
                  await signInSandbox("carlos@storycheap.com", "customer");
                  router.push(safeNext);
                }}
                className="py-2.5 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-white"
              >
                Cliente Demo
              </button>
              <button
                type="button"
                onClick={async () => {
                  await signInSandbox("admin@storycheap.com", "admin");
                  router.push("/admin");
                }}
                className="py-2.5 px-3 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/40 text-xs font-bold text-amber-200 flex items-center justify-center gap-1.5"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Admin Ops</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-xs text-slate-400">
          Cargando acceso...
        </div>
      }
    >
      <LoginFormInner />
    </Suspense>
  );
}
