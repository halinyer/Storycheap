"use client";

import React, { useState } from "react";
import { updateVariantAdminAction } from "@/app/admin/actions";
import { formatCents } from "@/lib/catalog-seed";
import type { ProductDTO, ProductVariantDTO, SourcePriority } from "@/types";
import { Save } from "lucide-react";
import { toast } from "sonner";

function VariantRowEditor({
  productName,
  variant,
}: {
  productName: string;
  variant: ProductVariantDTO;
}) {
  const [priceUsd, setPriceUsd] = useState((variant.salePriceCents / 100).toFixed(2));
  const [sourcePriority, setSourcePriority] = useState<SourcePriority>(
    variant.sourcePriority
  );
  const [reloadlyId, setReloadlyId] = useState(
    variant.reloadlyProductId ? String(variant.reloadlyProductId) : ""
  );
  const [threshold, setThreshold] = useState(String(variant.lowStockThreshold));
  const [active, setActive] = useState(variant.active);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const parsedPrice = Math.round(Number.parseFloat(priceUsd) * 100);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      toast.error("Precio USD inválido");
      return;
    }
    setSaving(true);
    try {
      await updateVariantAdminAction({
        variantId: variant.id,
        salePriceCents: parsedPrice,
        sourcePriority,
        reloadlyProductId: reloadlyId.trim() ? Number(reloadlyId.trim()) : null,
        lowStockThreshold: Math.max(0, Number.parseInt(threshold, 10) || 0),
        active,
      });
      toast.success(`Guardado: ${productName} (${variant.denominationLabel})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="hover:bg-white/[0.02] text-xs">
      <td className="px-4 py-3.5">
        <div className="font-bold text-white">{productName}</div>
        <div className="text-[11px] text-slate-400">
          {variant.denominationLabel} (Valor nominal:{" "}
          {formatCents(variant.faceValueCents)})
        </div>
      </td>
      <td className="px-4 py-3.5 font-black text-emerald-400">
        {variant.availableStock}
      </td>
      <td className="px-4 py-3.5">
        <input
          type="number"
          step="0.01"
          min="0.50"
          value={priceUsd}
          onChange={(e) => setPriceUsd(e.target.value)}
          className="w-24 rounded-lg bg-slate-950 border border-white/15 px-2.5 py-1.5 text-white font-mono"
        />
      </td>
      <td className="px-4 py-3.5">
        <select
          value={sourcePriority}
          onChange={(e) => setSourcePriority(e.target.value as SourcePriority)}
          className="rounded-lg bg-slate-950 border border-white/15 px-2.5 py-1.5 text-white"
        >
          <option value="manual_only">Solo Inventario CSV</option>
          <option value="manual_then_reloadly">Manual → Fallback Reloadly</option>
          <option value="reloadly_only">Solo Reloadly API</option>
        </select>
      </td>
      <td className="px-4 py-3.5">
        <input
          type="text"
          placeholder="Opcional"
          value={reloadlyId}
          onChange={(e) => setReloadlyId(e.target.value)}
          className="w-20 rounded-lg bg-slate-950 border border-white/15 px-2.5 py-1.5 text-white font-mono"
        />
      </td>
      <td className="px-4 py-3.5">
        <input
          type="number"
          min="0"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="w-16 rounded-lg bg-slate-950 border border-white/15 px-2 py-1.5 text-white font-mono"
        />
      </td>
      <td className="px-4 py-3.5">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 accent-emerald-500"
        />
      </td>
      <td className="px-4 py-3.5 text-right">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white hover:bg-sky-300 text-slate-950 font-black text-[11px]"
        >
          <Save className="w-3 h-3" />
          <span>{saving ? "..." : "Guardar"}</span>
        </button>
      </td>
    </tr>
  );
}

export function ProductsConsole({ catalog }: { catalog: ProductDTO[] }) {
  return (
    <div className="rounded-3xl apple-glass overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-white/[0.04] text-slate-400 uppercase text-[10px]">
            <tr>
              <th className="px-4 py-3">Producto / Variante</th>
              <th className="px-4 py-3">Stock CSV</th>
              <th className="px-4 py-3">Precio Venta (USD)</th>
              <th className="px-4 py-3">Fuente de entrega</th>
              <th className="px-4 py-3">Reloadly ID</th>
              <th className="px-4 py-3">Alerta min</th>
              <th className="px-4 py-3">Activo</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {catalog.flatMap((product) =>
              product.variants.map((variant) => (
                <VariantRowEditor
                  key={variant.id}
                  productName={product.name}
                  variant={variant}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
