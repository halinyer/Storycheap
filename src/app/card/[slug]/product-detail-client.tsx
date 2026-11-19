"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PayYourWay } from "@/components/storefront/pay-your-way";
import { Card3DInteractive } from "@/components/ui/card-3d-interactive";
import { useStore } from "@/context/store-context";
import { resolveBrandTheme } from "@/lib/brand-theme";
import { formatCents } from "@/lib/catalog-seed";
import { formatBsFromUsdCents } from "@/lib/currency";
import {
  buildCartLineKey,
  formatTargetSummary,
  getHumanTargetFieldLabel,
  getTargetFieldPlaceholder,
  normalizeTargetSchema,
  validateTargetPayloadAgainstSchema,
} from "@/lib/topup-targets";
import {
  getBestVolumeTierHint,
  MAX_ORDER_QUANTITY_PER_LINE,
  resolveVolumeTierPrice,
} from "@/lib/volume-discounts";
import type { ProductDTO } from "@/types";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Gamepad2,
  Globe,
  HelpCircle,
  Loader2,
  Lock,
  Mail,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  ShoppingCart,
  UserCheck,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

interface ProductDetailClientProps {
  product: ProductDTO;
  initialBsRateCents?: number | null;
}

export function ProductDetailClient({
  product,
  initialBsRateCents = null,
}: ProductDetailClientProps) {
  const router = useRouter();
  const {
    addToCart,
    setCartDrawerOpen,
    setSelectedCategory,
    displayCurrency,
    bsRateCents,
    hydrateBsRateCents,
  } = useStore();

  useEffect(() => {
    if (typeof initialBsRateCents === "number" && initialBsRateCents > 0) {
      hydrateBsRateCents(initialBsRateCents);
    }
  }, [initialBsRateCents, hydrateBsRateCents]);

  const effectiveBsRateCents = bsRateCents ?? initialBsRateCents;

  const activeVariants = product.variants
    .filter((v) => v.active)
    .sort(
      (a, b) =>
        a.salePriceCents - b.salePriceCents || a.faceValueCents - b.faceValueCents
    );
  const firstAvailable =
    activeVariants.find((v) => v.inStock) ?? activeVariants[0];
  const [selectedVariantId, setSelectedVariantId] = useState(
    firstAvailable?.id ?? ""
  );
  const [quantity, setQuantity] = useState(1);
  const [targetValues, setTargetValues] = useState<Record<string, string>>({});
  const [validatingPlayer, setValidatingPlayer] = useState(false);
  const [playerValidation, setPlayerValidation] = useState<{
    signature: string;
    status: "valid" | "invalid" | "unverified";
    playerName: string | null;
    reason: string | null;
  } | null>(null);
  const [manualIdConfirmed, setManualIdConfirmed] = useState(false);
  const [showUidHelp, setShowUidHelp] = useState(false);

  const selectedVariant =
    activeVariants.find((v) => v.id === selectedVariantId) ?? firstAvailable;

  const isDirectTopup = Boolean(selectedVariant?.requiresTarget);
  const targetSchema = selectedVariant?.requiresTarget
    ? normalizeTargetSchema(
        selectedVariant.targetFields,
        selectedVariant.targetSchema
      )
    : [];
  const currentTargetSignature = selectedVariant
    ? buildCartLineKey(selectedVariant.id, targetValues)
    : "";
  const activeValidation =
    playerValidation && playerValidation.signature === currentTargetSignature
      ? playerValidation
      : null;

  const canBuy = Boolean(selectedVariant && selectedVariant.inStock);
  const accent = product.accentColor || "#0070d1";
  const brandTheme = resolveBrandTheme(product.name, product.slug);

  const maxQuantity = selectedVariant
    ? typeof selectedVariant.deliverableStock === "number" &&
      selectedVariant.deliverableStock > 0
      ? Math.min(MAX_ORDER_QUANTITY_PER_LINE, selectedVariant.deliverableStock)
      : selectedVariant.availableStock > 0
        ? Math.min(MAX_ORDER_QUANTITY_PER_LINE, selectedVariant.availableStock)
        : MAX_ORDER_QUANTITY_PER_LINE
    : 1;

  const variantTierHint = selectedVariant
    ? getBestVolumeTierHint({
        baseUnitPriceCents: selectedVariant.salePriceCents,
        volumeDiscounts: selectedVariant.volumeDiscounts,
      })
    : { tiers: [], firstTier: null, bestTier: null, maxDiscountPct: 0 };

  const tierPricing = resolveVolumeTierPrice({
    baseUnitPriceCents: selectedVariant?.salePriceCents ?? 0,
    quantity,
    volumeDiscounts: selectedVariant?.volumeDiscounts,
  });

  const outOfStockLabels = activeVariants
    .filter((v) => !v.inStock)
    .map((v) => v.denominationLabel);

  const runPlayerValidation = async (): Promise<{
    status: "valid" | "invalid" | "unverified";
    playerName: string | null;
    cleanPayload: Record<string, string>;
  } | null> => {
    if (!selectedVariant || !selectedVariant.requiresTarget) return null;
    const fieldCheck = validateTargetPayloadAgainstSchema(
      targetValues,
      targetSchema
    );
    if (!fieldCheck.ok) {
      toast.error(fieldCheck.error);
      return null;
    }

    setValidatingPlayer(true);
    try {
      const res = await fetch("/api/catalog/validate-player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId: selectedVariant.id,
          targetPayload: fieldCheck.cleanPayload,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        status?: "valid" | "invalid" | "unverified";
        playerName?: string | null;
        reason?: string | null;
        cleanPayload?: Record<string, string>;
      };
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo verificar el ID del jugador.");
        return null;
      }
      const status = data.status ?? "unverified";
      const playerName = data.playerName ?? null;
      const cleanPayload = data.cleanPayload ?? fieldCheck.cleanPayload;
      setPlayerValidation({
        signature: buildCartLineKey(selectedVariant.id, cleanPayload),
        status,
        playerName,
        reason: data.reason ?? null,
      });

      if (status === "valid") {
        toast.success(
          playerName
            ? `Jugador verificado: ${playerName}`
            : "ID de jugador verificado correctamente"
        );
      } else if (status === "invalid") {
        toast.error(
          "ID de jugador no encontrado. Revisa el ID o servidor antes de pagar."
        );
      } else {
        toast.info(
          "Este juego no muestra nickname en vivo. Confirma que tu ID sea exacto."
        );
      }

      return { status, playerName, cleanPayload };
    } catch {
      toast.error("Error de red verificando el ID del jugador.");
      return null;
    } finally {
      setValidatingPlayer(false);
    }
  };

  const handleAddToCart = async (redirectCheckout: boolean) => {
    if (!selectedVariant || !selectedVariant.inStock) {
      toast.error("Esta denominación no tiene stock disponible en este momento.");
      return;
    }

    let cleanPayload: Record<string, string> | undefined;
    let verifiedPlayerName: string | null = null;
    let targetValidationStatus: "valid" | "unverified" | undefined;
    let targetSummary: string | undefined;

    if (selectedVariant.requiresTarget) {
      const fieldCheck = validateTargetPayloadAgainstSchema(
        targetValues,
        targetSchema
      );
      if (!fieldCheck.ok) {
        toast.error(fieldCheck.error);
        return;
      }
      cleanPayload = fieldCheck.cleanPayload;

      if (selectedVariant.supportsPlayerValidate) {
        let validation = activeValidation;
        if (!validation) {
          const liveRes = await runPlayerValidation();
          if (!liveRes) return;
          validation = {
            signature: buildCartLineKey(selectedVariant.id, liveRes.cleanPayload),
            status: liveRes.status,
            playerName: liveRes.playerName,
            reason: null,
          };
          cleanPayload = liveRes.cleanPayload;
        }
        if (validation.status === "invalid") {
          toast.error(
            "El ID ingresado es inválido. Corrige el ID y vuelve a verificarlo."
          );
          return;
        }
        if (validation.status === "unverified" && !manualIdConfirmed) {
          toast.error(
            "Marca la casilla de confirmación de ID antes de continuar."
          );
          return;
        }
        verifiedPlayerName = validation.playerName;
        targetValidationStatus =
          validation.status === "valid" ? "valid" : "unverified";
      } else {
        if (!manualIdConfirmed) {
          toast.error(
            "Confirma que tu ID y servidor son exactos antes de continuar."
          );
          return;
        }
        targetValidationStatus = "unverified";
      }

      targetSummary = formatTargetSummary(
        cleanPayload,
        targetSchema,
        verifiedPlayerName
      );
    }

    addToCart(
      {
        cartKey: buildCartLineKey(selectedVariant.id, cleanPayload),
        variantId: selectedVariant.id,
        productId: product.id,
        productSlug: product.slug,
        productName: product.name,
        brand: product.brand,
        region: product.region,
        imageUrl: product.imageUrl,
        denominationLabel: selectedVariant.denominationLabel,
        unitPriceCents: selectedVariant.salePriceCents,
        volumeDiscounts: selectedVariant.volumeDiscounts,
        ...(selectedVariant.requiresTarget
          ? {
              requiresTarget: true,
              targetPayload: cleanPayload,
              targetSummary,
              verifiedPlayerName,
              targetValidationStatus,
            }
          : {}),
      },
      quantity
    );

    if (redirectCheckout) {
      router.push("/checkout");
    } else {
      toast.success(
        selectedVariant.requiresTarget && verifiedPlayerName
          ? `${product.brand} (${selectedVariant.denominationLabel}) para ${verifiedPlayerName} agregado al carrito`
          : `${product.brand} (${selectedVariant.denominationLabel}) agregado al carrito`
      );
      setCartDrawerOpen(true);
    }
  };

  const liveTargetPreview = isDirectTopup
    ? formatTargetSummary(targetValues, targetSchema)
    : "";

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* CoinGate-style Hierarchical Breadcrumb */}
      <nav
        aria-label="Ruta de navegación"
        className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-400 mb-7"
      >
        <Link
          href="/#catalogo"
          onClick={() => setSelectedCategory("ALL")}
          className="hover:text-white transition-colors"
        >
          Catálogo
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
        <Link
          href="/#catalogo"
          onClick={() =>
            setSelectedCategory(isDirectTopup ? "topup" : product.category)
          }
          className="hover:text-white transition-colors"
        >
          {isDirectTopup
            ? "Recargas Directas"
            : product.category === "gaming"
              ? "Juegos y Consolas"
              : product.category === "streaming"
                ? "Streaming y Música"
                : product.category === "shopping"
                  ? "Apple y Tiendas USA"
                  : "Cripto USDT"}
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
        <span className="text-slate-200 font-semibold truncate">
          {product.name}
        </span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
        {/* Left Column: Product Hero Banner + Pay Your Way + Description */}
        <div className="lg:col-span-7 space-y-7">
          {/* Restrained Hero Card Banner */}
          <div
            className="rounded-2xl border border-white/[0.08] p-6 sm:p-7"
            style={{
              background: `linear-gradient(135deg, ${accent}24 0%, rgba(15, 17, 25, 0.92) 65%)`,
            }}
          >
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
              <div className="w-44 sm:w-48 shrink-0">
                <Card3DInteractive
                  minimal
                  imageSrc={product.imageUrl}
                  cardName={product.name}
                  brand={product.brand}
                  accentColor={accent}
                  region={product.region}
                />
              </div>

              <div className="flex-1 min-w-0 space-y-3 text-center sm:text-left pt-1">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <span className="text-xs font-medium text-slate-300/85">
                    {product.brand}
                  </span>
                  {isDirectTopup && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/25 text-[10px] font-bold text-sky-300">
                      <Zap className="w-2.5 h-2.5" />
                      <span>Recarga directa por ID</span>
                    </span>
                  )}
                </div>

                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white leading-tight">
                  {product.name}
                </h1>

                <div className="space-y-2 pt-1 text-xs text-slate-300">
                  <div className="flex items-center justify-center sm:justify-start gap-2">
                    <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>
                      Válida en la región:{" "}
                      <strong className="font-medium text-white">
                        {product.region}
                      </strong>
                    </span>
                  </div>

                  <div className="flex items-center justify-center sm:justify-start gap-2">
                    {isDirectTopup ? (
                      <Gamepad2 className="w-4 h-4 text-sky-400 shrink-0" />
                    ) : (
                      <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span>
                      {isDirectTopup ? "Recarga directa:" : "Entrega digital:"}{" "}
                      <span className="text-slate-200">
                        {isDirectTopup
                          ? "directo a tu ID de juego (sin PIN ni códigos)"
                          : "al instante en tus pedidos y correo"}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Minimalist Payment Marks Strip */}
          <PayYourWay variant="card" />

          {/* Description */}
          <div className="space-y-4">
            <p className="text-sm text-slate-300 leading-relaxed">
              {product.description}
            </p>

            {product.regionWarning && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-100/90 leading-relaxed">
                  <span className="font-medium text-amber-300 block mb-0.5">
                    Verifica la región antes de comprar
                  </span>
                  {product.regionWarning}
                </div>
              </div>
            )}
          </div>

          {/* Always-Open Official Redemption / Direct Top-Up Guide Card */}
          <div className="rounded-2xl border border-white/[0.1] bg-[#11131c] p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-sky-400 block">
                  {isDirectTopup ? "Recarga directa por ID" : "Guía paso a paso"}
                </span>
                <h2 className="text-base sm:text-lg font-black text-white mt-0.5">
                  {isDirectTopup
                    ? `¿Cómo funciona la recarga directa de ${product.brand || product.name}?`
                    : `¿Dónde y cómo canjear tu código de ${brandTheme.brandName}?`}
                </h2>
              </div>

              {!isDirectTopup && (
                <div className="flex flex-wrap items-center gap-2">
                  {brandTheme.redeemUrl && (
                    <a
                      href={brandTheme.redeemUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-xs font-bold text-white transition-colors"
                    >
                      <span>{brandTheme.redeemLabel}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
                    </a>
                  )}
                  {brandTheme.secondaryRedeemUrl &&
                    brandTheme.secondaryRedeemLabel && (
                      <a
                        href={brandTheme.secondaryRedeemUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-xs font-bold text-slate-300 transition-colors"
                      >
                        <span>{brandTheme.secondaryRedeemLabel}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                      </a>
                    )}
                </div>
              )}
            </div>

            {!isDirectTopup && brandTheme.redeemHost && (
              <div className="text-xs text-slate-400">
                Sitio web oficial de canje:{" "}
                <span className="font-mono font-bold text-sky-300">
                  {brandTheme.redeemHost}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(isDirectTopup && product.redemptionSteps.length > 0
                ? product.redemptionSteps
                : brandTheme.steps
              ).map((step, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-slate-950/75 border border-white/[0.07] p-3.5 space-y-1.5"
                >
                  <div className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 text-white font-black text-[10px] uppercase">
                    Paso {i + 1}
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {step}
                  </p>
                </div>
              ))}
            </div>

            {brandTheme.importantNote && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-400/25 px-3.5 py-2.5 text-xs text-amber-100/95 leading-relaxed">
                <strong className="text-amber-300 font-bold">
                  Importante:{" "}
                </strong>
                {brandTheme.importantNote}
              </div>
            )}

            <details className="group rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
              <summary className="flex items-center justify-between cursor-pointer list-none text-xs font-bold text-slate-300">
                <span>Términos y compatibilidad regional</span>
                <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" />
              </summary>
              <p className="mt-2.5 text-xs text-slate-400 leading-relaxed">
                {product.terms || "Válido únicamente para la región indicada."}
              </p>
            </details>
          </div>
        </div>

        {/* Right Column: Unified Purchase Card */}
        <div className="lg:col-span-5 lg:sticky lg:top-24">
          <div className="rounded-2xl border border-white/[0.1] bg-[#0e1017] p-6 space-y-5 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.65)]">
            {/* Region Row */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-slate-400 block">
                Región
              </span>
              <div className="rounded-xl border border-white/[0.1] bg-white/[0.025] px-3.5 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-sm font-medium text-white truncate">
                    {product.region}
                  </span>
                  {activeVariants.some(
                    (v) => (v.volumeDiscounts?.length ?? 0) > 0
                  ) && (
                    <span
                      title="Esta tarjeta ofrece descuentos por volumen"
                      className="text-xs font-extrabold text-[#e53935]"
                    >
                      %
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-medium text-emerald-400/90 shrink-0">
                  Compatible
                </span>
              </div>
            </div>

            {/* Denomination Grid */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isDirectTopup && (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-slate-950 text-[11px] font-black shrink-0">
                      1
                    </span>
                  )}
                  <span className="text-xs font-semibold text-slate-200">
                    {isDirectTopup ? "Selecciona tu paquete" : "Valor"}
                  </span>
                </div>
                {isDirectTopup && selectedVariant && (
                  <span className="text-[11px] text-slate-400 truncate">
                    {selectedVariant.denominationLabel}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {activeVariants.map((variant) => {
                  const isSelected = selectedVariant?.id === variant.id;
                  const vHint = getBestVolumeTierHint({
                    baseUnitPriceCents: variant.salePriceCents,
                    volumeDiscounts: variant.volumeDiscounts,
                  });
                  const variantBs = formatBsFromUsdCents(
                    variant.salePriceCents,
                    effectiveBsRateCents
                  );
                  const showVariantBsPrimary =
                    displayCurrency === "VES" && Boolean(variantBs);

                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => {
                        setSelectedVariantId(variant.id);
                        setQuantity(1);
                      }}
                      className={`relative rounded-xl border px-3 py-2.5 text-left transition-all ${
                        isSelected
                          ? "border-white bg-white/[0.07] text-white ring-1 ring-white/50"
                          : variant.inStock
                            ? "border-white/[0.1] bg-transparent hover:border-white/25 hover:bg-white/[0.03] text-slate-200"
                            : "border-white/[0.05] bg-transparent text-slate-500 opacity-50"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-1.5">
                        <span className="text-[13px] font-semibold leading-snug">
                          {variant.denominationLabel}
                        </span>
                        {vHint.maxDiscountPct > 0 && (
                          <span className="text-[11px] font-bold text-[#e53935] tabular-nums shrink-0">
                            -{vHint.maxDiscountPct}%
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                        {showVariantBsPrimary
                          ? variantBs
                          : `${formatCents(variant.salePriceCents)} USD`}
                      </div>
                      {showVariantBsPrimary ? (
                        <div className="text-[10px] text-slate-500 tabular-nums">
                          ≈ {formatCents(variant.salePriceCents)} USD
                        </div>
                      ) : (
                        variantBs && (
                          <div className="text-[10px] text-slate-500 tabular-nums">
                            ≈ {variantBs}
                          </div>
                        )
                      )}
                    </button>
                  );
                })}
              </div>

              {outOfStockLabels.length > 0 && (
                <p className="text-[11px] text-slate-500 pt-0.5">
                  Fuera de stock: {outOfStockLabels.join(" · ")}
                </p>
              )}
            </div>

            {/* Step 2: CoinGate-Style Direct Top-Up Account Form */}
            {selectedVariant && isDirectTopup && (
              <div className="border-t border-white/[0.08] pt-5 space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-slate-950 text-[11px] font-black shrink-0">
                      2
                    </span>
                    <span className="text-xs font-semibold text-slate-200">
                      Cuenta de {product.brand}
                    </span>
                  </div>

                  {selectedVariant.supportsPlayerValidate ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/12 border border-emerald-400/25 text-[10px] font-semibold text-emerald-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span>Verificación en vivo</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowUidHelp((prev) => !prev)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>¿Dónde veo mi UID?</span>
                    </button>
                  )}
                </div>

                {showUidHelp && (
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] px-3.5 py-2.5 text-[11px] text-slate-300 leading-relaxed">
                    Abre <strong className="text-white">{product.brand}</strong> y mira la{" "}
                    <strong className="text-white">esquina inferior derecha</strong> de la pantalla: allí aparece tu UID numérico (9 dígitos). No necesitamos tu contraseña.
                  </div>
                )}

                <div className="space-y-3">
                  {targetSchema.map((field) => {
                    const labelText = getHumanTargetFieldLabel(
                      field.key,
                      field.label
                    );
                    const val = targetValues[field.key] ?? "";
                    const isSelect =
                      field.type === "select" &&
                      field.options &&
                      field.options.length > 0;
                    return (
                      <div key={field.key} className="space-y-1.5">
                        <label
                          htmlFor={`target-field-${field.key}`}
                          className="block text-[11px] font-medium text-slate-400"
                        >
                          {labelText}
                        </label>
                        {isSelect ? (
                          <div className="relative">
                            <select
                              id={`target-field-${field.key}`}
                              value={val}
                              onChange={(e) => {
                                setTargetValues((prev) => ({
                                  ...prev,
                                  [field.key]: e.target.value,
                                }));
                                setManualIdConfirmed(false);
                              }}
                              className="w-full appearance-none rounded-xl bg-[#141722] border border-white/[0.12] hover:border-white/25 focus:border-white/55 px-3.5 py-2.5 pr-9 text-xs font-medium text-white transition-colors focus:outline-none cursor-pointer"
                            >
                              <option value="" className="bg-[#11131c] text-slate-400">
                                Selecciona tu servidor...
                              </option>
                              {field.options?.map((opt) => (
                                <option
                                  key={opt.value}
                                  value={opt.value}
                                  className="bg-[#11131c] text-white"
                                >
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
                          </div>
                        ) : (
                          <input
                            id={`target-field-${field.key}`}
                            type="text"
                            value={val}
                            maxLength={64}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={getTargetFieldPlaceholder(field.key)}
                            onChange={(e) => {
                              setTargetValues((prev) => ({
                                ...prev,
                                [field.key]: e.target.value,
                              }));
                              setManualIdConfirmed(false);
                            }}
                            className="w-full rounded-xl bg-[#141722] border border-white/[0.12] hover:border-white/25 focus:border-white/55 px-3.5 py-2.5 text-sm font-mono tracking-wide text-white placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-500 transition-colors focus:outline-none"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {selectedVariant.supportsPlayerValidate && (
                  <button
                    type="button"
                    disabled={validatingPlayer}
                    onClick={() => void runPlayerValidation()}
                    className="w-full py-2.5 px-3.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.12] text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {validatingPlayer ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                        <span>Verificando cuenta...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-3.5 h-3.5 text-sky-400" />
                        <span>Verificar ID y ver Nickname</span>
                      </>
                    )}
                  </button>
                )}

                {activeValidation?.status === "valid" && (
                  <div className="rounded-xl bg-emerald-500/12 border border-emerald-400/30 px-3.5 py-2.5 flex items-center gap-2.5">
                    <UserCheck className="w-4 h-4 text-emerald-300 shrink-0" />
                    <div className="text-xs text-emerald-100 leading-snug">
                      <span className="font-semibold text-emerald-300 block">
                        {activeValidation.playerName
                          ? `Jugador: ${activeValidation.playerName}`
                          : "ID verificado correctamente"}
                      </span>
                      <span className="text-[11px] text-emerald-200/80">
                        Cuenta confirmada en el servidor del juego.
                      </span>
                    </div>
                  </div>
                )}

                {activeValidation?.status === "invalid" && (
                  <div className="rounded-xl bg-rose-500/12 border border-rose-400/30 px-3.5 py-2.5 flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                    <div className="text-xs text-rose-100 leading-snug">
                      <span className="font-semibold text-rose-300 block">
                        ID de jugador no encontrado
                      </span>
                      <span className="text-[11px] text-rose-200/85">
                        Revisa el número de ID{targetSchema.length > 1 ? " y el servidor" : ""} antes de pagar.
                      </span>
                    </div>
                  </div>
                )}

                {liveTargetPreview && activeValidation?.status !== "invalid" && (
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-400 shrink-0">Destino:</span>
                    <span className="font-mono text-slate-200 truncate">
                      {liveTargetPreview}
                    </span>
                  </div>
                )}

                {(!selectedVariant.supportsPlayerValidate ||
                  activeValidation?.status === "unverified") && (
                  <label className="flex items-start gap-2.5 cursor-pointer rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.07] px-3 py-2.5 text-[11px] text-slate-300 transition-colors">
                    <input
                      type="checkbox"
                      checked={manualIdConfirmed}
                      onChange={(e) => setManualIdConfirmed(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-white/25 bg-[#141722] accent-sky-500 cursor-pointer shrink-0"
                    />
                    <span className="leading-relaxed">
                      Confirmo que el ID{targetSchema.length > 1 ? " y servidor son" : " es"} exacto. Las recargas acreditadas no son reversibles.
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* Quiet, High-Trust Purchase Block */}
            {selectedVariant && (() => {
              const hasTiers = variantTierHint.tiers.length > 0;
              const totalBs = formatBsFromUsdCents(
                tierPricing.lineTotalCents,
                effectiveBsRateCents
              );
              const showBsPrimary =
                displayCurrency === "VES" && Boolean(totalBs);
              const regularTotalBs = formatBsFromUsdCents(
                tierPricing.regularLineTotalCents,
                effectiveBsRateCents
              );

              return (
                <div className="border-t border-white/[0.08] pt-4 space-y-4">
                  {/* Quantity + Minimal Volume Pricing Selector */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {isDirectTopup && (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-slate-950 text-[11px] font-black shrink-0">
                            3
                          </span>
                        )}
                        <span className="text-xs font-semibold text-slate-200">
                          {isDirectTopup ? "Cantidad y pago" : "Cantidad"}
                        </span>
                        {hasTiers && variantTierHint.firstTier && (
                          <span className="text-[11px] text-slate-500 ml-1 tabular-nums">
                            Desc. desde {variantTierHint.firstTier.minQuantity} u.
                          </span>
                        )}
                      </div>

                      <div className="inline-flex items-center rounded-xl border border-white/[0.1] bg-white/[0.025] p-0.5 shrink-0">
                        <button
                          type="button"
                          aria-label="Disminuir cantidad"
                          disabled={quantity <= 1}
                          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/[0.06] disabled:opacity-35 transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-7 text-center text-xs font-semibold text-white tabular-nums">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          aria-label="Aumentar cantidad"
                          disabled={!canBuy || quantity >= maxQuantity}
                          onClick={() =>
                            setQuantity((q) => Math.min(maxQuantity, q + 1))
                          }
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/[0.06] disabled:opacity-35 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {hasTiers && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!canBuy}
                          onClick={() => setQuantity(1)}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium tabular-nums transition-all ${
                            !tierPricing.appliedTier
                              ? "border-white/75 bg-white/[0.08] text-white"
                              : "border-white/[0.09] bg-transparent hover:border-white/25 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          1 u. · {formatCents(selectedVariant.salePriceCents)}
                        </button>

                        {variantTierHint.tiers.map((tier) => {
                          const isActive =
                            tierPricing.appliedTier?.minQuantity ===
                            tier.minQuantity;
                          const unavailableByStock =
                            tier.minQuantity > maxQuantity;
                          const pct =
                            selectedVariant.salePriceCents > 0
                              ? Number(
                                  (
                                    ((selectedVariant.salePriceCents -
                                      tier.unitPriceCents) /
                                      selectedVariant.salePriceCents) *
                                    100
                                  ).toFixed(1)
                                )
                              : 0;
                          const tierBs = formatBsFromUsdCents(
                            tier.unitPriceCents,
                            effectiveBsRateCents
                          );

                          return (
                            <button
                              key={tier.minQuantity}
                              type="button"
                              disabled={!canBuy || unavailableByStock}
                              onClick={() => setQuantity(tier.minQuantity)}
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium tabular-nums transition-all ${
                                isActive
                                  ? "border-white/75 bg-white/[0.08] text-white"
                                  : unavailableByStock
                                    ? "border-white/[0.05] text-slate-600 opacity-50 cursor-not-allowed"
                                    : "border-white/[0.09] bg-transparent hover:border-white/25 text-slate-300 hover:text-white"
                              }`}
                            >
                              {tier.minQuantity}+ u. ·{" "}
                              {displayCurrency === "VES" && tierBs
                                ? tierBs
                                : formatCents(tier.unitPriceCents)}{" "}
                              <span className="text-slate-400">(-{pct}%)</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Clean Final Price & Savings Readout */}
                  <div className="pt-1 space-y-1">
                    <span className="text-xs text-slate-400 block">Pagas</span>

                    <div className="flex flex-wrap items-baseline gap-2.5 tabular-nums">
                      <span className="text-3xl font-bold tracking-tight text-white">
                        {showBsPrimary ? (
                          totalBs
                        ) : (
                          <>
                            {formatCents(tierPricing.lineTotalCents)}{" "}
                            <span className="text-base font-medium text-slate-300">
                              USD
                            </span>
                          </>
                        )}
                      </span>

                      {tierPricing.lineSavingsCents > 0 ? (
                        <>
                          <span className="text-sm font-medium text-slate-500 line-through">
                            {showBsPrimary && regularTotalBs
                              ? regularTotalBs
                              : `${formatCents(tierPricing.regularLineTotalCents)} USD`}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-[#e53935] text-white text-xs font-bold shadow-sm">
                            -{tierPricing.discountPct}%
                          </span>
                        </>
                      ) : (
                        hasTiers &&
                        variantTierHint.firstTier &&
                        variantTierHint.firstTier.minQuantity <= maxQuantity && (
                          <button
                            type="button"
                            disabled={!canBuy}
                            onClick={() =>
                              setQuantity(
                                variantTierHint.firstTier?.minQuantity ?? 1
                              )
                            }
                            className="px-2.5 py-0.5 rounded-full bg-[#e53935] hover:bg-[#dc2626] text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
                          >
                            Hasta -{variantTierHint.maxDiscountPct}% (
                            {variantTierHint.firstTier.minQuantity}+ u.)
                          </button>
                        )
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400 tabular-nums">
                      {showBsPrimary ? (
                        <span>
                          ≈ {formatCents(tierPricing.lineTotalCents)} USD
                        </span>
                      ) : (
                        totalBs && <span>≈ {totalBs}</span>
                      )}
                      {quantity > 1 && (
                        <span>
                          · {formatCents(tierPricing.effectiveUnitPriceCents)}/u
                        </span>
                      )}
                      {tierPricing.lineSavingsCents > 0 && (
                        <span className="text-slate-200 font-medium">
                          · Ahorras {formatCents(tierPricing.lineSavingsCents)} USD
                        </span>
                      )}
                    </div>

                    {tierPricing.nextTier &&
                      tierPricing.nextTier.minQuantity <= maxQuantity && (
                        <p className="text-[11px] text-slate-400 tabular-nums pt-0.5">
                          Agrega{" "}
                          <span className="text-slate-200 font-medium">
                            {tierPricing.nextTier.minQuantity - quantity} más
                          </span>{" "}
                          para pagar{" "}
                          <span className="text-slate-200 font-medium">
                            {formatCents(tierPricing.nextTier.unitPriceCents)} USD/u
                          </span>
                          .
                        </p>
                      )}

                    {selectedVariant.inStock ? (
                      <div className="pt-1 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          En stock
                          {typeof selectedVariant.deliverableStock === "number" &&
                          selectedVariant.deliverableStock <= 5
                            ? ` · ${selectedVariant.deliverableStock} disp.`
                            : ""}
                        </span>
                      </div>
                    ) : (
                      <div className="pt-1 inline-flex items-center gap-1.5 text-xs font-medium text-rose-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Fuera de stock</span>
                      </div>
                    )}
                  </div>

                  {/* Primary & Secondary CTAs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <button
                      type="button"
                      disabled={
                        !canBuy ||
                        validatingPlayer ||
                        activeValidation?.status === "invalid"
                      }
                      onClick={() => void handleAddToCart(true)}
                      className="w-full py-3 px-4 rounded-xl bg-[#0070d1] hover:bg-[#0b84eb] disabled:bg-white/[0.06] disabled:text-slate-500 text-white font-semibold text-sm flex items-center justify-center transition-colors shadow-sm"
                    >
                      <span>
                        {validatingPlayer
                          ? "Verificando..."
                          : canBuy
                            ? isDirectTopup
                              ? "Recargar ahora"
                              : "Comprar ahora"
                            : "Sin stock"}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={
                        !canBuy ||
                        validatingPlayer ||
                        activeValidation?.status === "invalid"
                      }
                      onClick={() => void handleAddToCart(false)}
                      className="w-full py-3 px-4 rounded-xl border border-white/[0.16] bg-transparent hover:bg-white/[0.05] disabled:opacity-40 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors"
                    >
                      <ShoppingCart className="w-4 h-4 shrink-0" />
                      <span>Añadir al carrito</span>
                    </button>
                  </div>

                  {/* 3-Column Trust Footer */}
                  <div className="border-t border-white/[0.08] pt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="space-y-1">
                      <Lock className="w-3.5 h-3.5 text-slate-400 mx-auto" />
                      <span className="block text-[11px] text-slate-400 leading-tight">
                        Pago seguro
                      </span>
                    </div>
                    <div className="space-y-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400 mx-auto" />
                      <span className="block text-[11px] text-slate-400 leading-tight">
                        {isDirectTopup ? "Acreditación directa" : "Entrega al instante"}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-slate-400 mx-auto" />
                      <span className="block text-[11px] text-slate-400 leading-tight">
                        {isDirectTopup ? "Recarga oficial" : "Códigos oficiales"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
