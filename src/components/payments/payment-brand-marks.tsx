import React from "react";
import { Lock, ShieldCheck } from "lucide-react";

export function UsdtMark({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#26A17B" />
      <path
        fill="#FFFFFF"
        d="M17.92 17.05v-.003c-.11.008-.68.042-1.94.042-1.01 0-1.72-.03-1.97-.042v.004c-3.88-.171-6.78-.846-6.78-1.653 0-.806 2.9-1.481 6.78-1.654v2.637c.25.018.98.061 1.99.061 1.21 0 1.81-.05 1.92-.06v-2.638c3.87.173 6.77.848 6.77 1.654 0 .806-2.9 1.481-6.77 1.653Zm0-3.578v-2.36h5.42V7.53H8.65v3.582h5.36v2.36c-4.39.202-7.69 1.074-7.69 2.118 0 1.044 3.3 1.916 7.69 2.119v7.583h3.91v-7.585c4.38-.202 7.67-1.073 7.67-2.117 0-1.044-3.29-1.915-7.67-2.118Z"
      />
    </svg>
  );
}

export function UsdcMark({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#2775CA" />
      <path
        fill="#FFFFFF"
        d="M16 6.2c-5.4 0-9.8 4.4-9.8 9.8s4.4 9.8 9.8 9.8 9.8-4.4 9.8-9.8-4.4-9.8-9.8-9.8Zm0 17.6c-4.3 0-7.8-3.5-7.8-7.8s3.5-7.8 7.8-7.8 7.8 3.5 7.8 7.8-3.5 7.8-7.8 7.8Z"
        opacity="0.3"
      />
      <path
        fill="#FFFFFF"
        d="M16.9 20.6v1.5h-1.8v-1.5c-1.8-.3-2.9-1.3-3-2.9h1.8c.1.9.7 1.4 2.1 1.4 1.3 0 2-.5 2-1.3 0-.7-.5-1.1-1.9-1.4l-1.1-.2c-1.9-.4-2.8-1.2-2.8-2.7 0-1.4 1-2.4 2.8-2.7v-1.5h1.8v1.5c1.5.3 2.5 1.2 2.7 2.6h-1.8c-.2-.7-.7-1.2-1.8-1.2-1.1 0-1.8.4-1.8 1.2 0 .6.4 1 1.7 1.3l1.1.2c2.1.4 3 1.2 3 2.8 0 1.6-1 2.6-3 2.9Z"
      />
    </svg>
  );
}

export function BitcoinMark({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#F7931A" />
      <path
        fill="#FFFFFF"
        d="M21.8 13.9c.3-2-1.2-3-3.3-3.7l.7-2.7-1.7-.4-.7 2.6c-.4-.1-.9-.2-1.3-.3l.7-2.6-1.7-.4-.7 2.7c-.4-.1-.7-.2-1.1-.3l-2.3-.6-.4 1.8s1.2.3 1.2.3c.7.2.8.6.8 1l-.8 3.2c0 .1.1.2.1.2-.1 0-.1 0-.2-.1l-1.1 4.4c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.5c.4.1.8.2 1.2.3l-.7 2.7 1.7.4.7-2.7c.5.1.9.2 1.3.3l-.7 2.7 1.7.4.7-2.7c2.9.5 5-.3 5.9-2.8.7-2.1 0-3.3-1.5-4.1 1.1-.2 1.9-.9 2.1-2.4Zm-3.8 5.3c-.5 2-3.9.9-5 .7l.9-3.6c1.1.3 4.6.8 4.1 2.9Zm.5-5.3c-.5 1.8-3.3.9-4.2.7l.8-3.3c.9.2 3.9.7 3.4 2.6Z"
      />
    </svg>
  );
}

export function CardNetworksBadge() {
  return (
    <div className="flex items-center gap-1" aria-label="Redes de pago aceptadas">
      <UsdtMark className="w-4 h-4 rounded-full ring-1 ring-white/15" />
      <UsdcMark className="w-4 h-4 rounded-full ring-1 ring-white/15" />
      <BitcoinMark className="w-4 h-4 rounded-full ring-1 ring-white/15" />
      <span className="inline-flex items-center justify-center h-4 px-1.5 rounded bg-white text-[#1434CB] text-[8px] font-black tracking-tighter">
        VISA
      </span>
      <span className="inline-flex items-center justify-center h-4 px-1 rounded bg-slate-900 border border-white/15">
        <span className="w-2 h-2 rounded-full bg-[#EB001B]" />
        <span className="w-2 h-2 rounded-full bg-[#F79E1B] -ml-1 opacity-90" />
      </span>
    </div>
  );
}

export function PagoMovilBrandMark({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <div
      className={`${className} rounded-lg bg-gradient-to-br from-emerald-500/20 via-sky-500/15 to-emerald-600/20 border border-emerald-400/35 flex items-center justify-center text-emerald-300 font-black text-[11px] tracking-tight shrink-0 shadow-inner`}
    >
      Bs
    </div>
  );
}

export function ZenoBankBrandMark({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <div
      className={`${className} rounded-lg bg-gradient-to-br from-sky-500/25 via-indigo-500/20 to-sky-600/20 border border-sky-400/35 flex items-center justify-center text-sky-300 font-black text-[11px] tracking-tight shrink-0 shadow-inner`}
    >
      ZB
    </div>
  );
}

export function StripeSecurityFooter({ label }: { label?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-2 text-[11px] text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <Lock className="w-3 h-3 text-slate-400" />
        <span>Conexión cifrada TLS</span>
      </span>
      <span className="text-slate-700">•</span>
      <span className="inline-flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
        <span>{label ?? "Entrega inmediata garantizada"}</span>
      </span>
    </div>
  );
}
