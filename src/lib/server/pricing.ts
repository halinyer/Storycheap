import "server-only";
import {
  buildCartLineKey,
  buildOrderItemTargetInfo,
  isLoginModeTarget,
  normalizeTargetPayloadMap,
  normalizeTargetSchema,
  validateTargetPayloadAgainstSchema,
} from "@/lib/topup-targets";
import { resolveVolumeTierPrice } from "@/lib/volume-discounts";
import type {
  OrderItemTargetInfo,
  ProductDTO,
  ProductVariantDTO,
  SupplierPricingPolicy,
} from "@/types";
import {
  getProviderConfig,
  getSupplierPricingPolicy,
  getVariantPricingMetaMap,
  getVariantsLookupByIds,
  type VariantPricingMeta,
} from "./repository";
import {
  applyLiveQuoteToVariant,
  fetchLiveQuoteForSku,
} from "./supplier-sync";
import {
  getCentralOneBalance,
  validateCentralOnePlayer,
} from "./suppliers/centralone";
import {
  getFazerCardsBalance,
  isFazerCardsProductId,
} from "./suppliers/fazercards";

type ApiSupplierKey = "centralone" | "fazercards";

export interface CartLineInput {
  variantId: string;
  quantity: number;
  expectedUnitPriceCents?: number;
  targetPayload?: Record<string, string>;
  verifiedPlayerName?: string | null;
}

export interface ValidatedCheckoutLine {
  product: ProductDTO;
  variant: ProductVariantDTO;
  quantity: number;
  effectiveUnitPriceCents: number;
  lineTotalCents: number;
  targetInfo?: OrderItemTargetInfo | null;
}

export class CheckoutValidationError extends Error {
  constructor(
    public readonly code:
      | "CHECKOUT_DISABLED"
      | "GATEWAY_DISABLED"
      | "EMPTY_CART"
      | "INVALID_VARIANT"
      | "INVALID_TARGET"
      | "INVALID_PLAYER"
      | "OUT_OF_STOCK"
      | "PRICE_UPDATED"
      | "QUANTITY_LIMIT"
      | "PAGOMOVIL_NOT_CONFIGURED"
      | "BS_RATE_UNAVAILABLE"
      | "PAGOMOVIL_BOT_OFFLINE",
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "CheckoutValidationError";
  }
}

