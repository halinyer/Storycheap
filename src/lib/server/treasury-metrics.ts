import type {
  OrderDTO,
  SupplierPortfolioRow,
  TreasuryMovementDTO,
  TreasuryMovementType,
  TreasuryPositionSummary,
} from "@/types";
import { summarizeOrdersMetrics } from "./sales-metrics";

const RECEIVER_ACCOUNTS = new Set(["zenobank", "pagomovil"]);
const KNOWN_SUPPLIER_ACCOUNTS = new Set([
  "fazercards",
  "centralone",
  "manual",
  "reloadly",
]);

function isReceiverAccount(account: string): account is "zenobank" | "pagomovil" {
  return RECEIVER_ACCOUNTS.has(account);
}

function isSupplierAccount(
  account: string,
  extraSupplierIds: Set<string>
): boolean {
  return KNOWN_SUPPLIER_ACCOUNTS.has(account) || extraSupplierIds.has(account);
}

export interface ComputeTreasuryPositionInput {
  orders: OrderDTO[];
  movements: TreasuryMovementDTO[];
  suppliers: Array<Pick<SupplierPortfolioRow, "id" | "balanceCents" | "enabled" | "configured">>;
  actualItemCostCents?: Record<string, number>;
  matchedBsByOrder?: Record<string, number | null>;
  creditLiabilityUsdCents?: number;
  includeTestOrders?: boolean;
  bsRateCents?: number | null;
}

/**
 * Computes the complete live cash & capital equation of the business:
 *
 *  - Business Equity Today = Receivers (ZenoBank + PagoMovil) + Suppliers (APIs + CSV)
 *  - Net Business Profit   = Sales Gross Profit + Exchange Diff - Expenses
 *  - Undistributed Profit  = Net Business Profit - Profit Withdrawals
 *  - Expected Suppliers    = Funded Suppliers - Active Orders Cost - Supplier Outflows + Supplier Adjustments
 */
