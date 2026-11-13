export type Region = "USA" | "Global" | "Latam" | "Europa";

export type Category = "gaming" | "streaming" | "shopping" | "crypto";

export type SourcePriority =
  | "manual_only"
  | "manual_then_reloadly"
  | "reloadly_only"
  | "manual_then_centralone"
  | "centralone_only";

export type FulfillmentSource = "manual" | "reloadly" | "centralone";

export type PaymentGatewayId = "zenobank" | "pablito";

export type OrderStatus =
  | "CREATED"
  | "PENDING_PAYMENT"
  | "PAID"
  | "FULFILLING"
  | "DELIVERED"
  | "PARTIAL"
  | "MANUAL_REVIEW"
  | "EXPIRED"
  | "CANCELLED"
  | "REFUNDED_CREDIT";

export type OrderItemStatus =
  | "PENDING"
  | "RESERVED"
  | "FULFILLED"
  | "MANUAL_REVIEW"
  | "REFUNDED_CREDIT";

export type InventoryStatus = "AVAILABLE" | "RESERVED" | "DELIVERED" | "VOID";

export type CreditReason =
  | "overpayment"
  | "partial_payment"
  | "fulfillment_refund"
  | "checkout_apply"
  | "admin_adjust";

export interface ProductVariantDTO {
  id: string;
  productId: string;
  denominationLabel: string;
  faceValueCents: number;
  salePriceCents: number;
  unitCostCents?: number | null;
  currency: string;
  sourcePriority: SourcePriority;
  reloadlyProductId: number | null;
  centraloneProductId?: string | null;
  lowStockThreshold: number;
  active: boolean;
  availableStock: number;
  supplierStock?: number | null;
  deliverableStock?: number | null;
  inStock: boolean;
}

export interface ProductDTO {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: Category;
  region: Region;
  regionWarning: string | null;
  description: string;
  redemptionSteps: string[];
  terms: string;
  imageUrl: string;
  accentColor: string;
  gradient: string;
  active: boolean;
  isPopular: boolean;
  variants: ProductVariantDTO[];
}

export interface CartItem {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  brand: string;
  region: Region;
  imageUrl: string;
  denominationLabel: string;
  unitPriceCents: number;
  unitCostCents?: number | null;
  quantity: number;
}

export interface OrderItemDTO {
  id: string;
  orderId: string;
  variantId: string;
  productName: string;
  productSlug: string;
  denominationLabel: string;
  region: string;
  unitPriceCents: number;
  unitCostCents?: number | null;
  quantity: number;
  deliveredCount: number;
  status: OrderItemStatus;
}

export interface FulfillmentSummaryDTO {
  id: string;
  orderItemId: string;
  orderId: string;
  productName: string;
  denominationLabel: string;
  region: string;
  source: FulfillmentSource;
  codeLast4: string;
  supplierTxId?: string | null;
  revealedAt: string | null;
  createdAt: string;
}

export interface RevealedCodeDTO {
  fulfillmentId: string;
  productName: string;
  denominationLabel: string;
  region: string;
  code: string;
  pin?: string | null;
  revealedAt: string;
}

export interface OrderDTO {
  id: string;
  orderNumber: string;
  userId: string | null;
  email: string;
  status: OrderStatus;
  subtotalCents: number;
  creditAppliedCents: number;
  amountDueCents: number;
  paidCents: number;
  bsRateCents?: number | null;
  totalBsCents?: number | null;
  paymentGateway: PaymentGatewayId;
  gatewayCheckoutId: string | null;
  gatewayCheckoutUrl: string | null;
  expiresAt: string | null;
  needsAttention: boolean;
  attentionReason: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemDTO[];
  fulfillments: FulfillmentSummaryDTO[];
}

export interface CreditLedgerEntryDTO {
  id: string;
  userId: string;
  orderId: string | null;
  deltaCents: number;
  reason: CreditReason;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CustomerSummaryDTO {
  id: string;
  email: string;
  role: "customer" | "admin";
  creditBalanceCents: number;
  ordersCount: number;
  totalSpentCents: number;
  createdAt: string;
}

export interface InventoryItemAdminDTO {
  id: string;
  variantId: string;
  productName: string;
  denominationLabel: string;
  codeLast4: string;
  batchId: string | null;
  expiresAt: string | null;
  status: InventoryStatus;
  reservedOrderId: string | null;
  deliveredOrderId: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface WebhookEventDTO {
  id: string;
  gateway: string;
  eventId: string;
  eventType: string;
  orderId: string | null;
  gatewayCheckoutId: string | null;
  signatureValid: boolean;
  status: "processed" | "ignored" | "failed";
  errorMessage: string | null;
  processedAt: string;
}

export interface ProviderConfigDTO {
  id:
    | "global_checkout"
    | "zenobank"
    | "manual_inventory"
    | "reloadly"
    | "centralone"
    | "pablito";
  label: string;
  enabled: boolean;
  sandboxMode: boolean;
  minBalanceAlertCents: number;
  updatedAt: string;
}

export interface AuditLogEntryDTO {
  id: string;
  actorId: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  role: "customer" | "admin";
  aal: "aal1" | "aal2";
  isSandbox: boolean;
}
