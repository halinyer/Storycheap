import "server-only";
import type { ProductDTO, ProductVariantDTO } from "@/types";
import {
  getProviderConfig,
  getVariantPricingMetaMap,
  getVariantsLookupByIds,
} from "./repository";
import { getCentralOneBalance } from "./suppliers/centralone";

export interface CartLineInput {
  variantId: string;
  quantity: number;
}

export interface ValidatedCheckoutLine {
  product: ProductDTO;
  variant: ProductVariantDTO;
  quantity: number;
  lineTotalCents: number;
}

export class CheckoutValidationError extends Error {
  constructor(
    public readonly code:
      | "CHECKOUT_DISABLED"
      | "GATEWAY_DISABLED"
      | "EMPTY_CART"
      | "INVALID_VARIANT"
      | "OUT_OF_STOCK"
      | "QUANTITY_LIMIT",
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

  // Merge duplicate variantIds safely
  const mergedQty = new Map<string, number>();
  for (const item of lines) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) {
      throw new CheckoutValidationError(
        "QUANTITY_LIMIT",
        "La cantidad por producto debe estar entre 1 y 10 unidades.",
        400
      );
    }
    const nextQty = (mergedQty.get(item.variantId) ?? 0) + item.quantity;
    if (nextQty > 10) {
      throw new CheckoutValidationError(
        "QUANTITY_LIMIT",
        "Máximo 10 unidades por variante en una sola orden.",
        400
      );
    }
    mergedQty.set(item.variantId, nextQty);
  }

  const variantIds = Array.from(mergedQty.keys());
  const [lookup, reloadlyCfg, centralOneCfg] = await Promise.all([
    getVariantsLookupByIds(variantIds),
    getProviderConfig("reloadly"),
    getProviderConfig("centralone"),
  ]);

  let liveCentralOneBalanceTenths: number | null = null;
  let pricingMetaMap: Record<string, { exactCostUsd?: string | null }> | null = null;

  const validatedLines: ValidatedCheckoutLine[] = [];
  let subtotalCents = 0;

  for (const [variantId, quantity] of mergedQty.entries()) {
    const found = lookup.get(variantId);
    if (!found || !found.product.active || !found.variant.active) {
      throw new CheckoutValidationError(
        "INVALID_VARIANT",
        "Uno de los productos seleccionados ya no está disponible.",
        400
      );
    }

    const { product, variant } = found;
    const csvAvailable =
      variant.sourcePriority === "centralone_only" ||
      variant.sourcePriority === "reloadly_only"
        ? 0
        : variant.availableStock;
    const deficit = Math.max(0, quantity - csvAvailable);

    if (deficit > 0) {
      const canFallbackReloadly =
        Boolean(reloadlyCfg?.enabled) &&
        (variant.sourcePriority === "manual_then_reloadly" ||
          variant.sourcePriority === "reloadly_only") &&
        Boolean(variant.reloadlyProductId);

      const canUseCentralOne =
        Boolean(centralOneCfg?.enabled) &&
        (variant.sourcePriority === "manual_then_centralone" ||
          variant.sourcePriority === "centralone_only") &&
        Boolean(variant.centraloneProductId);

      if (canUseCentralOne) {
        if (liveCentralOneBalanceTenths === null) {
          const [bal, meta] = await Promise.all([
            getCentralOneBalance(),
            getVariantPricingMetaMap(),
          ]);
          liveCentralOneBalanceTenths =
            bal.healthy && bal.balanceCents !== null ? bal.balanceCents * 100 : 0;
          pricingMetaMap = meta;
        }

        const exactStr = pricingMetaMap?.[variant.id]?.exactCostUsd;
        const unitTenths =
          exactStr && /^\d+(\.\d+)?$/.test(exactStr.trim())
            ? Math.round(Number.parseFloat(exactStr.trim()) * 10_000)
            : typeof variant.unitCostCents === "number" && variant.unitCostCents > 0
              ? variant.unitCostCents * 100
              : 1; // minimal non-zero cost when uncosted, still blocked if balance is $0

        const requiredTenths = unitTenths * deficit;
        if (liveCentralOneBalanceTenths < requiredTenths || liveCentralOneBalanceTenths <= 0) {
          const affordableUnits =
            unitTenths > 0 ? Math.floor(liveCentralOneBalanceTenths / unitTenths) : 0;
          const totalAvailable = csvAvailable + affordableUnits;
          throw new CheckoutValidationError(
            "OUT_OF_STOCK",
            `Stock insuficiente para ${product.name} (${variant.denominationLabel}). Disponibles: ${totalAvailable}.`,
            409
          );
        }
        liveCentralOneBalanceTenths -= requiredTenths;
      } else if (!canFallbackReloadly) {
        throw new CheckoutValidationError(
          "OUT_OF_STOCK",
          `Stock insuficiente para ${product.name} (${variant.denominationLabel}). Disponibles: ${csvAvailable}.`,
          409
        );
      }
    }

    const lineTotalCents = variant.salePriceCents * quantity;
    subtotalCents += lineTotalCents;
    validatedLines.push({
      product,
      variant,
      quantity,
      lineTotalCents,
    });
  }

  return { validatedLines, subtotalCents };
}
