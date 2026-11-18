"use client";

import React, { useEffect, useState } from "react";
import { Clock, Flame } from "lucide-react";

const PROMO_ENDS_AT_MS = Date.parse("2026-11-21T23:16:00.000Z");

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function computeTimeLeft(nowMs: number): TimeLeft | null {
  const diff = PROMO_ENDS_AT_MS - nowMs;
  if (diff <= 0) return null;

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function PromoCountdownBanner() {
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const update = () => {
      const next = computeTimeLeft(Date.now());
      if (!next) {
        setExpired(true);
        setTimeLeft(null);
      } else {
        setTimeLeft(next);
      }
    };

    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (expired) return null;

  const units = [
    { label: "Días", value: timeLeft ? pad2(timeLeft.days) : "--" },
    { label: "Horas", value: timeLeft ? pad2(timeLeft.hours) : "--" },
    { label: "Min", value: timeLeft ? pad2(timeLeft.minutes) : "--" },
    { label: "Seg", value: timeLeft ? pad2(timeLeft.seconds) : "--" },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
      <div className="rounded-2xl bg-gradient-to-r from-amber-500/15 via-rose-500/10 to-sky-500/15 border border-amber-400/25 px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400/20 border border-amber-300/30 text-[10px] font-black uppercase tracking-wider text-amber-200 shrink-0">
            <Flame className="w-3.5 h-3.5 text-amber-300" />
            <span>Oferta 3 Días</span>
          </span>
          <p className="text-xs sm:text-sm font-bold text-white leading-snug">
            Descuentos activos en el catálogo por tiempo limitado
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-slate-300 mr-1">
            <Clock className="w-3.5 h-3.5 text-amber-300" />
            <span>Termina en</span>
          </span>
          <div className="flex items-center gap-1.5 tabular-nums">
            {units.map((u) => (
              <div
                key={u.label}
                className="min-w-[44px] rounded-xl bg-slate-950/80 border border-white/15 px-2 py-1 text-center"
              >
                <div className="text-sm font-black font-mono text-white leading-none">
                  {u.value}
                </div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">
                  {u.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