export async function validateAndPriceCart(
  lines: CartLineInput[]
): Promise<{
  validatedLines: ValidatedCheckoutLine[];
  subtotalCents: number;
}> {
  if (!lines.length) {
    throw new CheckoutValidationError(
      "EMPTY_CART",
      "Tu carrito está vacío.",
      400
    );
  }

  const globalCfg = await getProviderConfig("global_checkout");
  if (globalCfg && !globalCfg.enabled) {
    throw new CheckoutValidationError(
      "CHECKOUT_DISABLED",
      "El checkout está pausado temporalmente por mantenimiento. Intenta en unos minutos.",
      503
    );
  }

  // Merge duplicate (variantId + targetPayload) lines safely while capping per-variant total <= 10
  const mergedLines = new Map<
    string,
    {
      variantId: string;
      quantity: number;
      expectedUnitPriceCents?: number;
      targetPayload?: Record<string, string>;
      verifiedPlayerName?: string | null;
    }
  >();
  const totalQtyByVariant = new Map<string, number>();

  for (const item of lines) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) {
      throw new CheckoutValidationError(
        "QUANTITY_LIMIT",
        "La cantidad por producto debe estar entre 1 y 10 unidades.",
        400
      );
    }
    const nextVariantTotal =
      (totalQtyByVariant.get(item.variantId) ?? 0) + item.quantity;
    if (nextVariantTotal > 10) {
      throw new CheckoutValidationError(
        "QUANTITY_LIMIT",
        "Máximo 10 unidades por variante en una sola orden.",
        400
      );
    }
    totalQtyByVariant.set(item.variantId, nextVariantTotal);

    const cleanTarget = item.targetPayload
      ? normalizeTargetPayloadMap(item.targetPayload)
      : undefined;
    const lineKey = buildCartLineKey(item.variantId, cleanTarget);
    const existing = mergedLines.get(lineKey);
    const expectedPrice =
      typeof item.expectedUnitPriceCents === "number" &&
      Number.isFinite(item.expectedUnitPriceCents)
        ? Math.round(item.expectedUnitPriceCents)
        : existing?.expectedUnitPriceCents;

    mergedLines.set(lineKey, {
      variantId: item.variantId,
      quantity: (existing?.quantity ?? 0) + item.quantity,
      expectedUnitPriceCents: expectedPrice,
      targetPayload:
        cleanTarget && Object.keys(cleanTarget).length > 0
          ? cleanTarget
          : existing?.targetPayload,
      verifiedPlayerName:
        item.verifiedPlayerName ?? existing?.verifiedPlayerName ?? null,
    });
  }

  const variantIds = Array.from(totalQtyByVariant.keys());
  const [lookup, reloadlyCfg, centralOneCfg, fazerCardsCfg] = await Promise.all([
    getVariantsLookupByIds(variantIds),
    getProviderConfig("reloadly"),
    getProviderConfig("centralone"),
    getProviderConfig("fazercards"),
  ]);

  const balanceTenthsBySupplier: Partial<Record<ApiSupplierKey, number>> = {};
  let pricingMetaMap: Record<string, VariantPricingMeta> | null = null;
  let pricingPolicy: SupplierPricingPolicy | null = null;

  async function ensureSupplierBalanceTenths(supplier: ApiSupplierKey): Promise<number> {
    const cached = balanceTenthsBySupplier[supplier];
    if (cached !== undefined) return cached;
    const status =
      supplier === "fazercards"
        ? await getFazerCardsBalance()
        : await getCentralOneBalance();
    const tenths =
      status.healthy && status.balanceCents !== null
        ? status.balanceCents * 100
        : 0;
    balanceTenthsBySupplier[supplier] = tenths;
    return tenths;
  }

  const validatedLines: ValidatedCheckoutLine[] = [];
  let subtotalCents = 0;

  for (const lineInput of mergedLines.values()) {
    const { variantId, quantity } = lineInput;
    const found = lookup.get(variantId);
    if (!found || !found.product.active || !found.variant.active) {
      throw new CheckoutValidationError(
        "INVALID_VARIANT",
        "Uno de los productos seleccionados ya no está disponible.",
        400
      );
    }

    const { product, variant } = found;
    let effectiveVariant = variant;
    let targetInfo: OrderItemTargetInfo | null = null;

    if (variant.requiresTarget) {
      const schema = normalizeTargetSchema(
        variant.targetFields,
        variant.targetSchema
      );
      if (isLoginModeTarget(variant.targetFields, schema, product.name)) {
        throw new CheckoutValidationError(
          "INVALID_TARGET",
          `${product.name} requiere credenciales de acceso y no está habilitado para recarga directa por ID.`,
          400
        );
      }

      const targetCheck = validateTargetPayloadAgainstSchema(
        lineInput.targetPayload,
        schema
      );
      if (!targetCheck.ok) {
        throw new CheckoutValidationError(
          "INVALID_TARGET",
          `${product.name} (${variant.denominationLabel}): ${targetCheck.error}`,
          400
        );
      }

      let resolvedPlayerName = lineInput.verifiedPlayerName ?? null;
      let validationStatus: "valid" | "unverified" = "unverified";

      if (variant.centraloneProductId && variant.supportsPlayerValidate) {
        const validation = await validateCentralOnePlayer({
          productId: variant.centraloneProductId,
          targetPayload: targetCheck.cleanPayload,
        });
        if (validation.status === "invalid") {
          throw new CheckoutValidationError(
            "INVALID_PLAYER",
            `El ID ingresado para ${product.name} (${variant.denominationLabel}) no existe o es inválido. Verifícalo antes de pagar.`,
            400
          );
        }
        if (validation.status === "valid") {
          validationStatus = "valid";
          resolvedPlayerName = validation.playerName ?? resolvedPlayerName;
        }
      }

      targetInfo = buildOrderItemTargetInfo({
        payload: targetCheck.cleanPayload,
        schema,
        playerName: resolvedPlayerName,
        validationStatus,
      });
    }

    const csvAvailable =
      variant.requiresTarget ||
      variant.sourcePriority === "centralone_only" ||
      variant.sourcePriority === "reloadly_only"
        ? 0
        : variant.availableStock;
    const deficit = Math.max(0, quantity - csvAvailable);

    if (deficit > 0) {
      const canFallbackReloadly =
        !variant.requiresTarget &&
        Boolean(reloadlyCfg?.enabled) &&
        (variant.sourcePriority === "manual_then_reloadly" ||
          variant.sourcePriority === "reloadly_only") &&
        Boolean(variant.reloadlyProductId);

      const isApiPriority =
        variant.sourcePriority === "manual_then_centralone" ||
        variant.sourcePriority === "centralone_only";
      const isFazerSku = isFazerCardsProductId(variant.centraloneProductId);

      const canUseFazerCards =
        !variant.requiresTarget &&
        isApiPriority &&
        Boolean(variant.centraloneProductId) &&
        isFazerSku &&
        (fazerCardsCfg?.enabled ?? true);

      const canUseCentralOne =
        isApiPriority &&
        Boolean(variant.centraloneProductId) &&
        !isFazerSku &&
        Boolean(centralOneCfg?.enabled);

      const supplierKey: ApiSupplierKey | null = canUseFazerCards
        ? "fazercards"
        : canUseCentralOne
          ? "centralone"
          : null;

      if (supplierKey && variant.centraloneProductId) {
        if (pricingMetaMap === null) {
          pricingMetaMap = await getVariantPricingMetaMap();
        }
        if (pricingPolicy === null) {
          pricingPolicy = await getSupplierPricingPolicy();
        }

        const quote = await fetchLiveQuoteForSku(variant.centraloneProductId);
        if (quote) {
          if (!quote.available) {
            throw new CheckoutValidationError(
              "OUT_OF_STOCK",
              `El distribuidor agotó temporalmente ${product.name} (${variant.denominationLabel}). Disponibles ahora: ${csvAvailable}.`,
              409
            );
          }
          if (quote.stockCount !== null && csvAvailable + quote.stockCount < quantity) {
            throw new CheckoutValidationError(
              "OUT_OF_STOCK",
              `Stock insuficiente para ${product.name} (${variant.denominationLabel}). Disponibles: ${csvAvailable + quote.stockCount}.`,
              409
            );
          }

          const { evaluation, metaPatch } = await applyLiveQuoteToVariant({
            productName: product.name,
            variant: effectiveVariant,
            quote,
            existingMeta: pricingMetaMap[variant.id],
            policy: pricingPolicy,
          });
          pricingMetaMap[variant.id] = metaPatch;

          if (evaluation.valid) {
            effectiveVariant = {
              ...effectiveVariant,
              unitCostCents: evaluation.nextUnitCostCents,
              salePriceCents: evaluation.nextSalePriceCents,
            };
          }

          if (evaluation.belowCostFloor) {
            throw new CheckoutValidationError(
              "PRICE_UPDATED",
              `El costo mayorista de ${product.name} (${variant.denominationLabel}) subió por encima del precio publicado. Actualiza el carrito o espera la revisión de precio.`,
              409
            );
          }

          if (evaluation.salePriceChanged) {
            throw new CheckoutValidationError(
              "PRICE_UPDATED",
              `El precio de ${product.name} (${variant.denominationLabel}) se actualizó de $${(evaluation.oldSalePriceCents / 100).toFixed(2)} a $${(evaluation.nextSalePriceCents / 100).toFixed(2)} por cambio en el distribuidor.`,
              409
            );
          }
        }

        const supplierBalanceTenths = await ensureSupplierBalanceTenths(supplierKey);

        const exactStr = pricingMetaMap[variant.id]?.exactCostUsd;
        const unitTenths =
          quote?.costTenths ??
          (exactStr && /^\d+(\.\d+)?$/.test(exactStr.trim())
            ? Math.round(Number.parseFloat(exactStr.trim()) * 10_000)
            : typeof effectiveVariant.unitCostCents === "number" &&
                effectiveVariant.unitCostCents > 0
              ? effectiveVariant.unitCostCents * 100
              : 1); // minimal non-zero cost when uncosted, still blocked if balance is $0

        const requiredTenths = unitTenths * deficit;
        if (supplierBalanceTenths < requiredTenths || supplierBalanceTenths <= 0) {
          const affordableUnits =
            unitTenths > 0 ? Math.floor(supplierBalanceTenths / unitTenths) : 0;
          const totalAvailable = csvAvailable + affordableUnits;
          throw new CheckoutValidationError(
            "OUT_OF_STOCK",
            `Stock insuficiente para ${product.name} (${variant.denominationLabel}). Disponibles: ${totalAvailable}.`,
            409
          );
        }
        balanceTenthsBySupplier[supplierKey] = supplierBalanceTenths - requiredTenths;
      } else if (!canFallbackReloadly) {
        throw new CheckoutValidationError(
          "OUT_OF_STOCK",
          `Stock insuficiente para ${product.name} (${variant.denominationLabel}). Disponibles: ${csvAvailable}.`,
          409
        );
      }
    }

    // Filter out any volume tier that would sell below current live supplier cost if supplier price spiked
    const costFloorCents =
      typeof effectiveVariant.unitCostCents === "number" &&
      effectiveVariant.unitCostCents > 0
        ? effectiveVariant.unitCostCents
        : null;
    const safeVolumeDiscounts = effectiveVariant.volumeDiscounts?.filter(
      (tier) => costFloorCents === null || tier.unitPriceCents >= costFloorCents
    );

    const tierPricing = resolveVolumeTierPrice({
      baseUnitPriceCents: effectiveVariant.salePriceCents,
      quantity,
      volumeDiscounts: safeVolumeDiscounts,
    });
    const effectiveUnitPriceCents = tierPricing.effectiveUnitPriceCents;

    const expectedUnitPrice = lineInput.expectedUnitPriceCents;
    if (
      typeof expectedUnitPrice === "number" &&
      expectedUnitPrice !== effectiveUnitPriceCents
    ) {
      throw new CheckoutValidationError(
        "PRICE_UPDATED",
        `El precio de ${product.name} (${effectiveVariant.denominationLabel}) cambió a $${(effectiveUnitPriceCents / 100).toFixed(2)}. Actualizamos tu carrito.`,
        409
      );
    }

    const lineTotalCents = tierPricing.lineTotalCents;
    subtotalCents += lineTotalCents;
    validatedLines.push({
      product,
      variant: effectiveVariant,
      quantity,
      effectiveUnitPriceCents,
      lineTotalCents,
      targetInfo,
    });
  }

  return { validatedLines, subtotalCents };
}
