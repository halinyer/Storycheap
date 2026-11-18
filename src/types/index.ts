export type Region = "USA" | "Global" | "Latam" | "Europa";

export type Category = "gaming" | "streaming" | "shopping" | "crypto";

export type SourcePriority =
  | "manual_only"
  | "manual_then_reloadly"
  | "reloadly_only"
  | "manual_then_centralone"
  | "centralone_only";

export type FulfillmentSource = "manual" | "reloadly" | "centralone";

export type PaymentGatewayId = "zenobank" | "pagomovil" | "pablito";

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

export interface VolumeDiscountTier {
  minQuantity: number;
  unitPriceCents: number;
}

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
  volumeDiscounts?: VolumeDiscountTier[];
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
  volumeDiscounts?: VolumeDiscountTier[];
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
  isTest?: boolean;
  testNote?: string | null;
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
    | "fazercards"
    | "pagomovil"
    | "pablito";
  label: string;
  enabled: boolean;
  sandboxMode: boolean;
  minBalanceAlertCents: number;
  updatedAt: string;
}

export interface BotDeviceDTO {
  id: string;
  name: string;
  deviceIdentifier: string;
  channelType: "ANDROID_PUSH" | "ANDROID_SMS" | "EMAIL_SCRIPT";
  allowPlainBearer?: boolean;
  lastHeartbeatAt: string | null;
  batteryLevel: number | null;
  networkType: string | null;
  appVersion: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiverBankAccountDTO {
  id: string;
  bankCode: string;
  bankName: string;
  accountType: "natural" | "juridical";
  phone: string;
  dni: string;
  holderName: string;
  allowedPackages: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BankNotificationStatus =
  | "UNMATCHED"
  | "MATCHED"
  | "DUPLICATE"
  | "IGNORED"
  | "UNPARSED";

export interface BankPaymentNotificationDTO {
  id: string;
  deviceId: string | null;
  receiverAccountId: string | null;
  sourceType: "APP_PUSH" | "SMS" | "EMAIL" | "MANUAL";
  appPackage: string | null;
  rawContentHash: string;
  rawContentPreview: string;
  amountBsCents: number | null;
  currency: "VES" | "USD" | "USDT";
  referenceFull: string | null;
  referenceLast6: string | null;
  referenceLast4: string | null;
  senderPhone: string | null;
  senderDni: string | null;
  senderBankCode: string | null;
  parserUsed: string | null;
  postedAt: string;
  status: BankNotificationStatus;
  matchedOrderId: string | null;
  matchedAt: string | null;
  createdAt: string;
}

export interface PagoMovilBotSettingsDTO {
  rateExpirationMinutes: number;
  orderExpirationMinutes: number;
  amountToleranceBsCents: number;
  watchdogOfflineMinutes: number;
  enforceWatchdog: boolean;
  requireSenderPhone: boolean;
  minReferenceDigits: number;
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

export type TreasuryMovementType =
  | "CAPITAL_IN"
  | "SUPPLIER_TOPUP"
  | "INTERNAL_TRANSFER"
  | "PROFIT_WITHDRAWAL"
  | "EXPENSE_FEE"
  | "RECONCILIATION_ADJUSTMENT";

export type TreasuryAccountId =
  | "external"
  | "zenobank"
  | "pagomovil"
  | "fazercards"
  | "centralone"
  | "manual"
  | "reloadly"
  | "partner_payout"
  | "expense"
  | "adjustment"
  | (string & {});

export interface TreasuryMovementDTO {
  id: string;
  occurredAt: string;
  movementType: TreasuryMovementType;
  sourceAccount: TreasuryAccountId;
  targetAccount: TreasuryAccountId;
  amountUsdCents: number;
  amountBsCents: number | null;
  exchangeRateCents: number | null;
  partnerName: string | null;
  reference: string | null;
  notes: string;
  relatedOrderId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface SupplierPortfolioRow {
  id: string;
  label: string;
  subtitle: string;
  kind: "api" | "inventory";
  accentColor: string;
  enabled: boolean;
  configured: boolean;
  healthy: boolean;
  errorMessage?: string;
  balanceCents: number | null;
  exactBalanceUsd?: string | null;
  minBalanceAlertCents: number;
  needsTopup: boolean;
  fundedCents: number;
  apiSpentAllTimeCents: number | null;
  apiOrdersCount: number | null;
  periodConsumedCents: number;
  periodProfitCents: number;
  periodCodesCount: number;
  allTimeConsumedCents: number;
  allTimeProfitCents: number;
  allTimeCodesCount: number;
  codesAvailableCount?: number;
}

export interface TreasuryPositionSummary {
  /** Efectivo real calculado hoy en ZenoBank / Binance (ventas + aportes + entradas - recargas - retiros - gastos +/- ajustes) */
  zenobankBalanceUsdCents: number;
  /** Efectivo real calculado hoy en Bancamiga / Pago Móvil */
  pagomovilBalanceUsdCents: number;
  pagomovilBalanceBsCents: number;
  /** Total líquido disponible hoy en cuentas receptoras */
  totalReceiversUsdCents: number;
  /** Total capital de trabajo en distribuidores activos (APIs + CSV al costo) */
  totalSuppliersUsdCents: number;
  /** Patrimonio operativo hoy dentro del negocio = Receptoras + Distribuidores */
  totalBusinessEquityUsdCents: number;
  /** Capital aportado neto desde afuera (CAPITAL_IN - retornos de capital) */
  netContributedCapitalUsdCents: number;
  /** Ganancia bruta histórica generada por ventas (según toggle real/pruebas) */
  salesGrossProfitUsdCents: number;
  /** Total acumulado retirado por socios / utilidades */
  withdrawnProfitUsdCents: number;
  /** Total comisiones / gastos operativos */
  expensesUsdCents: number;
  /** Ajustes manuales de conciliación / pruebas */
  reconciliationNetUsdCents: number;
  /** Diferencial cambiario real (P2P Bs->USDT vs tasa congelada) */
  exchangeDiffUsdCents: number;
  /** Ganancia dentro del negocio sin retirar = Equity + Retiros - Capital Aportado (o ventas netas sin retirar) */
  netBusinessProfitUsdCents: number;
  undistributedProfitUsdCents: number;
  /** Parte de la ganancia sin retirar que está líquida hoy en cuentas receptoras (retirable ahora) */
  liquidProfitInReceiversUsdCents: number;
  /** Parte de la ganancia sin retirar que está reinvertida trabajando dentro de distribuidores API/CSV */
  reinvestedProfitInSuppliersUsdCents: number;
  /** Saldo teórico esperado en proveedores vs saldo real en vivo (alerta si falta registrar un fondeo o reembolso) */
  theoreticalSuppliersUsdCents: number;
  suppliersDiscrepancyUsdCents: number;
  /** Pasivo por saldo a favor vigente de clientes */
  creditLiabilityUsdCents: number;
  /** Capital neto descontando pasivo de créditos de clientes */
  netEquityAfterCreditsUsdCents: number;
  /** Ventas y desgloses por período */
  allTimeSalesUsdCents: number;
  allTimeSalesCostUsdCents: number;
  zenobankSalesGrossUsdCents: number;
  pagomovilSalesGrossUsdCents: number;
  pagomovilSalesGrossBsCents: number;
  pagomovilSalesCostUsdCents: number;
  pagomovilNominalProfitUsdCents: number;
  weightedBookBsRateCents: number | null;
  replacementUsdtRateCents: number | null;
  pagomovilMarkToMarketUsdtCents: number;
  unrealizedExchangeDiffUsdCents: number;
  pagomovilRealNetProfitUsdCents: number;
  pagomovilBreakEvenRateCents: number | null;
  creditAppliedSalesUsdCents: number;
  fundedBySupplierUsdCents: Record<string, number>;
}

export type VenezuelaRateBenchmarkKey =
  | "binance_p2p"
  | "euro_bcv"
  | "paralelo"
  | "official_bcv"
  | "highest";

export interface LiveVenezuelaRatesSnapshot {
  officialBcv: number | null;
  euroBcv: number | null;
  paralelo: number | null;
  binanceP2p: number | null;
  officialBcvCents: number | null;
  euroBcvCents: number | null;
  paraleloCents: number | null;
  binanceP2pCents: number | null;
  replacementUsdtRateCents: number | null;
  bcvToUsdtGapPct: number | null;
  source: string;
  fetchedAt: string;
}

export interface BsRateAutoSyncPolicy {
  mode: "manual" | "auto";
  benchmark: VenezuelaRateBenchmarkKey;
  spreadPct: number;
  onlyIncrease: boolean;
  autoSyncIntervalMinutes: number;
  lastSyncedAt: string | null;
  lastSyncedRateCents: number | null;
}

export type SupplierRepriceMode =
  | "protect_floor"
  | "keep_margin_on_increase"
  | "cost_only_block";

export interface SupplierPricingPolicy {
  mode: SupplierRepriceMode;
  minMarginPct: number;
  minMarginUsdCents: number;
  autoSyncIntervalMinutes: number;
  updatedAt?: string;
}

export interface SupplierCostChangeRecord {
  variantId: string;
  productName: string;
  denominationLabel: string;
  supplierLabel: string;
  oldCostUsd: string | null;
  newCostUsd: string;
  oldSaleCents: number;
  newSaleCents: number;
  saleAdjusted: boolean;
  belowFloorBlocked: boolean;
  detectedAt: string;
}

export interface SupplierSyncState {
  lastSyncedAt: string | null;
  lastError: string | null;
  checkedCount: number;
  updatedCostCount: number;
  adjustedSaleCount: number;
  atRiskCount: number;
  recentChanges: SupplierCostChangeRecord[];
}

export interface SupportSettingsDTO {
  supportEmail: string;
  adminNotifyEmail: string | null;
  whatsappEnabled: boolean;
  whatsappNumber: string;
  supportHours: string;
  floatingWidgetEnabled: boolean;
  welcomeMessage: string;
  updatedAt?: string;
}

export interface PublicSupportConfigDTO {
  supportEmail: string;
  whatsappUrl: string | null;
  whatsappDisplay: string | null;
  supportHours: string;
  floatingWidgetEnabled: boolean;
  welcomeMessage: string;
}

export type SupportTicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";

export type SupportTicketTopic =
  | "ORDER_ISSUE"
  | "PAYMENT"
  | "CODE_REDEEM"
  | "GENERAL";

export interface SupportTicketDTO {
  id: string;
  ticketNumber: string;
  userId: string | null;
  customerName: string;
  customerEmail: string;
  orderNumber: string | null;
  topic: SupportTicketTopic;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  adminReply: string | null;
  repliedAt: string | null;
  repliedBy: string | null;
  createdAt: string;
  updatedAt: string;
}


