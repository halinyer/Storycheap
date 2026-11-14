"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { useStore } from "@/context/store-context";
import { AlertTriangle, ArrowRight, KeyRound, Loader2, Shield } from "lucide-react";

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const { sessionUser, isSessionLoading, refreshSession } = useStore();
  const [updated, setUpdated] = useState(false);

  if (isSessionLoading) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
        <div className="rounded-3xl apple-glass p-8 text-center space-y-3">
          <Loader2 className="w-7 h-7 text-sky-400 animate-spin mx-auto" />
          <h1 className="text-lg font-black text-white">
            Verificando enlace de recuperación...
          </h1>
          <p className="text-xs text-slate-400">
            Validando tu sesión segura con Supabase.
          </p>
        </div>
      </div>
    );
  }

  if (!sessionUser) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
        <div className="rounded-3xl apple-glass p-8 space-y-5 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-white">
              {errorParam === "expired"
                ? "El enlace expiró o ya fue usado"
                : "Enlace de recuperación requerido"}
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              {errorParam === "expired"
                ? "Por seguridad los enlaces de recuperación caducan rápido y son de un solo uso. Solicita uno nuevo para definir tu contraseña."
                : "Abre este enlace directamente desde el correo de recuperación o solicita uno nuevo desde la pantalla de acceso."}
            </p>
          </div>
          <div className="space-y-2.5 pt-2">
            <Link
              href="/login?mode=forgot"
              className="w-full py-3.5 px-4 rounded-2xl bg-white hover:bg-sky-300 text-slate-950 font-black text-sm transition-colors flex items-center justify-center gap-2"
            >
              <span>Solicitar enlace de recuperación</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login?mode=magic-link&next=/admin"
              className="w-full py-3 px-4 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-slate-200 flex items-center justify-center"
            >
              Entrar con enlace mágico sin contraseña
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
      <div className="rounded-3xl apple-glass p-8 space-y-6">
        <div className="space-y-2 text-center">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center mx-auto text-sky-400">
            <KeyRound className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-black text-white">
            Nueva contraseña
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            Cuenta verificada:{" "}
            <span className="text-white font-bold">{sessionUser.email}</span>
          </p>
        </div>

        <UpdatePasswordForm
          submitLabel="Guardar nueva contraseña"
          onSuccess={() => {
            setUpdated(true);
            void refreshSession();
          }}
        />

        {updated && (
          <div className="space-y-2.5 pt-2">
            {sessionUser.role === "admin" && (
              <Link
                href="/admin"
                className="w-full py-3.5 px-4 rounded-2xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Shield className="w-4 h-4" />
                <span>Ir al Panel Admin</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            <Link
              href="/account"
              className="w-full py-3 px-4 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-slate-200 flex items-center justify-center gap-2"
            >
              <span>Ir a Mi Cuenta</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-xs text-slate-400">
          Cargando recuperación de contraseña...
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