export function computeTreasuryPosition({
  orders,
  movements,
  suppliers,
  actualItemCostCents = {},
  matchedBsByOrder,
  creditLiabilityUsdCents = 0,
  includeTestOrders = false,
  bsRateCents = null,
}: ComputeTreasuryPositionInput): TreasuryPositionSummary {
  const activeOrdersMetrics = summarizeOrdersMetrics(orders, actualItemCostCents, {
    includeTestOrders,
    matchedBsByOrder,
  });

  const supplierIdSet = new Set(suppliers.map((s) => s.id));
  const fundedBySupplierUsdCents: Record<string, number> = {};
  for (const id of [...KNOWN_SUPPLIER_ACCOUNTS, ...supplierIdSet]) {
    fundedBySupplierUsdCents[id] = 0;
  }

  let zenobankBalanceUsdCents = activeOrdersMetrics.zenobankCents;
  let pagomovilBalanceUsdCents = activeOrdersMetrics.pagomovilCents;
  let pagomovilBalanceBsCents = activeOrdersMetrics.pagomovilBsCents;

  // Weighted average Bs/USD book rate from historical Pago Movil sales for clean P2P Bs -> USDT swaps
  const weightedBookBsRateCents =
    activeOrdersMetrics.pagomovilCents > 0 && activeOrdersMetrics.pagomovilBsCents > 0
      ? Math.round(
          (activeOrdersMetrics.pagomovilBsCents * 100) /
            activeOrdersMetrics.pagomovilCents
        )
      : bsRateCents && bsRateCents > 0
        ? bsRateCents
        : null;

  let netContributedCapitalUsdCents = 0;
  let withdrawnProfitUsdCents = 0;
  let expensesUsdCents = 0;
  let reconciliationNetUsdCents = 0;
  let exchangeDiffUsdCents = 0;

  let theoreticalSuppliersUsdCents = -activeOrdersMetrics.costCents;

  const activeMovements = movements
    .filter((m) => !m.voidedAt)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  for (const m of activeMovements) {
    const usd = m.amountUsdCents;
    const bs = m.amountBsCents ?? 0;

    switch (m.movementType) {
      case "CAPITAL_IN": {
        netContributedCapitalUsdCents += usd;
        if (m.targetAccount === "zenobank") {
          zenobankBalanceUsdCents += usd;
        } else if (m.targetAccount === "pagomovil") {
          pagomovilBalanceUsdCents += usd;
          pagomovilBalanceBsCents += bs;
        } else if (isSupplierAccount(m.targetAccount, supplierIdSet)) {
          fundedBySupplierUsdCents[m.targetAccount] =
            (fundedBySupplierUsdCents[m.targetAccount] ?? 0) + usd;
          theoreticalSuppliersUsdCents += usd;
        }
        break;
      }

      case "SUPPLIER_TOPUP": {
        if (m.sourceAccount === "zenobank") {
          zenobankBalanceUsdCents -= usd;
        } else if (m.sourceAccount === "pagomovil") {
          pagomovilBalanceUsdCents -= usd;
          pagomovilBalanceBsCents -= bs;
        } else if (m.sourceAccount === "external") {
          netContributedCapitalUsdCents += usd;
        }
        if (isSupplierAccount(m.targetAccount, supplierIdSet)) {
          fundedBySupplierUsdCents[m.targetAccount] =
            (fundedBySupplierUsdCents[m.targetAccount] ?? 0) + usd;
          theoreticalSuppliersUsdCents += usd;
        }
        break;
      }

      case "INTERNAL_TRANSFER": {
        if (m.sourceAccount === "pagomovil" && m.targetAccount === "zenobank") {
          pagomovilBalanceBsCents -= bs;
          // Book USD released from Bancamiga using weighted sale rate (or real amount if no Bs passed)
          const releasedBookUsdCents =
            bs > 0 && weightedBookBsRateCents
              ? Math.round((bs * 100) / weightedBookBsRateCents)
              : usd;
          pagomovilBalanceUsdCents -= releasedBookUsdCents;
          zenobankBalanceUsdCents += usd;
          if (bs > 0 && weightedBookBsRateCents) {
            exchangeDiffUsdCents += usd - releasedBookUsdCents;
          }
        } else {
          if (m.sourceAccount === "zenobank") zenobankBalanceUsdCents -= usd;
          if (m.sourceAccount === "pagomovil") {
            pagomovilBalanceUsdCents -= usd;
            pagomovilBalanceBsCents -= bs;
          }
          if (m.targetAccount === "zenobank") zenobankBalanceUsdCents += usd;
          if (m.targetAccount === "pagomovil") {
            pagomovilBalanceUsdCents += usd;
            pagomovilBalanceBsCents += bs;
          }
        }
        break;
      }

      case "PROFIT_WITHDRAWAL": {
        withdrawnProfitUsdCents += usd;
        if (m.sourceAccount === "zenobank") {
          zenobankBalanceUsdCents -= usd;
        } else if (m.sourceAccount === "pagomovil") {
          pagomovilBalanceUsdCents -= usd;
          pagomovilBalanceBsCents -= bs;
        } else if (isSupplierAccount(m.sourceAccount, supplierIdSet)) {
          theoreticalSuppliersUsdCents -= usd;
        }
        break;
      }

      case "EXPENSE_FEE": {
        expensesUsdCents += usd;
        if (m.sourceAccount === "zenobank") {
          zenobankBalanceUsdCents -= usd;
        } else if (m.sourceAccount === "pagomovil") {
          pagomovilBalanceUsdCents -= usd;
          pagomovilBalanceBsCents -= bs;
        } else if (isSupplierAccount(m.sourceAccount, supplierIdSet)) {
          theoreticalSuppliersUsdCents -= usd;
        }
        break;
      }

      case "RECONCILIATION_ADJUSTMENT": {
        // Adjustment adding value into an account
        if (
          m.sourceAccount === "adjustment" &&
          (isReceiverAccount(m.targetAccount) ||
            isSupplierAccount(m.targetAccount, supplierIdSet))
        ) {
          reconciliationNetUsdCents += usd;
          if (m.targetAccount === "zenobank") zenobankBalanceUsdCents += usd;
          else if (m.targetAccount === "pagomovil") {
            pagomovilBalanceUsdCents += usd;
            pagomovilBalanceBsCents += bs;
          } else {
            fundedBySupplierUsdCents[m.targetAccount] =
              (fundedBySupplierUsdCents[m.targetAccount] ?? 0) + usd;
            theoreticalSuppliersUsdCents += usd;
          }
        } else {
          // Adjustment removing / settling value out of an account (e.g. off-platform partner refund)
          reconciliationNetUsdCents -= usd;
          if (m.sourceAccount === "zenobank") zenobankBalanceUsdCents -= usd;
          else if (m.sourceAccount === "pagomovil") {
            pagomovilBalanceUsdCents -= usd;
            pagomovilBalanceBsCents -= bs;
          } else if (isSupplierAccount(m.sourceAccount, supplierIdSet)) {
            theoreticalSuppliersUsdCents -= usd;
          }
        }
        break;
      }
    }
  }

  let totalSuppliersUsdCents = 0;
  for (const s of suppliers) {
    const includeBalance =
      s.id === "manual"
        ? s.enabled || (s.balanceCents ?? 0) > 0
        : s.enabled || s.configured;
    if (includeBalance && typeof s.balanceCents === "number") {
      totalSuppliersUsdCents += s.balanceCents;
    }
  }

  const totalReceiversUsdCents = zenobankBalanceUsdCents + pagomovilBalanceUsdCents;
  const totalBusinessEquityUsdCents =
    totalReceiversUsdCents + totalSuppliersUsdCents;

  const netBusinessProfitUsdCents =
    activeOrdersMetrics.profitCents + exchangeDiffUsdCents - expensesUsdCents;
  const undistributedProfitUsdCents =
    netBusinessProfitUsdCents - withdrawnProfitUsdCents;
  const liquidProfitInReceiversUsdCents =
    undistributedProfitUsdCents > 0
      ? Math.min(undistributedProfitUsdCents, Math.max(0, totalReceiversUsdCents))
      : 0;
  const reinvestedProfitInSuppliersUsdCents =
    undistributedProfitUsdCents > 0
      ? undistributedProfitUsdCents - liquidProfitInReceiversUsdCents
      : 0;

  const suppliersDiscrepancyUsdCents =
    totalSuppliersUsdCents - theoreticalSuppliersUsdCents;

  return {
    zenobankBalanceUsdCents,
    pagomovilBalanceUsdCents,
    pagomovilBalanceBsCents,
    totalReceiversUsdCents,
    totalSuppliersUsdCents,
    totalBusinessEquityUsdCents,
    netContributedCapitalUsdCents,
    salesGrossProfitUsdCents: activeOrdersMetrics.profitCents,
    withdrawnProfitUsdCents,
    expensesUsdCents,
    reconciliationNetUsdCents,
    exchangeDiffUsdCents,
    netBusinessProfitUsdCents,
    undistributedProfitUsdCents,
    liquidProfitInReceiversUsdCents,
    reinvestedProfitInSuppliersUsdCents,
    theoreticalSuppliersUsdCents,
    suppliersDiscrepancyUsdCents,
    creditLiabilityUsdCents,
    netEquityAfterCreditsUsdCents:
      totalBusinessEquityUsdCents - creditLiabilityUsdCents,
    allTimeSalesUsdCents: activeOrdersMetrics.revenueCents,
    allTimeSalesCostUsdCents: activeOrdersMetrics.costCents,
    zenobankSalesGrossUsdCents: activeOrdersMetrics.zenobankCents,
    pagomovilSalesGrossUsdCents: activeOrdersMetrics.pagomovilCents,
    pagomovilSalesGrossBsCents: activeOrdersMetrics.pagomovilBsCents,
    creditAppliedSalesUsdCents: activeOrdersMetrics.creditAppliedCents,
    fundedBySupplierUsdCents,
  };
}

