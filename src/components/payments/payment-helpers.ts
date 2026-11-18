import { resolveBrandTheme } from "@/lib/brand-theme";
import { formatBsNumber } from "@/lib/currency";
import type { CartItem, OrderItemDTO, Region } from "@/types";

const VALID_REGIONS: ReadonlySet<string> = new Set([
  "USA",
  "Global",
  "Latam",
  "Europa",
]);

export { formatBsNumber };

export function formatCountdown(
  targetIso: string | null | undefined,
  nowMs: number
): string {
  if (!targetIso) return "--:--";
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) return "--:--";
  const diffSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function buildCartEntriesFromOrderItems(
  items: OrderItemDTO[]
): Array<{ item: Omit<CartItem, "quantity">; quantity: number }> {
  return items.map((orderItem) => {
    const theme = resolveBrandTheme(orderItem.productName, orderItem.productSlug);
    const region: Region = VALID_REGIONS.has(orderItem.region)
      ? (orderItem.region as Region)
      : "USA";

    return {
      item: {
        variantId: orderItem.variantId,
        productId: orderItem.productSlug || orderItem.variantId,
        productSlug: orderItem.productSlug,
        productName: orderItem.productName,
        brand: theme.brandName,
        region,
        imageUrl: theme.imageUrl,
        denominationLabel: orderItem.denominationLabel,
        unitPriceCents: orderItem.unitPriceCents,
        unitCostCents: orderItem.unitCostCents ?? null,
      },
      quantity: Math.max(1, Math.min(10, orderItem.quantity)),
    };
  });
}
