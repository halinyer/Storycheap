/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createProductAction,
  createVariantAction,
  deleteProductAdminAction,
  deleteVariantAdminAction,
  fetchCentralOneCatalogAdminAction,
  fetchFazerCardsCatalogAdminAction,
  toggleProductActiveAction,
  toggleVariantActiveAction,
  updateProductMetaAction,
  updateVariantAdminAction,
} from "@/app/admin/actions";
import { CARD_IMAGE_PRESETS, suggestProductImageUrl } from "@/lib/brand-theme";
import { formatCents } from "@/lib/catalog-seed";
import {
  evaluateSkuAlignment,
  suggestDenominationLabel,
} from "@/lib/sku-guard";
import type { VariantPricingMeta } from "@/lib/server/repository";
import { formatBsCents } from "@/lib/server/sales-metrics";
import type { CentralOneCatalogItem } from "@/lib/server/suppliers/centralone";
import type {
  Category,
  ProductDTO,
  ProductVariantDTO,
  Region,
  SourcePriority,
} from "@/types";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Image as ImageIcon,
  Link2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

function normalizeDecimalInput(raw: string): string {
  return raw.replace(",", ".").replace(/[^0-9.]/g, "");
}

const SUPPLIER_ALIAS_MAP: Record<string, string[]> = {
  usa: ["us", "usa"],
  eeuu: ["us", "usa"],
  psn: ["playstation", "psn"],
  ps4: ["playstation"],
  ps5: ["playstation"],
  espana: ["es", "spain"],
  spain: ["es", "spain"],
};

