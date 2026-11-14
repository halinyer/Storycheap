"use client";

import React from "react";

interface MethodMark {
  id: string;
  label: string;
  soon?: boolean;
  icon: React.ReactNode;
}

function BitcoinMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#F7931A" />
      <path
        fill="#FFFFFF"
        d="M15.4 10.7c.2-1.4-.9-2.2-2.3-2.7l.5-1.9-1.1-.3-.5 1.8c-.3-.1-.6-.1-.9-.2l.5-1.8-1.1-.3-.5 1.9c-.2-.1-.5-.1-.7-.2l-1.5-.4-.3 1.2s.8.2.8.2c.5.1.5.4.5.7l-.5 2.1v.1l-.7 2.9c-.1.2-.2.4-.6.3 0 0-.8-.2-.8-.2l-.5 1.3 1.4.4c.3.1.5.1.8.2l-.5 1.9 1.1.3.5-1.9c.3.1.6.2.9.2l-.5 1.9 1.1.3.5-1.9c1.9.4 3.4.2 4-1.5.5-1.4 0-2.2-1-2.7.7-.2 1.3-.7 1.4-1.7zm-2.5 3.5c-.4 1.4-2.8.7-3.6.5l.6-2.5c.8.2 3.4.6 3 2zm.3-3.6c-.3 1.3-2.3.6-3 .5l.6-2.3c.7.2 2.8.5 2.4 1.8z"
      />
    </svg>
  );
}

function UsdtMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#26A17B" />
      <path
        fill="#FFFFFF"
        d="M7 7.5h10v2.1h-3.8v1.5c2.6.2 4.5.7 4.5 1.4s-1.9 1.2-4.5 1.4v3.9h-2.4v-3.9c-2.6-.2-4.5-.7-4.5-1.4s1.9-1.2 4.5-1.4V9.6H7V7.5zm5 5.9c2.2 0 3.9-.3 3.9-.8s-1.7-.8-3.9-.8-3.9.3-3.9.8 1.7.8 3.9.8z"
      />
    </svg>
  );
}

function UsdcMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#2775CA" />
      <path
        fill="#FFFFFF"
        d="M12.7 15.8v1.1h-1.4v-1.1c-1.1-.2-1.8-.8-2-1.7l1.2-.3c.2.6.6.9 1.4.9.8 0 1.2-.3 1.2-.8 0-.4-.3-.7-1.1-.9l-.8-.2c-1.2-.3-1.8-.9-1.8-1.9 0-1 .7-1.7 1.8-1.9V7.8h1.4V9c.9.2 1.5.7 1.7 1.5l-1.2.3c-.2-.5-.5-.8-1.2-.8-.7 0-1.1.3-1.1.7 0 .4.3.7 1 .8l.8.2c1.3.3 1.9.9 1.9 2 0 1-.7 1.8-1.8 2.1z"
      />
    </svg>
  );
}

function VisaMark() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white text-[9px] font-black italic tracking-tighter text-[#1434CB] leading-none shrink-0">
      VISA
    </span>
  );
}

function MastercardMark() {
  return (
    <svg viewBox="0 0 28 18" className="w-5 h-3.5 shrink-0" aria-hidden="true">
      <circle cx="10" cy="9" r="6" fill="#EB001B" />
      <circle cx="18" cy="9" r="6" fill="#F79E1B" fillOpacity="0.9" />
    </svg>
  );
}

const METHODS: MethodMark[] = [
  { id: "btc", label: "Bitcoin", icon: <BitcoinMark /> },
  { id: "usdt", label: "USDT", icon: <UsdtMark /> },
  { id: "usdc", label: "USDC", icon: <UsdcMark /> },
  { id: "visa", label: "Visa", soon: true, icon: <VisaMark /> },
  { id: "mc", label: "Mastercard", soon: true, icon: <MastercardMark /> },
];

/**
 * Minimalist borderless payment ribbon (`strip` on Home, `card` below product preview).
 */
export function PayYourWay({ variant }: { variant: "strip" | "card" }) {
  if (variant === "card") {
    return (
      <div className="space-y-3 py-1">
        <p className="text-[13px] font-medium text-slate-300">
          Paga a tu manera
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          {METHODS.map((item) => (
            <span
              key={item.id}
              className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                item.soon ? "text-slate-500 opacity-65" : "text-slate-200"
              }`}
              title={item.soon ? `${item.label} (próximamente)` : item.label}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.soon && (
                <span className="text-[10px] text-slate-500">· pronto</span>
              )}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-2 pb-1">
      <div className="flex flex-wrap items-center justify-center sm:justify-between gap-4 py-2.5 px-2 text-xs">
        <div className="flex items-center gap-2.5 text-slate-400">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="font-bold text-slate-200">Paga a tu manera</span>
          <span className="hidden sm:inline text-white/15">•</span>
          <span className="hidden sm:inline text-slate-400">
            Verificación cripto al instante y bóveda cifrada
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {METHODS.map((item) => (
            <span
              key={item.id}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-opacity ${
                item.soon
                  ? "text-slate-500 opacity-70"
                  : "text-slate-200 hover:text-white"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.soon && (
                <span className="text-[10px] font-normal text-slate-500">
                  (pronto)
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