/**
 * Splits a treasury operation that carries an on-chain/bank network fee into
 * the net transfer/capital entry plus a paired `EXPENSE_FEE` entry so account
 * balances, theoretical supplier cupo, and net profit all reconcile to the penny.
 */
export function buildTreasuryMovementWithFeePlan(input: {
  movementType: TreasuryMovementType;
  sourceAccount: string;
  targetAccount: string;
  amountUsdCents: number;
  networkFeeUsdCents?: number | null;
}): {
  primaryAmountUsdCents: number;
  feeEntry: {
    movementType: "EXPENSE_FEE";
    sourceAccount: string;
    targetAccount: "expense";
    amountUsdCents: number;
  } | null;
} {
  const feeCents = Math.max(0, Math.round(Number(input.networkFeeUsdCents ?? 0)));
  if (!Number.isFinite(feeCents) || feeCents === 0) {
    return { primaryAmountUsdCents: input.amountUsdCents, feeEntry: null };
  }
  if (
    input.movementType !== "SUPPLIER_TOPUP" &&
    input.movementType !== "CAPITAL_IN" &&
    input.movementType !== "PROFIT_WITHDRAWAL"
  ) {
    throw new Error(
      "La comisión de red se aplica en recargas a distribuidor, aportes de capital o retiros."
    );
  }
  if (input.amountUsdCents <= feeCents) {
    throw new Error(
      "La comisión de red debe ser menor que el monto total enviado."
    );
  }

  const fromExternal =
    input.sourceAccount === "external" || input.movementType === "CAPITAL_IN";

  if (fromExternal) {
    return {
      primaryAmountUsdCents: input.amountUsdCents,
      feeEntry: {
        movementType: "EXPENSE_FEE",
        sourceAccount: input.targetAccount,
        targetAccount: "expense",
        amountUsdCents: feeCents,
      },
    };
  }

  return {
    primaryAmountUsdCents: input.amountUsdCents - feeCents,
    feeEntry: {
      movementType: "EXPENSE_FEE",
      sourceAccount: input.sourceAccount,
      targetAccount: "expense",
      amountUsdCents: feeCents,
    },
  };
}
