import "server-only";
import type { ProductDTO, ProductVariantDTO } from "@/types";
import { getProviderConfig, getVariantsLookupByIds } from "./repository";

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
  const lookup = await getVariantsLookupByIds(variantIds);
  const reloadlyCfg = await getProviderConfig("reloadly");

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
    const canFallbackReloadly =
      Boolean(reloadlyCfg?.enabled) &&
      variant.sourcePriority !== "manual_only" &&
      Boolean(variant.reloadlyProductId);

    if (variant.availableStock < quantity && !canFallbackReloadly) {
      throw new CheckoutValidationError(
        "OUT_OF_STOCK",
        `Stock insuficiente para ${product.name} (${variant.denominationLabel}). Disponibles: ${variant.availableStock}.`,
        409
      );
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
