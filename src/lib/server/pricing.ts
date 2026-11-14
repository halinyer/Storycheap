import "server-only";
import type { ProductDTO, ProductVariantDTO } from "@/types";
import {
  getProviderConfig,
  getVariantPricingMetaMap,
  getVariantsLookupByIds,
} from "./repository";
import { getCentralOneBalance } from "./suppliers/centralone";
import {
  getFazerCardsBalance,
  isFazerCardsProductId,
} from "./suppliers/fazercards";

type ApiSupplierKey = "centralone" | "fazercards";

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
  const [lookup, reloadlyCfg, centralOneCfg, fazerCardsCfg] = await Promise.all([
    getVariantsLookupByIds(variantIds),
    getProviderConfig("reloadly"),
    getProviderConfig("centralone"),
    getProviderConfig("fazercards"),
  ]);

  const balanceTenthsBySupplier: Partial<Record<ApiSupplierKey, number>> = {};
  let pricingMetaMap: Record<string, { exactCostUsd?: string | null }> | null = null;

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

      const isApiPriority =
        variant.sourcePriority === "manual_then_centralone" ||
        variant.sourcePriority === "centralone_only";
      const isFazerSku = isFazerCardsProductId(variant.centraloneProductId);

      const canUseFazerCards =
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

      if (supplierKey) {
        if (pricingMetaMap === null) {
          pricingMetaMap = await getVariantPricingMetaMap();
        }
        const supplierBalanceTenths = await ensureSupplierBalanceTenths(supplierKey);

        const exactStr = pricingMetaMap[variant.id]?.exactCostUsd;
        const unitTenths =
          exactStr && /^\d+(\.\d+)?$/.test(exactStr.trim())
            ? Math.round(Number.parseFloat(exactStr.trim()) * 10_000)
            : typeof variant.unitCostCents === "number" && variant.unitCostCents > 0
              ? variant.unitCostCents * 100
              : 1; // minimal non-zero cost when uncosted, still blocked if balance is $0

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
