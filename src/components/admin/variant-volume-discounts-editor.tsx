"use client";

import React, { useMemo, useState } from "react";
import { formatCents } from "@/lib/catalog-seed";
import { formatBsFromUsdCents } from "@/lib/currency";
import {
  MAX_ORDER_QUANTITY_PER_LINE,
  validateVolumeDiscountTiersForAdmin,
} from "@/lib/volume-discounts";
import type { VolumeDiscountTier } from "@/types";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Layers,
  Plus,
  Trash2,
} from "lucide-react";

interface VariantVolumeDiscountsEditorProps {
  basePriceCents: number;
  unitCostCents: number | null;
  bsRateCents?: number | null;
  tiers: VolumeDiscountTier[];
  onChange: (nextTiers: VolumeDiscountTier[]) => void;
}

const PRESET_QUANTITIES = [3, 5, 10] as const;

export function VariantVolumeDiscountsEditor({
  basePriceCents,
  unitCostCents,
  bsRateCents = null,
  tiers,
  onChange,
}: VariantVolumeDiscountsEditorProps) {
  const [expanded, setExpanded] = useState(tiers.length > 0);

  const sortedTiers = useMemo(
    () => [...tiers].sort((a, b) => a.minQuantity - b.minQuantity),
    [tiers]
  );

  const validation = useMemo(
    () =>
      validateVolumeDiscountTiersForAdmin({
        tiers: sortedTiers,
        baseUnitPriceCents: basePriceCents,
        unitCostCents,
      }),
    [sortedTiers, basePriceCents, unitCostCents]
  );

  const suggestSafeUnitPriceCents = (minQty: number): number => {
    if (basePriceCents <= 2) return Math.max(1, basePriceCents - 1);
    const pct = minQty >= 10 ? 0.03 : minQty >= 5 ? 0.02 : 0.01;
    let suggested = Math.max(1, Math.round(basePriceCents * (1 - pct)));
    if (suggested >= basePriceCents) {
      suggested = basePriceCents - 1;
    }
    if (
      typeof unitCostCents === "number" &&
      unitCostCents > 0 &&
      suggested <= unitCostCents &&
      basePriceCents > unitCostCents + 1
    ) {
      suggested = Math.max(
        unitCostCents + 1,
        Math.round((basePriceCents + unitCostCents) / 2)
      );
    }
    return suggested;
  };

  const addTier = (preferredMinQty?: number) => {
    const used = new Set(tiers.map((t) => t.minQuantity));
    const candidate =
      preferredMinQty && !used.has(preferredMinQty)
        ? preferredMinQty
        : [3, 5, 10, 2, 4, 6, 7, 8, 9].find((q) => !used.has(q));

    if (!candidate) return;
    const unitPriceCents = suggestSafeUnitPriceCents(candidate);
    setExpanded(true);
    onChange(
      [...tiers, { minQuantity: candidate, unitPriceCents }].sort(
        (a, b) => a.minQuantity - b.minQuantity
      )
    );
  };

  const updateTier = (
    indexInSorted: number,
    patch: Partial<VolumeDiscountTier>
  ) => {
    const next = sortedTiers.map((tier, idx) =>
      idx === indexInSorted ? { ...tier, ...patch } : tier
    );
    onChange(next.sort((a, b) => a.minQuantity - b.minQuantity));
  };

  const removeTier = (minQuantity: number) => {
    onChange(tiers.filter((t) => t.minQuantity !== minQuantity));
  };

  const usedSet = new Set(sortedTiers.map((t) => t.minQuantity));

  return (
    <div className="rounded-xl border border-white/[0.08] bg-slate-950/60 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-2 text-left text-[11px] font-bold text-slate-200 hover:text-white transition-colors"
        >
          <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>Descuentos por cantidad</span>
          {sortedTiers.length > 0 ? (
            <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-extrabold text-emerald-300">
              {sortedTiers.length}{" "}
              {sortedTiers.length === 1 ? "nivel" : "niveles"}
            </span>
          ) : (
            <span className="text-[10px] font-normal text-slate-400">
              Opcional (p. ej. 3+, 5+, 10+ u.)
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          )}
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          {PRESET_QUANTITIES.filter((q) => !usedSet.has(q)).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => addTier(q)}
              className="px-2 py-0.5 rounded-lg bg-white/[0.05] hover:bg-indigo-500/20 border border-white/10 hover:border-indigo-400/40 text-[10px] font-bold text-slate-300 hover:text-indigo-200 transition-colors"
            >
              + {q}+ u.
            </button>
          ))}
          {sortedTiers.length < MAX_ORDER_QUANTITY_PER_LINE - 1 && (
            <button
              type="button"
              onClick={() => addTier()}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-[10px] font-bold text-indigo-200 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>Nivel</span>
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.06] px-3 py-2.5 space-y-2.5 bg-slate-950/40">
          {sortedTiers.length === 0 ? (
            <p className="text-[11px] text-slate-400">
              Aún no hay descuentos por volumen para esta denominación. Haz clic
              en <strong className="text-slate-200">+ 3+ u.</strong> o{" "}
              <strong className="text-slate-200">+ Nivel</strong> para premiar
              compras múltiples protegiendo tu margen.
            </p>
          ) : (
            <div className="space-y-2">
              {sortedTiers.map((tier, idx) => {
                const discountPct =
                  basePriceCents > 0
                    ? Number(
                        (
                          ((basePriceCents - tier.unitPriceCents) /
                            basePriceCents) *
                          100
                        ).toFixed(2)
                      )
                    : 0;
                const unitProfitCents =
                  typeof unitCostCents === "number" && unitCostCents > 0
                    ? tier.unitPriceCents - unitCostCents
                    : null;
                const unitMarginPct =
                  unitProfitCents !== null && tier.unitPriceCents > 0
                    ? (unitProfitCents / tier.unitPriceCents) * 100
                    : null;
                const bsText = formatBsFromUsdCents(
                  tier.unitPriceCents,
                  bsRateCents
                );
                const isLoss =
                  unitProfitCents !== null && unitProfitCents < 0;
                const isBreakEven =
                  unitProfitCents !== null && unitProfitCents === 0;

                return (
                  <div
                    key={`${tier.minQuantity}-${idx}`}
                    className={`rounded-xl border p-2.5 grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center ${
                      isLoss
                        ? "border-rose-500/45 bg-rose-500/10"
                        : "border-white/[0.08] bg-slate-900/70"
                    }`}
                  >
                    {/* Min Quantity */}
                    <div className="md:col-span-3">
                      <label className="block text-[10px] text-slate-400 font-semibold mb-1">
                        Desde cuántas
                      </label>
                      <select
                        value={tier.minQuantity}
                        onChange={(e) => {
                          const nextQty = Number.parseInt(e.target.value, 10);
                          if (Number.isInteger(nextQty)) {
                            updateTier(idx, { minQuantity: nextQty });
                          }
                        }}
                        className="w-full rounded-lg bg-slate-950 border border-white/15 px-2.5 py-1.5 text-xs font-bold text-white focus:border-sky-400 focus:outline-none"
                      >
                        {Array.from(
                          { length: MAX_ORDER_QUANTITY_PER_LINE - 1 },
                          (_, i) => i + 2
                        ).map((q) => (
                          <option
                            key={q}
                            value={q}
                            disabled={q !== tier.minQuantity && usedSet.has(q)}
                          >
                            {q}+ unidades
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Discounted Unit Price USD */}
                    <div className="md:col-span-3">
                      <label className="block text-[10px] text-slate-400 font-semibold mb-1">
                        Precio c/u ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={(tier.unitPriceCents / 100).toFixed(2)}
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          if (Number.isFinite(parsed) && parsed > 0) {
                            updateTier(idx, {
                              unitPriceCents: Math.round(parsed * 100),
                            });
                          }
                        }}
                        className="w-full rounded-lg bg-slate-950 border border-white/15 px-2.5 py-1.5 text-xs font-mono font-bold text-white focus:border-sky-400 focus:outline-none tabular-nums"
                      />
                    </div>

                    {/* Synced % off */}
                    <div className="md:col-span-2">
                      <label className="block text-[10px] text-slate-400 font-semibold mb-1">
                        Desc. (%)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="80"
                        value={discountPct > 0 ? discountPct : ""}
                        placeholder="%"
                        onChange={(e) => {
                          const pct = Number.parseFloat(e.target.value);
                          if (
                            Number.isFinite(pct) &&
                            pct > 0 &&
                            pct < 90 &&
                            basePriceCents > 0
                          ) {
                            const cents = Math.max(
                              1,
                              Math.round(basePriceCents * (1 - pct / 100))
                            );
                            updateTier(idx, { unitPriceCents: cents });
                          }
                        }}
                        className="w-full rounded-lg bg-slate-950 border border-white/15 px-2 py-1.5 text-xs font-mono font-bold text-sky-300 focus:border-sky-400 focus:outline-none tabular-nums"
                      />
                    </div>

                    {/* Live Profit / Total / Bs Feedback */}
                    <div className="md:col-span-3 text-[11px] space-y-0.5 tabular-nums">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {unitProfitCents !== null ? (
                          <span
                            className={`font-extrabold ${
                              isLoss
                                ? "text-rose-300"
                                : isBreakEven
                                  ? "text-amber-300"
                                  : "text-emerald-300"
                            }`}
                          >
                            {isLoss
                              ? `Pérdida ${formatCents(unitProfitCents)}/u`
                              : `+${formatCents(unitProfitCents)}/u (${unitMarginPct?.toFixed(1)}%)`}
                          </span>
                        ) : (
                          <span className="text-slate-300 font-semibold">
                            Pack {tier.minQuantity}:{" "}
                            {formatCents(
                              tier.unitPriceCents * tier.minQuantity
                            )}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-2">
                        <span>
                          {tier.minQuantity} u. ={" "}
                          {formatCents(tier.unitPriceCents * tier.minQuantity)}
                        </span>
                        {bsText && <span>≈ {bsText}/u</span>}
                      </div>
                    </div>

                    {/* Remove Button */}
                    <div className="md:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeTier(tier.minQuantity)}
                        title="Eliminar nivel"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/15 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!validation.ok && (
            <div className="flex items-start gap-2 rounded-lg bg-rose-500/15 border border-rose-500/35 px-2.5 py-1.5 text-[11px] font-semibold text-rose-200">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
              <span>{validation.error}</span>
            </div>
          )}

          <p className="text-[10px] text-slate-500">
            Recuerda presionar <strong className="text-slate-300">Guardar</strong>{" "}
            en esta tarjeta después de editar niveles para aplicarlos en tienda.
          </p>
        </div>
      )}
    </div>
  );
}