function normalizeSearchChunk(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildSupplierSearchHint(productName: string, region?: string | null): string {
  const base = productName
    .split(/[(:·]/)[0]
    ?.replace(/\b(?:gift|card|cards|store|tienda|pin|pins|eshop|wallet|digital)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const brand = base || productName.split(/[(:·]/)[0]?.trim() || "";
  if (region === "USA" || /\(\s*usa\s*\)/i.test(productName)) {
    return `${brand} US`.trim();
  }
  return brand;
}

function matchesSupplierTokens(item: CentralOneCatalogItem, query: string): boolean {
  const clean = normalizeSearchChunk(query.trim());
  if (!clean) return true;
  const tokens = clean
    .replace(/[()[\]{}·:_/\\|,-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^\$/, "").trim())
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const haystack = normalizeSearchChunk(
    `${item.name} ${item.sku ?? ""} ${item.region ?? ""} ${item.id}`
  );

  return tokens.every((token) => {
    const candidates = SUPPLIER_ALIAS_MAP[token] ?? [token];
    return candidates.some((cand) => {
      if (cand.length <= 2 && /^[a-z]+$/.test(cand)) {
        const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(?:^|[\\s_()\\[\\]·:-])${escaped}(?:$|[\\s_()\\[\\]·:-])`, "i").test(
          haystack
        );
      }
      return haystack.includes(cand);
    });
  });
}

async function compressImageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("El archivo debe ser una imagen PNG, JPG o WebP.");
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });

  if (rawDataUrl.length <= 150_000 && /^data:image\/(png|webp|jpeg);base64,/i.test(rawDataUrl)) {
    return rawDataUrl;
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("No se pudo procesar la imagen seleccionada."));
    el.src = rawDataUrl;
  });

  const maxW = 600;
  const maxH = 750;
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no pudo renderizar el lienzo de imagen.");
  ctx.drawImage(img, 0, 0, w, h);

  for (const quality of [0.88, 0.76, 0.62]) {
    const webp = canvas.toDataURL("image/webp", quality);
    if (webp.startsWith("data:image/webp") && webp.length <= 185_000) {
      return webp;
    }
    const jpeg = canvas.toDataURL("image/jpeg", quality);
    if (jpeg.length <= 185_000) {
      return jpeg;
    }
  }

  throw new Error("La imagen sigue siendo muy pesada incluso optimizada. Usa una imagen menor o pega una URL.");
}

function ProductImagePicker({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (nextUrl: string) => void;
  compact?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [presetQuery, setPresetQuery] = useState("");

  const filteredPresets = useMemo(() => {
    const q = presetQuery.trim().toLowerCase();
    if (!q) return CARD_IMAGE_PRESETS;
    return CARD_IMAGE_PRESETS.filter(
      (preset) =>
        preset.label.toLowerCase().includes(q) || preset.imageUrl.toLowerCase().includes(q)
    );
  }, [presetQuery]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      onChange(dataUrl);
      toast.success("Imagen optimizada y cargada correctamente");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo subir la imagen");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`rounded-xl border border-white/10 bg-slate-950/75 p-2.5 space-y-2.5 ${compact ? "w-full" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="w-12 h-16 rounded-lg bg-slate-900 border border-white/15 flex items-center justify-center overflow-hidden shrink-0">
          {value.trim() ? (
            <img
              src={value}
              alt="Vista previa"
              className="w-full h-full object-contain p-0.5"
            />
          ) : (
            <ImageIcon className="w-4 h-4 text-slate-500" />
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={CARD_IMAGE_PRESETS.some((p) => p.imageUrl === value) ? value : ""}
              onChange={(e) => {
                if (e.target.value) onChange(e.target.value);
              }}
              className="rounded-lg bg-slate-900 border border-white/15 px-2 py-1 text-[11px] text-white focus:border-sky-400 focus:outline-none"
            >
              <option value="">Elegir diseño de tienda…</option>
              {CARD_IMAGE_PRESETS.map((preset) => (
                <option key={preset.imageUrl} value={preset.imageUrl}>
                  {preset.label}
                </option>
              ))}
            </select>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => void handleFile(e)}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-sky-300 font-semibold text-[11px] transition-colors"
            >
              <Upload className="w-3 h-3" />
              <span>{uploading ? "Procesando…" : "Subir imagen"}</span>
            </button>
          </div>

          <input
            type="text"
            value={value.startsWith("data:image/") ? "" : value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              value.startsWith("data:image/")
                ? "✓ Imagen personalizada subida (escribe URL aquí si deseas cambiarla)"
                : "O pega URL https://... o ruta /cards/playstation.png"
            }
            className="w-full rounded-lg bg-slate-900 border border-white/10 px-2.5 py-1 text-[11px] font-mono text-slate-200 placeholder-slate-500 focus:border-sky-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="border-t border-white/[0.06] pt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-slate-400">
            Galería rápida ({filteredPresets.length} diseños)
          </span>
          <div className="relative w-40 sm:w-48">
            <Search className="w-3 h-3 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={presetQuery}
              onChange={(e) => setPresetQuery(e.target.value)}
              placeholder="Filtrar marca…"
              className="w-full rounded-md bg-slate-900 border border-white/10 pl-6 pr-2 py-0.5 text-[10px] text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="max-h-40 overflow-y-auto grid grid-cols-4 sm:grid-cols-6 gap-1.5 pr-1">
          {filteredPresets.map((preset) => {
            const active = value === preset.imageUrl;
            return (
              <button
                key={preset.imageUrl}
                type="button"
                title={preset.label}
                onClick={() => onChange(preset.imageUrl)}
                className={`group relative rounded-lg p-1 border text-left transition-all ${
                  active
                    ? "border-sky-400 bg-sky-500/15 ring-1 ring-sky-400/50"
                    : "border-white/10 bg-slate-900/70 hover:border-white/30 hover:bg-slate-900"
                }`}
              >
                <div className="w-full aspect-[3/4] rounded overflow-hidden bg-slate-950/70 flex items-center justify-center">
                  <img
                    src={preset.imageUrl}
                    alt={preset.label}
                    loading="lazy"
                    className="w-full h-full object-contain p-0.5"
                  />
                </div>
                <p className="mt-1 text-[9px] leading-tight text-slate-300 truncate font-medium">
                  {preset.label}
                </p>
                {active && (
                  <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-sky-400 text-slate-950 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </span>
                )}
              </button>
            );
          })}
          {filteredPresets.length === 0 && (
            <div className="col-span-full py-3 text-center text-[11px] text-slate-500">
              Sin coincidencias para &ldquo;{presetQuery}&rdquo;
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatCostDisplay(
  exactRaw?: string | null,
  fallbackCents?: number | null
): string {
  if (exactRaw && /^\d+(\.\d+)?$/.test(exactRaw.trim())) {
    const num = Number.parseFloat(exactRaw.trim());
    if (Number.isFinite(num)) {
      const decimals = exactRaw.includes(".") ? exactRaw.split(".")[1]?.length ?? 2 : 2;
      return num.toFixed(Math.min(4, Math.max(2, decimals)));
    }
  }
  if (typeof fallbackCents === "number") {
    return (fallbackCents / 100).toFixed(2);
  }
  return "";
}

function formatMarginUsd(diffUsd: number, showFourDecimals: boolean): string {
  const abs = Math.abs(diffUsd);
  const digits = showFourDecimals ? 4 : 2;
  return `${diffUsd >= 0 ? "+" : "-"}$${abs.toFixed(digits)}`;
}

function VariantRow({
  productName,
  productRegion,
  variant,
  pricingMeta,
  liveC1Item,
  reloadlyEnabled,
  centralOneEnabled,
  centralOneBalanceCents,
  fazerCardsEnabled,
  fazerCardsBalanceCents,
  bsRateCents,
  onOpenCentralOnePicker,
  onSaved,
}: {
  productName: string;
  productRegion?: Region;
  variant: ProductVariantDTO;
  pricingMeta?: VariantPricingMeta;
  liveC1Item?: CentralOneCatalogItem;
  reloadlyEnabled: boolean;
  centralOneEnabled: boolean;
  centralOneBalanceCents: number | null;
  fazerCardsEnabled: boolean;
  fazerCardsBalanceCents: number | null;
  bsRateCents?: number | null;
  onOpenCentralOnePicker: (
    applySelection: (item: CentralOneCatalogItem) => void,
    initialQuery?: string
  ) => void;
  onSaved: () => void;
}) {
  const initialCostStr = formatCostDisplay(
    pricingMeta?.exactCostUsd ?? liveC1Item?.resellerPriceRaw,
    variant.unitCostCents ?? liveC1Item?.resellerPriceCents
  );
  const [label, setLabel] = useState(variant.denominationLabel);
  const [priceUsd, setPriceUsd] = useState((variant.salePriceCents / 100).toFixed(2));
  const [costUsd, setCostUsd] = useState(initialCostStr);
  const [sourcePriority, setSourcePriority] = useState<SourcePriority>(
    variant.sourcePriority
  );
  const [reloadlyId, setReloadlyId] = useState(
    variant.reloadlyProductId ? String(variant.reloadlyProductId) : ""
  );
  const [centraloneId, setCentraloneId] = useState(
    variant.centraloneProductId ?? ""
  );
  const [c1Name, setC1Name] = useState(
    pricingMeta?.centraloneProductName ?? liveC1Item?.name ?? ""
  );
  const [c1Sku, setC1Sku] = useState(
    pricingMeta?.centraloneSku ?? liveC1Item?.sku ?? ""
  );
  const [c1Region, setC1Region] = useState(
    pricingMeta?.centraloneRegion ?? liveC1Item?.region ?? ""
  );
  const [optimisticActive, setOptimisticActive] = useState<{
    expected: boolean;
    prevServer: boolean;
  } | null>(null);
  const [togglingActive, setTogglingActive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [saving, setSaving] = useState(false);

  const active =
    optimisticActive && optimisticActive.prevServer === variant.active
      ? optimisticActive.expected
      : variant.active;

  const effectiveC1Name = c1Name || liveC1Item?.name || "";
  const effectiveC1Sku = c1Sku || liveC1Item?.sku || "";
  const effectiveC1Region = c1Region || liveC1Item?.region || "";

  const isFazerLinked = centraloneId.trim().toLowerCase().startsWith("fazer:");
  const sourceOptions: Array<{ value: SourcePriority; label: string }> = [
    { value: "manual_only", label: "Stock CSV" },
    {
      value: "centralone_only",
      label: isFazerLinked ? "FazerCards API" : "API (C1 / Fazer)",
    },
    {
      value: "manual_then_centralone",
      label: isFazerLinked ? "CSV → FazerCards" : "CSV → API",
    },
    ...(reloadlyEnabled
      ? ([
          { value: "manual_then_reloadly", label: "CSV → Reloadly" },
          { value: "reloadly_only", label: "Reloadly" },
        ] as const)
      : []),
  ];

  const parsedPriceFloat = Number.parseFloat(priceUsd);
  const parsedCostFloat =
    costUsd.trim() === "" ? null : Number.parseFloat(costUsd);
  const hasHighPrecisionCost =
    costUsd.includes(".") && (costUsd.split(".")[1]?.replace(/0+$/, "").length ?? 0) > 2;
  const marginUsd =
    Number.isFinite(parsedPriceFloat) &&
    parsedCostFloat !== null &&
    Number.isFinite(parsedCostFloat)
      ? parsedPriceFloat - parsedCostFloat
      : null;
  const marginPct =
    marginUsd !== null && parsedPriceFloat > 0
      ? (marginUsd / parsedPriceFloat) * 100
      : null;

  const usesCentralOne =
    sourcePriority === "centralone_only" ||
    sourcePriority === "manual_then_centralone";
  const usesReloadly =
    sourcePriority === "reloadly_only" ||
    sourcePriority === "manual_then_reloadly";

  const alignment = evaluateSkuAlignment({
    denominationLabel: label,
    productName,
    supplierName: usesCentralOne ? effectiveC1Name : null,
    supplierSku: usesCentralOne ? effectiveC1Sku : null,
    costUsd: Number.isFinite(parsedCostFloat ?? NaN) ? parsedCostFloat : null,
    saleUsd: Number.isFinite(parsedPriceFloat) ? parsedPriceFloat : null,
  });

  const isDirty =
    label.trim() !== variant.denominationLabel ||
    priceUsd !== (variant.salePriceCents / 100).toFixed(2) ||
    costUsd !== initialCostStr ||
    sourcePriority !== variant.sourcePriority ||
    centraloneId !== (variant.centraloneProductId ?? "") ||
    effectiveC1Name !== (pricingMeta?.centraloneProductName ?? "") ||
    reloadlyId !== (variant.reloadlyProductId ? String(variant.reloadlyProductId) : "");

  const handleSave = async () => {
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      toast.error("La etiqueta visible no puede estar vacía");
      return;
    }
    const parsedPrice = Math.round(Number.parseFloat(priceUsd) * 100);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      toast.error("Precio de venta inválido");
      return;
    }
    const trimmedCost = costUsd.trim();
    const numericCost = trimmedCost === "" ? null : Number.parseFloat(trimmedCost);
    if (numericCost !== null && (!Number.isFinite(numericCost) || numericCost < 0)) {
      toast.error("Costo inválido");
      return;
    }
    if (alignment.severity === "critical" && !confirmMismatch) {
      toast.error(
        "Detectamos una alerta crítica entre etiqueta/SKU/costo. Corrige o marca la confirmación antes de guardar."
      );
      return;
    }

    const parsedCostCents = numericCost === null ? null : Math.round(numericCost * 100);
    const normalizedExactCost =
      numericCost === null
        ? null
        : hasHighPrecisionCost
          ? numericCost.toFixed(4)
          : numericCost.toFixed(2);

    setSaving(true);
    try {
      await updateVariantAdminAction({
        variantId: variant.id,
        denominationLabel: cleanLabel,
        salePriceCents: parsedPrice,
        unitCostCents: parsedCostCents,
        exactCostUsd: normalizedExactCost,
        sourcePriority,
        reloadlyProductId: reloadlyId.trim() ? Number(reloadlyId.trim()) : null,
        centraloneProductId: centraloneId.trim() || null,
        centraloneProductName: centraloneId.trim()
          ? effectiveC1Name.trim() || null
          : null,
        centraloneSku: centraloneId.trim() ? effectiveC1Sku.trim() || null : null,
        centraloneRegion: centraloneId.trim()
          ? effectiveC1Region.trim() || null
          : null,
        lowStockThreshold: variant.lowStockThreshold,
        active,
      });
      setLabel(cleanLabel);
      setPriceUsd((parsedPrice / 100).toFixed(2));
      setCostUsd(normalizedExactCost ?? "");
      setConfirmMismatch(false);
      toast.success(`Guardado: ${productName} (${cleanLabel})`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (nextActive: boolean) => {
    setOptimisticActive({ expected: nextActive, prevServer: variant.active });
    setTogglingActive(true);
    try {
      await toggleVariantActiveAction({
        variantId: variant.id,
        active: nextActive,
      });
      toast.success(
        nextActive
          ? `${label.trim() || productName}: visible en tienda`
          : `${label.trim() || productName}: oculta de la tienda`
      );
      onSaved();
    } catch (err) {
      setOptimisticActive(null);
      toast.error(err instanceof Error ? err.message : "Error al cambiar estado");
    } finally {
      setTogglingActive(false);
    }
  };

  const handleDeleteVariant = async () => {
    setDeleting(true);
    try {
      const res = await deleteVariantAdminAction({ variantId: variant.id });
      if (res.archived) {
        setOptimisticActive({ expected: false, prevServer: variant.active });
        toast.warning(
          `${label.trim() || productName}: tiene órdenes históricas y se ocultó de la tienda.`
        );
      } else {
        toast.success(`Denominación eliminada: ${label.trim() || productName}`);
      }
      setConfirmDelete(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar");
    } finally {
      setDeleting(false);
    }
  };

  const suggestedSearch = buildSupplierSearchHint(productName, productRegion);

  return (
    <div className={`px-5 py-4 space-y-3 text-xs transition-opacity ${!active ? "opacity-60" : ""}`}>
      {/* Tier 1: Active + Editable Storefront Label + Source Selector + Save + Delete */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 basis-[260px]">
          <input
            type="checkbox"
            disabled={togglingActive || deleting}
            checked={active}
            onChange={(e) => void handleToggleActive(e.target.checked)}
            className="h-4 w-4 accent-emerald-500 cursor-pointer shrink-0 disabled:opacity-50"
            title={
              active
                ? "Ocultar denominación de la tienda"
                : "Mostrar denominación en la tienda"
            }
          />
          <div className="min-w-0 flex-1 max-w-xs">
            <input
              type="text"
              aria-label="Enunciado visible en tienda"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setConfirmMismatch(false);
              }}
              placeholder="Ej. 110 Diamantes"
              className="w-full rounded-lg bg-slate-950/90 border border-white/10 focus:border-sky-400 focus:outline-none px-2.5 py-1.5 text-sm font-bold text-white"
            />
          </div>
          {!active && (
            <span className="shrink-0 px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 text-[10px] font-semibold whitespace-nowrap">
              Oculta en tienda
            </span>
          )}
          <span className="shrink-0 px-2 py-1 rounded-md bg-white/[0.05] text-[11px] text-slate-400 whitespace-nowrap">
            CSV: {variant.availableStock}
          </span>
          {usesCentralOne && (
            <span
              className={`shrink-0 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap ${
                !(isFazerLinked ? fazerCardsEnabled : centralOneEnabled)
                  ? "bg-amber-500/10 text-amber-300"
                  : (variant.supplierStock ?? 0) > 0
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "bg-rose-500/10 text-rose-300"
              }`}
              title={
                isFazerLinked
                  ? "Capacidad real según tu saldo en FazerCards API v2"
                  : "Capacidad real según tu saldo en Central One"
              }
            >
              {isFazerLinked
                ? !fazerCardsEnabled
                  ? "Fazer: Pausado"
                  : fazerCardsBalanceCents !== null && parsedCostFloat && parsedCostFloat > 0
                    ? `Fazer: ${Math.floor(fazerCardsBalanceCents / 100 / parsedCostFloat)} disp.`
                    : typeof variant.supplierStock === "number"
                      ? `Fazer: ${variant.supplierStock} disp.`
                      : "Fazer: Sin saldo"
                : !centralOneEnabled
                  ? "C1: Pausado"
                  : centralOneBalanceCents !== null && parsedCostFloat && parsedCostFloat > 0
                    ? `C1: ${Math.floor(centralOneBalanceCents / 100 / parsedCostFloat)} disp.`
                    : typeof variant.supplierStock === "number"
                      ? `C1: ${variant.supplierStock} disp.`
                      : "C1: Sin saldo"}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex flex-wrap rounded-xl bg-slate-950/90 border border-white/10 p-1">
            {sourceOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSourcePriority(opt.value)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors whitespace-nowrap ${
                  sourcePriority === opt.value
                    ? "bg-white text-slate-950 font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={saving || !isDirty}
            onClick={() => void handleSave()}
            className={`px-4 py-2 rounded-xl font-semibold transition-colors shrink-0 ${
              isDirty
                ? alignment.severity === "critical" && !confirmMismatch
                  ? "bg-rose-500/85 hover:bg-rose-500 text-white"
                  : "bg-white hover:bg-sky-300 text-slate-950"
                : "bg-white/[0.06] text-slate-500 cursor-default"
            }`}
          >
            {saving ? "…" : isDirty ? "Guardar" : "Al día"}
          </button>

          {confirmDelete ? (
            <div className="inline-flex items-center gap-1 rounded-xl bg-rose-500/15 border border-rose-500/40 px-2 py-1 shrink-0">
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDeleteVariant()}
                className="px-2 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-semibold"
              >
                {deleting ? "…" : "Eliminar"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
                className="p-1 text-slate-300 hover:text-white"
                title="Cancelar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={saving || deleting || togglingActive}
              onClick={() => setConfirmDelete(true)}
              title="Eliminar denominación"
              className="p-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-rose-500/20 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tier 2: Supplier SKU Card + Cost / Price / Net Profit */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
        {/* Left: Linked SKU / Source info */}
        <div className="lg:col-span-6 min-w-0">
          {usesCentralOne ? (
            <div
              className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-3 ${
                alignment.severity === "critical"
                  ? "border-rose-500/50 bg-rose-500/[0.08]"
                  : centraloneId
                    ? "border-sky-500/25 bg-sky-500/[0.06]"
                    : "border-amber-500/25 bg-amber-500/[0.05]"
              }`}
            >
              <div className="min-w-0 flex-1">
                {centraloneId ? (
                  <>
                    <div className="font-semibold text-white truncate">
                      {effectiveC1Name ||
                        "SKU vinculado (pulsa Auditar SKUs o Cambiar)"}
                    </div>
                    <div className="font-mono text-[11px] text-slate-400 truncate">
                      {effectiveC1Region ? `${effectiveC1Region} · ` : ""}
                      {effectiveC1Sku || centraloneId}
                    </div>
                  </>
                ) : (
                  <div className="text-amber-300 font-medium">
                    Sin SKU de Central One vinculado
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  onOpenCentralOnePicker((item) => {
                    setCentraloneId(item.id);
                    setC1Name(item.name);
                    setC1Sku(item.sku ?? "");
                    setC1Region(item.region ?? "");
                    setConfirmMismatch(false);
                    setCostUsd(
                      formatCostDisplay(item.resellerPriceRaw, item.resellerPriceCents)
                    );
                  }, suggestedSearch)
                }
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sky-300 font-semibold transition-colors whitespace-nowrap"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>{centraloneId ? "Cambiar SKU" : "Elegir SKU"}</span>
              </button>
            </div>
          ) : usesReloadly ? (
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Reloadly ID:</span>
              <input
                type="text"
                placeholder="Ej. 1234"
                value={reloadlyId}
                onChange={(e) => setReloadlyId(e.target.value)}
                className="w-40 rounded-lg bg-slate-950 border border-white/10 px-2.5 py-1.5 text-white font-mono"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-slate-400">
              Entrega exclusiva desde stock propio (CSV).
            </div>
          )}
        </div>

        {/* Right: Cost / Sale Price / Net Profit */}
        <div className="lg:col-span-6 min-w-0 grid grid-cols-3 gap-2.5 items-end">
          <div className="min-w-0">
            <label className="block text-[11px] text-slate-400 mb-1 truncate">
              Costo proveedor
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-2.5 text-slate-500 font-mono">$</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.0000"
                value={costUsd}
                onChange={(e) => {
                  setCostUsd(normalizeDecimalInput(e.target.value));
                  setConfirmMismatch(false);
                }}
                className="w-full rounded-xl bg-slate-950 border border-white/15 focus:border-sky-400 focus:outline-none pl-6 pr-2 py-2 text-white font-mono tabular-nums"
              />
            </div>
          </div>

          <div className="min-w-0">
            <label className="block text-[11px] text-slate-400 mb-1 truncate">
              Venta tienda
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-2.5 text-slate-500 font-mono">$</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={priceUsd}
                onChange={(e) => {
                  setPriceUsd(normalizeDecimalInput(e.target.value));
                  setConfirmMismatch(false);
                }}
                className="w-full rounded-xl bg-slate-950 border border-white/15 focus:border-sky-400 focus:outline-none pl-6 pr-2 py-2 text-white font-mono font-semibold tabular-nums"
              />
            </div>
            {bsRateCents &&
              bsRateCents > 0 &&
              Number.isFinite(parsedPriceFloat) &&
              parsedPriceFloat > 0 && (
                <div className="text-[10px] font-mono text-sky-300 mt-1 truncate">
                  ≈ {formatBsCents(Math.round(parsedPriceFloat * bsRateCents))}
                </div>
              )}
          </div>

          <div className="min-w-0 text-right pb-1">
            <div className="text-[11px] text-slate-400 mb-1 truncate">Ganancia</div>
            {marginUsd !== null ? (
              <div>
                <div
                  className={`font-mono font-semibold tabular-nums truncate ${
                    marginUsd >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {formatMarginUsd(marginUsd, hasHighPrecisionCost)}
                </div>
                {marginPct !== null && (
                  <div className="text-[10px] text-slate-500 font-mono truncate">
                    {marginPct.toFixed(1)}%
                  </div>
                )}
              </div>
            ) : (
              <div className="text-slate-500 py-1">—</div>
            )}
          </div>
        </div>
      </div>

      {/* Poka-Yoke Guardrail Banner */}
      {alignment.messages.length > 0 && (
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-3 ${
            alignment.severity === "critical"
              ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
              : "border-amber-500/35 bg-amber-500/10 text-amber-200"
          }`}
        >
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold">
                {alignment.severity === "critical"
                  ? "Alerta crítica de coherencia SKU / Denominación"
                  : "Revisión de margen"}
              </div>
              {alignment.messages.map((msg) => (
                <div key={msg} className="text-[11px] opacity-90">
                  {msg}
                </div>
              ))}
              {alignment.severity === "critical" && isDirty && (
                <label className="inline-flex items-center gap-2 pt-1 text-[11px] font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmMismatch}
                    onChange={(e) => setConfirmMismatch(e.target.checked)}
                    className="accent-rose-500"
                  />
                  <span>Confirmo bajo mi responsabilidad que el enunciado y el SKU son correctos</span>
                </label>
              )}
            </div>
          </div>

          {alignment.denominationMismatch && alignment.suggestedLabel && (
            <button
              type="button"
              onClick={() => {
                setLabel(alignment.suggestedLabel!);
                setConfirmMismatch(false);
                toast.success(`Etiqueta ajustada a "${alignment.suggestedLabel}"`);
              }}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-slate-950 hover:bg-sky-200 font-semibold transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Usar &ldquo;{alignment.suggestedLabel}&rdquo;</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ProductsConsole({
  catalog,
  pricingMetaMap = {},
  reloadlyEnabled = false,
  centralOneEnabled = false,
  centralOneBalanceCents = null,
  fazerCardsEnabled = true,
  fazerCardsBalanceCents = null,
  bsRateCents = null,
  initialProductId = null,
}: {
  catalog: ProductDTO[];
  pricingMetaMap?: Record<string, VariantPricingMeta>;
  reloadlyEnabled?: boolean;
  centralOneEnabled?: boolean;
  centralOneBalanceCents?: number | null;
  fazerCardsEnabled?: boolean;
  fazerCardsBalanceCents?: number | null;
  bsRateCents?: number | null;
  initialProductId?: string | null;
}) {
  const router = useRouter();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    initialProductId
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "hidden">(
    "all"
  );
  const [variantSearch, setVariantSearch] = useState("");
  const [togglingProductId, setTogglingProductId] = useState<string | null>(null);
  const [confirmDeleteProduct, setConfirmDeleteProduct] = useState<ProductDTO | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

  // Supplier catalog modal state (Central One + FazerCards API v2)
  const [c1ModalOpen, setC1ModalOpen] = useState(false);
  const [supplierTab, setSupplierTab] = useState<"centralone" | "fazercards">("fazercards");
  const [c1Items, setC1Items] = useState<CentralOneCatalogItem[] | null>(null);
  const [fazerItems, setFazerItems] = useState<CentralOneCatalogItem[] | null>(null);
  const [c1Search, setC1Search] = useState("");
  const [c1ShowAllTypes, setC1ShowAllTypes] = useState(false);
  const [loadingC1, setLoadingC1] = useState(false);
  const [loadingFazer, setLoadingFazer] = useState(false);
  const [c1Callback, setC1Callback] = useState<
    ((item: CentralOneCatalogItem) => void) | null
  >(null);
  const [auditingC1, setAuditingC1] = useState(false);

  // Inline Product header edit state
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editProductName, setEditProductName] = useState("");
  const [editProductRegion, setEditProductRegion] = useState<Region>("USA");
  const [editProductCategory, setEditProductCategory] = useState<Category>("gaming");
  const [editProductImageUrl, setEditProductImageUrl] = useState("");
  const [savingProductMeta, setSavingProductMeta] = useState(false);

  // New Gift Card modal state
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [creatingCard, setCreatingCard] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncCategory, setNcCategory] = useState<Category>("gaming");
  const [ncRegion, setNcRegion] = useState<Region>("USA");
  const [ncImageUrl, setNcImageUrl] = useState("/cards/playstation.png");
  const [ncImageTouched, setNcImageTouched] = useState(false);
  const [ncDenom, setNcDenom] = useState("$10");
  const [ncFaceUsd, setNcFaceUsd] = useState("10.00");
  const [ncCostUsd, setNcCostUsd] = useState("9.20");
  const [ncPriceUsd, setNcPriceUsd] = useState("10.50");
  const [ncSource, setNcSource] = useState<SourcePriority>("centralone_only");
  const [ncC1Id, setNcC1Id] = useState("");
  const [ncC1Name, setNcC1Name] = useState("");
  const [ncC1Sku, setNcC1Sku] = useState("");
  const [ncC1Region, setNcC1Region] = useState("");

  // Add Variant modal state
  const [variantModalProduct, setVariantModalProduct] = useState<ProductDTO | null>(null);
  const [creatingVariant, setCreatingVariant] = useState(false);
  const [nvDenom, setNvDenom] = useState("$25");
  const [nvFaceUsd, setNvFaceUsd] = useState("25.00");
  const [nvCostUsd, setNvCostUsd] = useState("23.00");
  const [nvPriceUsd, setNvPriceUsd] = useState("26.50");
  const [nvSource, setNvSource] = useState<SourcePriority>("centralone_only");
  const [nvC1Id, setNvC1Id] = useState("");
  const [nvC1Name, setNvC1Name] = useState("");
  const [nvC1Sku, setNvC1Sku] = useState("");
  const [nvC1Region, setNvC1Region] = useState("");

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((product) => {
      if (categoryFilter !== "all" && product.category !== categoryFilter) {
        return false;
      }
      if (statusFilter === "active" && !product.active) return false;
      if (statusFilter === "hidden" && product.active) return false;
      if (!q) return true;
      const haystack = `${product.name} ${product.brand} ${product.region} ${product.variants
        .map((v) => v.denominationLabel)
        .join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [catalog, search, categoryFilter, statusFilter]);

  const selectProduct = (id: string | null) => {
    setSelectedProductId(id);
    setEditingProductId(null);
    setVariantSearch("");
    if (typeof window !== "undefined") {
      const targetUrl = id
        ? `/admin/products?product=${encodeURIComponent(id)}`
        : "/admin/products";
      window.history.replaceState(null, "", targetUrl);
    }
  };

  const selectedProduct = useMemo(
    () =>
      selectedProductId
        ? catalog.find((p) => p.id === selectedProductId) ?? null
        : null,
    [catalog, selectedProductId]
  );

  const selectedProductVariants = useMemo(() => {
    if (!selectedProduct) return [];
    const q = variantSearch.trim().toLowerCase();
    if (!q) return selectedProduct.variants;
    return selectedProduct.variants.filter((v) => {
      const meta = pricingMetaMap[v.id];
      const hay = `${v.denominationLabel} ${v.centraloneProductId ?? ""} ${
        meta?.centraloneSku ?? ""
      } ${meta?.centraloneProductName ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [selectedProduct, variantSearch, pricingMetaMap]);

  const activeSupplierItems = supplierTab === "fazercards" ? fazerItems : c1Items;

  const filteredC1Items = useMemo(() => {
    if (!activeSupplierItems) return [];
    const availableItems = activeSupplierItems.filter((item) => {
      if (!item.available) return false;
      return c1ShowAllTypes ? true : !item.requiresTarget;
    });
    return availableItems.filter((item) => matchesSupplierTokens(item, c1Search));
  }, [activeSupplierItems, c1Search, c1ShowAllTypes]);

  const visibleC1Items = useMemo(() => filteredC1Items.slice(0, 150), [filteredC1Items]);

  const c1Map = useMemo(() => {
    const map = new Map<string, CentralOneCatalogItem>();
    for (const item of c1Items ?? []) {
      map.set(item.id, item);
    }
    for (const item of fazerItems ?? []) {
      map.set(item.id, item);
    }
    return map;
  }, [c1Items, fazerItems]);

  const lastFazerFetchedRef = useRef<string | null>(null);

  const loadFazerCatalog = async (queryText?: string) => {
    setLoadingFazer(true);
    try {
      const items = await fetchFazerCardsCatalogAdminAction(queryText);
      setFazerItems(items);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo consultar FazerCards API v2"
      );
    } finally {
      setLoadingFazer(false);
    }
  };

  useEffect(() => {
    if (!c1ModalOpen || supplierTab !== "fazercards") return;
    const cleanQ = c1Search.trim();
    if (lastFazerFetchedRef.current === cleanQ) return;
    const timer = window.setTimeout(() => {
      lastFazerFetchedRef.current = cleanQ;
      void loadFazerCatalog(cleanQ);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [c1ModalOpen, supplierTab, c1Search]);

  const loadCentralOneCatalog = async () => {
    setLoadingC1(true);
    try {
      const items = await fetchCentralOneCatalogAdminAction();
      setC1Items(items);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo consultar Central One"
      );
    } finally {
      setLoadingC1(false);
    }
  };

  const openCentralOneCatalogModal = async (
    onPick?: (item: CentralOneCatalogItem) => void,
    initialSearch?: string
  ) => {
    setC1Callback(() => onPick ?? null);
    const cleanQ = typeof initialSearch === "string" ? initialSearch.trim() : "";
    if (cleanQ) {
      setC1Search(cleanQ);
    }
    setC1ModalOpen(true);

    const targetQuery = (cleanQ || c1Search).trim();
    if (supplierTab === "fazercards") {
      lastFazerFetchedRef.current = targetQuery;
      await loadFazerCatalog(targetQuery);
    } else if (!c1Items) {
      await loadCentralOneCatalog();
    }
  };

  const handleAuditLinkedSkus = async () => {
    setAuditingC1(true);
    try {
      const hasFazerVariants = catalog.some((p) =>
        p.variants.some((v) => v.centraloneProductId?.trim().toLowerCase().startsWith("fazer:"))
      );
      const [c1List, fazerList] = await Promise.all([
        c1Items ? Promise.resolve(c1Items) : fetchCentralOneCatalogAdminAction(),
        hasFazerVariants
          ? fazerItems
            ? Promise.resolve(fazerItems)
            : fetchFazerCardsCatalogAdminAction()
          : Promise.resolve<CentralOneCatalogItem[]>([]),
      ]);
      if (!c1Items) setC1Items(c1List);
      if (hasFazerVariants && !fazerItems && fazerList.length > 0) {
        setFazerItems(fazerList);
      }
      const map = new Map<string, CentralOneCatalogItem>([
        ...c1List.map((item): [string, CentralOneCatalogItem] => [item.id, item]),
        ...fazerList.map((item): [string, CentralOneCatalogItem] => [item.id, item]),
      ]);

      let linkedCount = 0;
      let alertCount = 0;
      for (const product of catalog) {
        for (const variant of product.variants) {
          if (!variant.centraloneProductId) continue;
          linkedCount += 1;
          const liveItem = map.get(variant.centraloneProductId);
          const check = evaluateSkuAlignment({
            denominationLabel: variant.denominationLabel,
            productName: product.name,
            supplierName: liveItem?.name ?? pricingMetaMap[variant.id]?.centraloneProductName,
            supplierSku: liveItem?.sku ?? pricingMetaMap[variant.id]?.centraloneSku,
            costUsd:
              liveItem
                ? Number.parseFloat(liveItem.resellerPriceRaw)
                : typeof variant.unitCostCents === "number"
                  ? variant.unitCostCents / 100
                  : null,
            saleUsd: variant.salePriceCents / 100,
          });
          if (!liveItem || check.severity !== "ok") {
            alertCount += 1;
          }
        }
      }

      if (alertCount > 0) {
        toast.warning(
          `Auditoría: ${linkedCount} SKU(s) vinculados y ${alertCount} alerta(s) detectada(s). Revisa los avisos en rojo.`
        );
      } else {
        toast.success(
          `Auditoría limpia: ${linkedCount} SKU(s) vinculados coinciden con su etiqueta y margen.`
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo auditar el catálogo"
      );
    } finally {
      setAuditingC1(false);
    }
  };

  const handleSaveProductMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProductId) return;
    setSavingProductMeta(true);
    try {
      await updateProductMetaAction({
        productId: editingProductId,
        name: editProductName,
        region: editProductRegion,
        category: editProductCategory,
        imageUrl: editProductImageUrl.trim() || undefined,
      });
      toast.success(`Gift Card actualizada: ${editProductName}`);
      setEditingProductId(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar");
    } finally {
      setSavingProductMeta(false);
    }
  };

  const handleToggleProduct = async (product: ProductDTO) => {
    setTogglingProductId(product.id);
    try {
      await toggleProductActiveAction({
        productId: product.id,
        active: !product.active,
      });
      toast.success(
        `${product.name}: ${!product.active ? "Activada en tienda" : "Desactivada"}`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar estado");
    } finally {
      setTogglingProductId(null);
    }
  };

  const handleDeleteProduct = async (product: ProductDTO) => {
    setDeletingProductId(product.id);
    try {
      const res = await deleteProductAdminAction({ productId: product.id });
      if (res.archived) {
        toast.warning(
          `${product.name}: tiene órdenes históricas y se ocultó de la tienda.`
        );
      } else {
        toast.success(`Gift Card eliminada: ${product.name}`);
        if (selectedProductId === product.id) {
          selectProduct(null);
        }
      }
      setConfirmDeleteProduct(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar la Gift Card");
    } finally {
      setDeletingProductId(null);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const faceCents = Math.round(Number.parseFloat(ncFaceUsd) * 100);
    const priceCents = Math.round(Number.parseFloat(ncPriceUsd) * 100);
    const costNum = ncCostUsd.trim() ? Number.parseFloat(ncCostUsd) : null;
    const costCents = costNum !== null ? Math.round(costNum * 100) : null;

    if (
      !Number.isFinite(faceCents) ||
      faceCents <= 0 ||
      !Number.isFinite(priceCents) ||
      priceCents <= 0 ||
      (costNum !== null && (!Number.isFinite(costNum) || costNum < 0))
    ) {
      toast.error("Montos inválidos");
      return;
    }

    setCreatingCard(true);
    try {
      await createProductAction({
        name: ncName,
        category: ncCategory,
        region: ncRegion,
        imageUrl: ncImageUrl.trim() || suggestProductImageUrl(ncName),
        denominationLabel: ncDenom,
        faceValueCents: faceCents,
        salePriceCents: priceCents,
        unitCostCents: costCents,
        exactCostUsd: costNum !== null ? ncCostUsd.trim() : null,
        sourcePriority: ncSource,
        centraloneProductId: ncC1Id.trim() || null,
        centraloneProductName: ncC1Id.trim() ? ncC1Name || null : null,
        centraloneSku: ncC1Id.trim() ? ncC1Sku || null : null,
        centraloneRegion: ncC1Id.trim() ? ncC1Region || null : null,
      });
      toast.success(`Gift Card creada: ${ncName}`);
      setNewCardOpen(false);
      setNcName("");
      setNcImageUrl("/cards/playstation.png");
      setNcImageTouched(false);
      setNcC1Id("");
      setNcC1Name("");
      setNcC1Sku("");
      setNcC1Region("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear la Gift Card");
    } finally {
      setCreatingCard(false);
    }
  };

  const handleCreateVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!variantModalProduct) return;
    const faceCents = Math.round(Number.parseFloat(nvFaceUsd) * 100);
    const priceCents = Math.round(Number.parseFloat(nvPriceUsd) * 100);
    const costNum = nvCostUsd.trim() ? Number.parseFloat(nvCostUsd) : null;
    const costCents = costNum !== null ? Math.round(costNum * 100) : null;

    if (
      !Number.isFinite(faceCents) ||
      faceCents <= 0 ||
      !Number.isFinite(priceCents) ||
      priceCents <= 0 ||
      (costNum !== null && (!Number.isFinite(costNum) || costNum < 0))
    ) {
      toast.error("Montos inválidos");
      return;
    }

    setCreatingVariant(true);
    try {
      await createVariantAction({
        productId: variantModalProduct.id,
        denominationLabel: nvDenom,
        faceValueCents: faceCents,
        salePriceCents: priceCents,
        unitCostCents: costCents,
        exactCostUsd: costNum !== null ? nvCostUsd.trim() : null,
        sourcePriority: nvSource,
        centraloneProductId: nvC1Id.trim() || null,
        centraloneProductName: nvC1Id.trim() ? nvC1Name || null : null,
        centraloneSku: nvC1Id.trim() ? nvC1Sku || null : null,
        centraloneRegion: nvC1Id.trim() ? nvC1Region || null : null,
      });
      toast.success(
        `Denominación ${nvDenom} agregada a ${variantModalProduct.name}`
      );
      setVariantModalProduct(null);
      setNvC1Id("");
      setNvC1Name("");
      setNvC1Sku("");
      setNvC1Region("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo agregar la denominación");
    } finally {
      setCreatingVariant(false);
    }
  };

  const totalVariantsCount = useMemo(
    () => catalog.reduce((sum, p) => sum + p.variants.length, 0),
    [catalog]
  );

  const summarizeProductCard = (product: ProductDTO) => {
    let minSaleCents: number | null = null;
    let minCostUsd: number | null = null;
    let marginSum = 0;
    let marginCount = 0;
    const linkedProviders = new Set<string>();

    for (const v of product.variants) {
      if (minSaleCents === null || v.salePriceCents < minSaleCents) {
        minSaleCents = v.salePriceCents;
      }
      const meta = pricingMetaMap[v.id];
      const costRaw = meta?.exactCostUsd ? Number.parseFloat(meta.exactCostUsd) : null;
      const costNum =
        costRaw !== null && Number.isFinite(costRaw)
          ? costRaw
          : typeof v.unitCostCents === "number"
            ? v.unitCostCents / 100
            : null;
      if (costNum !== null && costNum > 0) {
        if (minCostUsd === null || costNum < minCostUsd) {
          minCostUsd = costNum;
        }
        if (v.salePriceCents > 0) {
          const saleUsd = v.salePriceCents / 100;
          marginSum += ((saleUsd - costNum) / saleUsd) * 100;
          marginCount += 1;
        }
      }
      if (v.sourcePriority === "manual_only") {
        linkedProviders.add("CSV");
      } else if (v.sourcePriority === "reloadly_only" || v.sourcePriority === "manual_then_reloadly") {
        linkedProviders.add("Reloadly");
      } else if (v.centraloneProductId?.toLowerCase().startsWith("fazer:")) {
        linkedProviders.add("FazerCards");
      } else if (v.centraloneProductId) {
        linkedProviders.add("Central One");
      } else {
        linkedProviders.add("CSV");
      }
    }

    return {
      minSaleCents,
      minCostUsd,
      avgMarginPct: marginCount > 0 ? marginSum / marginCount : null,
      providers: Array.from(linkedProviders),
    };
  };

  return (
    <div className="space-y-6">
      {!selectedProduct ? (
        <>
          {/* Level 1: Gift Cards Directory Header */}
          <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-400">
                Catálogo y Márgenes
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
                Gift Cards Studio
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                {catalog.length} marcas registradas · {totalVariantsCount} denominaciones. Selecciona una marca para editar su imagen, vincular SKUs y ajustar precios.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {fazerCardsBalanceCents !== null && (
                <span className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-400/20 text-[11px] font-mono text-amber-200">
                  FazerCards: <strong>{formatCents(fazerCardsBalanceCents)}</strong>
                </span>
              )}
              {centralOneBalanceCents !== null && (
                <span className="px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-400/20 text-[11px] font-mono text-sky-200">
                  Central One: <strong>{formatCents(centralOneBalanceCents)}</strong>
                </span>
              )}
              <button
                type="button"
                disabled={auditingC1}
                onClick={() => void handleAuditLinkedSkus()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] text-slate-200 font-semibold text-xs transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${auditingC1 ? "animate-spin" : ""}`} />
                <span>{auditingC1 ? "Auditando…" : "Auditar SKUs API"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setNcImageUrl("/cards/playstation.png");
                  setNcImageTouched(false);
                  setNewCardOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs shadow-[0_6px_22px_rgba(99,102,241,0.3)] transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Nueva Gift Card</span>
              </button>
            </div>
          </div>

          {/* Filter & Search Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar plataforma, región o denominación (ej. PlayStation, Netflix)..."
                  className="w-full rounded-xl bg-[#0d101b] border border-white/10 pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                />
              </div>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-xl bg-[#0d101b] border border-white/10 px-3 py-2.5 text-xs font-medium text-slate-200 focus:outline-none"
              >
                <option value="all">Todas las categorías</option>
                <option value="gaming">Gaming</option>
                <option value="streaming">Streaming</option>
                <option value="shopping">Shopping</option>
                <option value="crypto">Crypto</option>
              </select>
            </div>

            <div className="inline-flex rounded-xl bg-[#0d101b] border border-white/10 p-1 gap-1">
              {(
                [
                  { id: "all", label: "Todas" },
                  { id: "active", label: "Activas" },
                  { id: "hidden", label: "Ocultas" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    statusFilter === tab.id
                      ? "bg-indigo-500 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Brand Cards Directory Grid */}
          {filteredCatalog.length === 0 ? (
            <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-12 text-center text-xs text-slate-400">
              No se encontraron Gift Cards con este filtro.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {filteredCatalog.map((product) => {
                const summary = summarizeProductCard(product);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => selectProduct(product.id)}
                    className={`group text-left rounded-2xl bg-[#0d101b] hover:bg-[#121626] border border-white/[0.08] hover:border-indigo-400/40 p-4 flex flex-col justify-between gap-4 transition-all ${
                      !product.active ? "opacity-65" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="w-16 h-16 rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="w-full h-full object-contain p-1 group-hover:scale-105 transition-transform"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${
                              product.active
                                ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/25"
                                : "bg-slate-800 text-slate-400 border-slate-700"
                            }`}
                          >
                            {product.active ? "Activa" : "Oculta"}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-400 capitalize">
                            {product.region}
                          </span>
                        </div>

                        <h3 className="text-sm font-bold text-white truncate mt-1.5 group-hover:text-indigo-200 transition-colors">
                          {product.name}
                        </h3>

                        <div className="mt-1 flex flex-wrap items-baseline gap-2">
                          <span className="text-xs font-black font-mono text-white">
                            {summary.minSaleCents !== null
                              ? `Desde ${formatCents(summary.minSaleCents)}`
                              : "Sin precio"}
                          </span>
                          {summary.avgMarginPct !== null && (
                            <span
                              className={`text-[10px] font-mono font-bold ${
                                summary.avgMarginPct >= 0
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }`}
                            >
                              {summary.avgMarginPct >= 0 ? "+" : ""}
                              {summary.avgMarginPct.toFixed(1)}% prom.
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-semibold text-slate-400">
                          {product.variants.length}{" "}
                          {product.variants.length === 1 ? "opción" : "opciones"}
                        </span>
                        {summary.providers.slice(0, 2).map((prov) => (
                          <span
                            key={prov}
                            className="px-1.5 py-0.5 rounded bg-white/[0.05] text-[9px] font-bold text-slate-300"
                          >
                            {prov}
                          </span>
                        ))}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-300 group-hover:text-indigo-200 shrink-0">
                        <span>Precios</span>
                        <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* Level 2: Focused Brand Studio View */
        (() => {
          const summary = summarizeProductCard(selectedProduct);
          return (
            <div className="space-y-5">
              {/* Breadcrumb */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => selectProduct(null)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-slate-200 font-semibold transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Todas las Gift Cards</span>
                  </button>
                  <span className="text-slate-600">/</span>
                  <span className="font-bold text-white">{selectedProduct.name}</span>
                </div>

                {bsRateCents && bsRateCents > 0 && (
                  <span className="px-3 py-1.5 rounded-xl bg-sky-500/10 border border-sky-400/20 text-[11px] font-mono text-sky-200">
                    Tasa tienda activa: Bs {(bsRateCents / 100).toFixed(2)}/$
                  </span>
                )}
              </div>

              {/* Brand Hero Card */}
              <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6">
                {editingProductId === selectedProduct.id ? (
                  <form
                    onSubmit={(e) => void handleSaveProductMeta(e)}
                    className="space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-bold text-white">
                        Editar Imagen y Datos de la Marca
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingProductId(null)}
                          className="px-3 py-1.5 rounded-xl bg-white/[0.06] text-slate-300 text-xs font-semibold"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={savingProductMeta}
                          className="px-4 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs"
                        >
                          {savingProductMeta ? "Guardando…" : "Guardar cambios"}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Nombre visible
                        </label>
                        <input
                          required
                          type="text"
                          value={editProductName}
                          onChange={(e) => setEditProductName(e.target.value)}
                          className="w-full rounded-xl bg-slate-950 border border-indigo-400/40 px-3 py-2 text-xs font-bold text-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Región
                        </label>
                        <select
                          value={editProductRegion}
                          onChange={(e) => setEditProductRegion(e.target.value as Region)}
                          className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
                        >
                          <option value="USA">USA</option>
                          <option value="Global">Global</option>
                          <option value="Latam">Latam</option>
                          <option value="Europa">Europa</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Categoría
                        </label>
                        <select
                          value={editProductCategory}
                          onChange={(e) =>
                            setEditProductCategory(e.target.value as Category)
                          }
                          className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
                        >
                          <option value="gaming">Gaming</option>
                          <option value="streaming">Streaming</option>
                          <option value="shopping">Shopping</option>
                          <option value="crypto">Crypto</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1.5">
                        Arte / Portada de la Gift Card (sube archivo, pega URL o usa preset)
                      </label>
                      <ProductImagePicker
                        value={editProductImageUrl}
                        onChange={setEditProductImageUrl}
                      />
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                    <div className="flex items-start sm:items-center gap-4 min-w-0">
                      <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-slate-950 border border-white/15 flex items-center justify-center overflow-hidden shrink-0">
                        <img
                          src={selectedProduct.imageUrl}
                          alt={selectedProduct.name}
                          className="w-full h-full object-contain p-1.5"
                        />
                      </div>

                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h1 className="text-xl sm:text-2xl font-bold text-white truncate">
                            {selectedProduct.name}
                          </h1>
                          <span className="px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[11px] font-semibold text-slate-200">
                            {selectedProduct.region}
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                              selectedProduct.active
                                ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/25"
                                : "bg-rose-500/15 text-rose-300 border-rose-400/30"
                            }`}
                          >
                            {selectedProduct.active ? "Activa en tienda" : "Oculta"}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                          <span>
                            Categoría:{" "}
                            <strong className="text-slate-200 capitalize">
                              {selectedProduct.category}
                            </strong>
                          </span>
                          <span>
                            Opciones:{" "}
                            <strong className="text-white">
                              {selectedProduct.variants.length}
                            </strong>
                          </span>
                          {summary.minSaleCents !== null && (
                            <span>
                              Desde:{" "}
                              <strong className="text-white font-mono">
                                {formatCents(summary.minSaleCents)}
                              </strong>
                            </span>
                          )}
                          {summary.avgMarginPct !== null && (
                            <span>
                              Margen prom.:{" "}
                              <strong className="text-emerald-300 font-mono">
                                +{summary.avgMarginPct.toFixed(1)}%
                              </strong>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProductId(selectedProduct.id);
                          setEditProductName(selectedProduct.name);
                          setEditProductRegion(selectedProduct.region);
                          setEditProductCategory(selectedProduct.category);
                          setEditProductImageUrl(selectedProduct.imageUrl);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs font-semibold text-slate-200 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Editar imagen y datos</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setVariantModalProduct(selectedProduct);
                          setNvC1Id("");
                          setNvC1Name("");
                          setNvC1Sku("");
                          setNvC1Region("");
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-xs font-bold text-white transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Agregar denominación</span>
                      </button>

                      <button
                        type="button"
                        disabled={togglingProductId === selectedProduct.id}
                        onClick={() => void handleToggleProduct(selectedProduct)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                          selectedProduct.active
                            ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/25 hover:bg-emerald-500/25"
                            : "bg-rose-500/15 text-rose-300 border-rose-400/25 hover:bg-rose-500/25"
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{selectedProduct.active ? "Activa" : "Oculta"}</span>
                      </button>

                      <button
                        type="button"
                        disabled={deletingProductId === selectedProduct.id}
                        onClick={() => setConfirmDeleteProduct(selectedProduct)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/25 text-rose-300 text-xs font-semibold transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Denominations Pricing Studio */}
              <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-white">
                      Denominaciones, Costo de Proveedor y Ganancia Neta (
                      {selectedProductVariants.length})
                    </h2>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Compara el costo exacto por API, fija tu precio final al cliente (USD + Bs) y verifica el margen neto por opción.
                    </p>
                  </div>

                  {selectedProduct.variants.length > 2 && (
                    <div className="relative w-full sm:w-64">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={variantSearch}
                        onChange={(e) => setVariantSearch(e.target.value)}
                        placeholder="Filtrar denominación o SKU..."
                        className="w-full rounded-xl bg-white/[0.04] border border-white/10 pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                      />
                    </div>
                  )}
                </div>

                {selectedProductVariants.length === 0 ? (
                  <div className="p-10 text-center text-xs text-slate-400">
                    No hay denominaciones registradas que coincidan con este filtro.
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {selectedProductVariants.map((variant) => (
                      <VariantRow
                        key={variant.id}
                        productName={selectedProduct.name}
                        productRegion={selectedProduct.region}
                        variant={variant}
                        pricingMeta={pricingMetaMap[variant.id]}
                        liveC1Item={
                          variant.centraloneProductId
                            ? c1Map.get(variant.centraloneProductId)
                            : undefined
                        }
                        reloadlyEnabled={reloadlyEnabled}
                        centralOneEnabled={centralOneEnabled}
                        centralOneBalanceCents={centralOneBalanceCents}
                        fazerCardsEnabled={fazerCardsEnabled}
                        fazerCardsBalanceCents={fazerCardsBalanceCents}
                        bsRateCents={bsRateCents}
                        onOpenCentralOnePicker={(applySelection, initialQuery) =>
                          void openCentralOneCatalogModal(applySelection, initialQuery)
                        }
                        onSaved={() => router.refresh()}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()
      )}

      {/* Modal: Nueva Gift Card */}
      {newCardOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleCreateProduct(e)}
            className="rounded-2xl bg-slate-900 border border-white/15 max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 text-xs shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Nueva Gift Card</h3>
              <button
                type="button"
                onClick={() => setNewCardOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-300 mb-1">Nombre</label>
                <input
                  required
                  type="text"
                  value={ncName}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setNcName(nextName);
                    if (!ncImageTouched && nextName.trim()) {
                      setNcImageUrl(suggestProductImageUrl(nextName));
                    }
                  }}
                  placeholder="Ej. PlayStation Store (USA)"
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-300 mb-1">
                  Imagen de la Gift Card
                </label>
                <ProductImagePicker
                  value={ncImageUrl}
                  onChange={(url) => {
                    setNcImageUrl(url);
                    setNcImageTouched(true);
                  }}
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Categoría</label>
                <select
                  value={ncCategory}
                  onChange={(e) => setNcCategory(e.target.value as Category)}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white"
                >
                  <option value="gaming">Gaming</option>
                  <option value="streaming">Streaming</option>
                  <option value="shopping">Shopping</option>
                  <option value="crypto">Crypto</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Región</label>
                <select
                  value={ncRegion}
                  onChange={(e) => setNcRegion(e.target.value as Region)}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white"
                >
                  <option value="USA">USA</option>
                  <option value="Global">Global</option>
                  <option value="Latam">Latam</option>
                  <option value="Europa">Europa</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Denominación</label>
                <input
                  required
                  type="text"
                  value={ncDenom}
                  onChange={(e) => setNcDenom(e.target.value)}
                  placeholder="$10"
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Nominal ($)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={ncFaceUsd}
                  onChange={(e) => setNcFaceUsd(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Costo ($)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={ncCostUsd}
                  onChange={(e) => setNcCostUsd(normalizeDecimalInput(e.target.value))}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Venta ($)</label>
                <input
                  required
                  type="text"
                  inputMode="decimal"
                  value={ncPriceUsd}
                  onChange={(e) => setNcPriceUsd(normalizeDecimalInput(e.target.value))}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white font-mono font-semibold"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-300 mb-1">Proveedor</label>
                <select
                  value={ncSource}
                  onChange={(e) => setNcSource(e.target.value as SourcePriority)}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white"
                >
                  <option value="manual_only">Stock CSV</option>
                  <option value="centralone_only">
                    {ncC1Id.trim().toLowerCase().startsWith("fazer:")
                      ? "FazerCards API"
                      : "FazerCards / Central One API"}
                  </option>
                  <option value="manual_then_centralone">
                    {ncC1Id.trim().toLowerCase().startsWith("fazer:")
                      ? "CSV → FazerCards API"
                      : "CSV → FazerCards / Central One"}
                  </option>
                </select>
              </div>

              {(ncSource === "centralone_only" || ncSource === "manual_then_centralone") && (
                <div className="sm:col-span-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sky-300">
                      Vincular SKU de FazerCards / Central One
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void openCentralOneCatalogModal((item) => {
                          setNcC1Id(item.id);
                          setNcC1Name(item.name);
                          setNcC1Sku(item.sku ?? "");
                          setNcC1Region(item.region ?? "");
                          if (!ncName.trim()) {
                            const suggestedName = item.name.replace(/\s*·\s*PIN\b/gi, "").split("—")[0]?.trim() || item.name;
                            setNcName(suggestedName);
                          }
                          if (!ncImageTouched) {
                            setNcImageUrl(suggestProductImageUrl(item.name, item.id));
                          }
                          const suggested = suggestDenominationLabel(item.name, ncName);
                          if (suggested) setNcDenom(suggested);
                          const exactCost = formatCostDisplay(
                            item.resellerPriceRaw,
                            item.resellerPriceCents
                          );
                          setNcCostUsd(exactCost);
                          const suggestedSale = Math.max(0.5, (item.resellerPriceCents / 100) * 1.08);
                          setNcPriceUsd(suggestedSale.toFixed(2));
                          setNcFaceUsd(Math.max(1, Math.round(item.resellerPriceCents / 100)).toFixed(2));
                        }, ncName.trim() ? buildSupplierSearchHint(ncName, ncRegion) : undefined)
                      }
                      className="px-3 py-1.5 rounded-lg bg-white text-slate-950 hover:bg-sky-300 font-semibold shrink-0"
                    >
                      Elegir SKU
                    </button>
                  </div>
                  {ncC1Name ? (
                    <div className="text-[11px] text-white font-medium">
                      ✓ {ncC1Name}{" "}
                      <span className="font-mono text-slate-400">
                        ({ncC1Region ? `${ncC1Region} · ` : ""}{ncC1Sku || ncC1Id.slice(0, 10)})
                      </span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={ncC1Id}
                      onChange={(e) => setNcC1Id(e.target.value)}
                      placeholder="O pega el UUID de Central One manualmente"
                      className="w-full rounded-lg bg-slate-950 border border-white/10 px-2.5 py-1.5 text-white font-mono"
                    />
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewCardOpen(false)}
                className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creatingCard}
                className="px-4 py-2 rounded-xl bg-white hover:bg-sky-300 text-slate-950 font-semibold"
              >
                {creatingCard ? "Creando…" : "Crear Gift Card"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Agregar Denominación */}
      {variantModalProduct && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleCreateVariant(e)}
            className="rounded-2xl bg-slate-900 border border-white/15 max-w-md w-full p-6 space-y-4 text-xs shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                Agregar denominación — {variantModalProduct.name}
              </h3>
              <button
                type="button"
                onClick={() => setVariantModalProduct(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="block font-medium text-slate-300 mb-1">Etiqueta</label>
                <input
                  required
                  type="text"
                  value={nvDenom}
                  onChange={(e) => setNvDenom(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">Nominal ($)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={nvFaceUsd}
                  onChange={(e) => setNvFaceUsd(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">Costo ($)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={nvCostUsd}
                  onChange={(e) => setNvCostUsd(normalizeDecimalInput(e.target.value))}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">Venta ($)</label>
                <input
                  required
                  type="text"
                  inputMode="decimal"
                  value={nvPriceUsd}
                  onChange={(e) => setNvPriceUsd(normalizeDecimalInput(e.target.value))}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white font-mono font-semibold"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-300 mb-1">Proveedor</label>
                <select
                  value={nvSource}
                  onChange={(e) => setNvSource(e.target.value as SourcePriority)}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white"
                >
                  <option value="manual_only">Stock CSV</option>
                  <option value="centralone_only">
                    {nvC1Id.trim().toLowerCase().startsWith("fazer:")
                      ? "FazerCards API"
                      : "FazerCards / Central One API"}
                  </option>
                  <option value="manual_then_centralone">
                    {nvC1Id.trim().toLowerCase().startsWith("fazer:")
                      ? "CSV → FazerCards API"
                      : "CSV → FazerCards / Central One"}
                  </option>
                </select>
              </div>
              {(nvSource === "centralone_only" || nvSource === "manual_then_centralone") && (
                <div className="col-span-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sky-300">
                      SKU FazerCards / Central One (auto-rellena etiqueta y costo)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void openCentralOneCatalogModal((item) => {
                          setNvC1Id(item.id);
                          setNvC1Name(item.name);
                          setNvC1Sku(item.sku ?? "");
                          setNvC1Region(item.region ?? "");
                          const suggested = suggestDenominationLabel(
                            item.name,
                            variantModalProduct?.name
                          );
                          if (suggested) setNvDenom(suggested);
                          setNvCostUsd(
                            formatCostDisplay(item.resellerPriceRaw, item.resellerPriceCents)
                          );
                          const suggestedSale = Math.max(
                            0.5,
                            (item.resellerPriceCents / 100) * 1.08
                          );
                          setNvPriceUsd(suggestedSale.toFixed(2));
                          setNvFaceUsd(
                            Math.max(1, Math.round(item.resellerPriceCents / 100)).toFixed(2)
                          );
                        }, variantModalProduct ? buildSupplierSearchHint(variantModalProduct.name, variantModalProduct.region) : undefined)
                      }
                      className="px-3 py-1.5 rounded-lg bg-white text-slate-950 hover:bg-sky-300 font-semibold shrink-0"
                    >
                      Elegir SKU
                    </button>
                  </div>
                  {nvC1Name ? (
                    <div className="text-[11px] text-white font-medium">
                      ✓ {nvC1Name}{" "}
                      <span className="font-mono text-slate-400">
                        ({nvC1Region ? `${nvC1Region} · ` : ""}{nvC1Sku || nvC1Id.slice(0, 10)})
                      </span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={nvC1Id}
                      onChange={(e) => setNvC1Id(e.target.value)}
                      placeholder="O pega el UUID de Central One manualmente"
                      className="w-full rounded-lg bg-slate-950 border border-white/10 px-2.5 py-1.5 text-white font-mono"
                    />
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setVariantModalProduct(null)}
                className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creatingVariant}
                className="px-4 py-2 rounded-xl bg-white hover:bg-sky-300 text-slate-950 font-semibold"
              >
                {creatingVariant ? "Agregando…" : "Agregar"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Selector Central One + FazerCards API v2 */}
      {c1ModalOpen && (
        <div className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-4">
          <div className="rounded-2xl bg-slate-900 border border-white/15 max-w-2xl w-full p-6 space-y-4 text-xs shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  Catálogo de Proveedores API (FazerCards v2 & Central One)
                </h3>
                <p className="text-slate-400">
                  Costos mayoristas en vivo y stock instantáneo (incluye Netflix, PSN, Nintendo, Xbox, Steam, etc.).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setC1ModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl bg-slate-950 border border-white/10 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setSupplierTab("fazercards");
                    if (lastFazerFetchedRef.current !== c1Search.trim()) {
                      lastFazerFetchedRef.current = c1Search.trim();
                      void loadFazerCatalog(c1Search);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    supplierTab === "fazercards"
                      ? "bg-rose-500 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  FazerCards API v2 (Netflix & Gift Cards)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSupplierTab("centralone");
                    if (!c1Items) void loadCentralOneCatalog();
                  }}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    supplierTab === "centralone"
                      ? "bg-sky-500 text-slate-950"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Central One API
                </button>
              </div>

              {supplierTab === "fazercards" && (
                <button
                  type="button"
                  disabled={loadingFazer}
                  onClick={() => {
                    lastFazerFetchedRef.current = c1Search.trim();
                    void loadFazerCatalog(c1Search);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 hover:bg-rose-500/25 text-rose-200 font-semibold"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingFazer ? "animate-spin" : ""}`} />
                  <span>Buscar en FazerCards</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={c1Search}
                  onChange={(e) => setC1Search(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && supplierTab === "fazercards") {
                      e.preventDefault();
                      lastFazerFetchedRef.current = c1Search.trim();
                      void loadFazerCatalog(c1Search);
                    }
                  }}
                  placeholder={
                    supplierTab === "fazercards"
                      ? "Ej. playstation us, netflix us, nintendo 25, steam..."
                      : "Buscar por nombre, SKU (ej. FF-110), región o UUID..."
                  }
                  className="w-full rounded-xl bg-slate-950 border border-white/10 pl-8 pr-3 py-2 text-white focus:border-sky-400 focus:outline-none"
                />
              </div>

              {supplierTab === "centralone" && (
                <div className="inline-flex rounded-xl bg-slate-950 border border-white/10 p-1">
                  <button
                    type="button"
                    onClick={() => setC1ShowAllTypes(false)}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                      !c1ShowAllTypes
                        ? "bg-white text-slate-950 font-semibold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Solo Gift Cards / PINs
                  </button>
                  <button
                    type="button"
                    onClick={() => setC1ShowAllTypes(true)}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                      c1ShowAllTypes
                        ? "bg-white text-slate-950 font-semibold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Ver todos (incl. Recargas ID)
                  </button>
                </div>
              )}
            </div>

            {(supplierTab === "fazercards" ? loadingFazer : loadingC1) ? (
              <div className="py-10 text-center text-slate-400">
                Consultando {supplierTab === "fazercards" ? "FazerCards API v2" : "Central One API"}...
              </div>
            ) : !activeSupplierItems || filteredC1Items.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                {supplierTab === "fazercards"
                  ? "Sin resultados (verifica FAZERCARDS_API_KEY en tu entorno o pulsa 'Buscar en FazerCards')."
                  : "Sin resultados (verifica CENTRAL_ONE_API_KEY en tu entorno)."}
              </div>
            ) : (
              <>
                <div className="text-[11px] text-slate-400">
                  Mostrando {visibleC1Items.length} de {filteredC1Items.length} productos disponibles
                  {filteredC1Items.length > visibleC1Items.length
                    ? " · escribe para filtrar mejor"
                    : ""}
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.06] pr-1">
                  {visibleC1Items.map((item) => (
                    <div
                      key={item.id}
                      className="py-3 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="w-10 h-[52px] rounded-lg bg-slate-900 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                        <img
                          src={suggestProductImageUrl(item.name, item.id)}
                          alt={item.name}
                          loading="lazy"
                          className="w-full h-full object-contain p-0.5"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white">{item.name}</span>
                          {item.requiresTarget ? (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-medium">
                              Recarga por ID
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-medium">
                              PIN / Gift Card
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 flex flex-wrap gap-2 mt-0.5">
                          {item.region && <span className="text-sky-400">{item.region}</span>}
                          {item.sku && <span>{item.sku}</span>}
                          <span className="text-slate-600">{item.id}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                          ${formatCostDisplay(item.resellerPriceRaw, item.resellerPriceCents)}{" "}
                          {item.currency}
                        </span>
                        {c1Callback &&
                          (item.requiresTarget ? (
                            <span
                              title="Este SKU requiere player_id en Central One; elige su versión PIN para Gift Cards."
                              className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] text-slate-500 text-[11px]"
                            >
                              Requiere ID
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                c1Callback(item);
                                setC1ModalOpen(false);
                                toast.success(`Vinculado: ${item.name}`);
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white hover:bg-sky-300 text-slate-950 font-semibold"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Vincular</span>
                            </button>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: Confirmar eliminación de Gift Card */}
      {confirmDeleteProduct && (
        <div className="fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4">
          <div className="rounded-2xl bg-slate-900 border border-rose-500/30 max-w-md w-full p-6 space-y-4 text-xs shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 text-rose-300">
                <Trash2 className="w-5 h-5 shrink-0" />
                <h3 className="text-base font-bold text-white">
                  Eliminar {confirmDeleteProduct.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteProduct(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-slate-300 leading-relaxed">
              Esta acción eliminará la Gift Card y sus{" "}
              <strong className="text-white">
                {confirmDeleteProduct.variants.length} denominaciones
              </strong>{" "}
              (junto con su stock CSV no vendido). Si algún cliente ya compró
              alguna denominación anteriormente, la Gift Card se desactivará para
              ocultarla de la tienda sin perder el historial de órdenes.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deletingProductId === confirmDeleteProduct.id}
                onClick={() => setConfirmDeleteProduct(null)}
                className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingProductId === confirmDeleteProduct.id}
                onClick={() => void handleDeleteProduct(confirmDeleteProduct)}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-semibold"
              >
                {deletingProductId === confirmDeleteProduct.id
                  ? "Eliminando…"
                  : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
