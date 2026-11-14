"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createProductAction,
  createVariantAction,
  fetchCentralOneCatalogAdminAction,
  fetchFazerCardsCatalogAdminAction,
  toggleProductActiveAction,
  updateProductMetaAction,
  updateVariantAdminAction,
} from "@/app/admin/actions";
import {
  evaluateSkuAlignment,
  suggestDenominationLabel,
} from "@/lib/sku-guard";
import type { VariantPricingMeta } from "@/lib/server/repository";
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
  Check,
  Link2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

function normalizeDecimalInput(raw: string): string {
  return raw.replace(",", ".").replace(/[^0-9.]/g, "");
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
  variant,
  pricingMeta,
  liveC1Item,
  reloadlyEnabled,
  centralOneEnabled,
  centralOneBalanceCents,
  fazerCardsEnabled,
  fazerCardsBalanceCents,
  onOpenCentralOnePicker,
  onSaved,
}: {
  productName: string;
  variant: ProductVariantDTO;
  pricingMeta?: VariantPricingMeta;
  liveC1Item?: CentralOneCatalogItem;
  reloadlyEnabled: boolean;
  centralOneEnabled: boolean;
  centralOneBalanceCents: number | null;
  fazerCardsEnabled: boolean;
  fazerCardsBalanceCents: number | null;
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
  const [active, setActive] = useState(variant.active);
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const alignment = useMemo(
    () =>
      evaluateSkuAlignment({
        denominationLabel: label,
        productName,
        supplierName: usesCentralOne ? effectiveC1Name : null,
        supplierSku: usesCentralOne ? effectiveC1Sku : null,
        costUsd: Number.isFinite(parsedCostFloat ?? NaN) ? parsedCostFloat : null,
        saleUsd: Number.isFinite(parsedPriceFloat) ? parsedPriceFloat : null,
      }),
    [
      label,
      productName,
      usesCentralOne,
      effectiveC1Name,
      effectiveC1Sku,
      parsedCostFloat,
      parsedPriceFloat,
    ]
  );

  const isDirty =
    label.trim() !== variant.denominationLabel ||
    priceUsd !== (variant.salePriceCents / 100).toFixed(2) ||
    costUsd !== initialCostStr ||
    sourcePriority !== variant.sourcePriority ||
    centraloneId !== (variant.centraloneProductId ?? "") ||
    effectiveC1Name !== (pricingMeta?.centraloneProductName ?? "") ||
    active !== variant.active ||
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

  const suggestedSearch = productName.split(/[(:·]/)[0]?.trim() || "";

  return (
    <div className={`px-5 py-4 space-y-3 text-xs transition-opacity ${!active ? "opacity-55" : ""}`}>
      {/* Tier 1: Active + Editable Storefront Label + Source Selector + Save */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 basis-[260px]">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 accent-emerald-500 cursor-pointer shrink-0"
            title="Activar/desactivar denominación"
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
}: {
  catalog: ProductDTO[];
  pricingMetaMap?: Record<string, VariantPricingMeta>;
  reloadlyEnabled?: boolean;
  centralOneEnabled?: boolean;
  centralOneBalanceCents?: number | null;
  fazerCardsEnabled?: boolean;
  fazerCardsBalanceCents?: number | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [togglingProductId, setTogglingProductId] = useState<string | null>(null);

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
  const [savingProductMeta, setSavingProductMeta] = useState(false);

  // New Gift Card modal state
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [creatingCard, setCreatingCard] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncCategory, setNcCategory] = useState<Category>("gaming");
  const [ncRegion, setNcRegion] = useState<Region>("USA");
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
      if (!q) return true;
      const haystack = `${product.name} ${product.brand} ${product.region} ${product.variants
        .map((v) => v.denominationLabel)
        .join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [catalog, search, categoryFilter]);

  const activeSupplierItems = supplierTab === "fazercards" ? fazerItems : c1Items;

  const filteredC1Items = useMemo(() => {
    if (!activeSupplierItems) return [];
    const availableItems = activeSupplierItems.filter((item) => {
      if (!item.available) return false;
      return c1ShowAllTypes ? true : !item.requiresTarget;
    });
    const q = c1Search.trim().toLowerCase();
    if (!q) return availableItems;
    return availableItems.filter((item) =>
      `${item.name} ${item.sku ?? ""} ${item.region ?? ""} ${item.id}`
        .toLowerCase()
        .includes(q)
    );
  }, [activeSupplierItems, c1Search, c1ShowAllTypes]);

  const visibleC1Items = useMemo(() => filteredC1Items.slice(0, 80), [filteredC1Items]);

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

    if (supplierTab === "fazercards") {
      await loadFazerCatalog(cleanQ || c1Search);
    } else if (!c1Items) {
      await loadCentralOneCatalog();
    }
  };

  const handleAuditLinkedSkus = async () => {
    setAuditingC1(true);
    try {
      const items = c1Items ?? (await fetchCentralOneCatalogAdminAction());
      if (!c1Items) setC1Items(items);
      const map = new Map(items.map((item) => [item.id, item]));

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

  return (
    <div className="space-y-5">
      {/* Clean Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar Gift Card..."
              className="w-full rounded-xl bg-slate-900/90 border border-white/10 pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-white/25"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl bg-slate-900/90 border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 focus:outline-none"
          >
            <option value="all">Todas las categorías</option>
            <option value="gaming">Gaming</option>
            <option value="streaming">Streaming</option>
            <option value="shopping">Shopping</option>
            <option value="crypto">Crypto</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={auditingC1}
            onClick={() => void handleAuditLinkedSkus()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/15 bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 font-semibold text-xs transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${auditingC1 ? "animate-spin" : ""}`} />
            <span>{auditingC1 ? "Auditando…" : "Auditar SKUs Central One"}</span>
          </button>

          <button
            type="button"
            onClick={() => setNewCardOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-sky-300 text-slate-950 font-semibold text-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Gift Card</span>
          </button>
        </div>
      </div>

      {/* Clean Brand Cards */}
      <div className="space-y-4">
        {filteredCatalog.map((product) => (
          <div
            key={product.id}
            className={`rounded-2xl bg-slate-900/75 border border-white/[0.08] overflow-hidden ${
              !product.active ? "opacity-65" : ""
            }`}
          >
            <div className="px-5 py-3.5 bg-white/[0.02] border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
              {editingProductId === product.id ? (
                <form
                  onSubmit={(e) => void handleSaveProductMeta(e)}
                  className="flex flex-wrap items-center gap-2 flex-1"
                >
                  <input
                    required
                    type="text"
                    value={editProductName}
                    onChange={(e) => setEditProductName(e.target.value)}
                    className="rounded-lg bg-slate-950 border border-sky-400/50 px-2.5 py-1.5 text-xs font-bold text-white min-w-[220px]"
                  />
                  <select
                    value={editProductRegion}
                    onChange={(e) => setEditProductRegion(e.target.value as Region)}
                    className="rounded-lg bg-slate-950 border border-white/15 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="USA">USA</option>
                    <option value="Global">Global</option>
                    <option value="Latam">Latam</option>
                    <option value="Europa">Europa</option>
                  </select>
                  <select
                    value={editProductCategory}
                    onChange={(e) => setEditProductCategory(e.target.value as Category)}
                    className="rounded-lg bg-slate-950 border border-white/15 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="gaming">Gaming</option>
                    <option value="streaming">Streaming</option>
                    <option value="shopping">Shopping</option>
                    <option value="crypto">Crypto</option>
                  </select>
                  <button
                    type="submit"
                    disabled={savingProductMeta}
                    className="px-3 py-1.5 rounded-lg bg-white text-slate-950 font-semibold text-xs hover:bg-sky-300"
                  >
                    {savingProductMeta ? "…" : "Guardar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingProductId(null)}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] text-slate-300 text-xs"
                  >
                    Cancelar
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-white">{product.name}</span>
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.07] text-xs font-medium text-slate-300">
                    {product.region}
                  </span>
                  <span className="text-xs text-slate-500 capitalize">
                    {product.category}
                  </span>
                  <button
                    type="button"
                    title="Editar nombre, región o categoría"
                    onClick={() => {
                      setEditingProductId(product.id);
                      setEditProductName(product.name);
                      setEditProductRegion(product.region);
                      setEditProductCategory(product.category);
                    }}
                    className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/[0.08]"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setVariantModalProduct(product);
                    setNvC1Id("");
                    setNvC1Name("");
                    setNvC1Sku("");
                    setNvC1Region("");
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-slate-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Denominación</span>
                </button>

                <button
                  type="button"
                  disabled={togglingProductId === product.id}
                  onClick={() => void handleToggleProduct(product)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    product.active
                      ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                      : "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{product.active ? "Activa" : "Desactivada"}</span>
                </button>
              </div>
            </div>

            <div className="divide-y divide-white/[0.05]">
              {product.variants.map((variant) => (
                <VariantRow
                  key={variant.id}
                  productName={product.name}
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
                  onOpenCentralOnePicker={(applySelection, initialQuery) =>
                    void openCentralOneCatalogModal(applySelection, initialQuery)
                  }
                  onSaved={() => router.refresh()}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Modal: Nueva Gift Card */}
      {newCardOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleCreateProduct(e)}
            className="rounded-2xl bg-slate-900 border border-white/15 max-w-lg w-full p-6 space-y-4 text-xs shadow-2xl"
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
                  onChange={(e) => setNcName(e.target.value)}
                  placeholder="Ej. Nintendo eShop USA"
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-white"
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
                  <option value="centralone_only">Central One</option>
                  <option value="manual_then_centralone">CSV → Central One</option>
                </select>
              </div>

              {(ncSource === "centralone_only" || ncSource === "manual_then_centralone") && (
                <div className="sm:col-span-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sky-300">
                      Vincular SKU de Central One (auto-rellena etiqueta y costo)
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
                            setNcName(item.name.replace(/\s*·\s*PIN\b/gi, "").trim());
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
                        }, ncName.trim() || undefined)
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
                  <option value="centralone_only">Central One</option>
                  <option value="manual_then_centralone">CSV → Central One</option>
                </select>
              </div>
              {(nvSource === "centralone_only" || nvSource === "manual_then_centralone") && (
                <div className="col-span-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sky-300">
                      SKU Central One (auto-rellena etiqueta y costo exacto)
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
                        }, variantModalProduct?.name.split(/[(:·]/)[0]?.trim())
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
                    if (!fazerItems) void loadFazerCatalog(c1Search);
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
                  onClick={() => void loadFazerCatalog(c1Search)}
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
                      void loadFazerCatalog(c1Search);
                    }
                  }}
                  placeholder={
                    supplierTab === "fazercards"
                      ? "Escribe ej. netflix, playstation, steam y pulsa Enter o 'Buscar en FazerCards'..."
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
    </div>
  );
}
