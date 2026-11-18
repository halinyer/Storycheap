"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  captureMonthlyCapitalSnapshotAction,
  settleHistoricalTestsAction,
  voidTreasuryMovementAction,
} from "@/app/admin/actions";
import { BsExchangeDeskCard } from "@/components/admin/bs-exchange-desk-card";
import {
  ReceiverLedgersSection,
  type MatchedPagoMovilSummary,
} from "@/components/admin/receiver-ledgers-section";
import {
  TreasuryMovementModal,
  type TreasuryMovementModalPreset,
} from "@/components/admin/treasury-movement-modal";
import { formatCents, formatExactUsd } from "@/lib/catalog-seed";
import type {
  CapitalSnapshotRecord,
  ZenoBinanceReceiverDTO,
  ZenoPaymentProofDTO,
} from "@/lib/server/repository";
import { formatBsCents } from "@/lib/server/sales-metrics";
import type {
  BsRateAutoSyncPolicy,
  LiveVenezuelaRatesSnapshot,
  OrderDTO,
  ReceiverBankAccountDTO,
  SupplierPortfolioRow,
  TreasuryMovementDTO,
  TreasuryMovementType,
  TreasuryPositionSummary,
} from "@/types";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Ban,
  Camera,
  CheckCircle2,
  ClipboardCopy,
  FlaskConical,
  Landmark,
  Plus,
  Scale,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

const MOVEMENT_BADGES: Record<
  TreasuryMovementType,
  { label: string; cls: string }
> = {
  CAPITAL_IN: {
    label: "Aporte Capital",
    cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
  SUPPLIER_TOPUP: {
    label: "Reinversión API",
    cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  },
  INTERNAL_TRANSFER: {
    label: "Cambio / Traspaso",
    cls: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  },
  PROFIT_WITHDRAWAL: {
    label: "Retiro Ganancia",
    cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  EXPENSE_FEE: {
    label: "Gasto / Fee",
    cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  RECONCILIATION_ADJUSTMENT: {
    label: "Ajuste Cuadre",
    cls: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  },
};

const ACCOUNT_NAMES: Record<string, string> = {
  external: "Capital Externo",
  zenobank: "Binance / ZenoBank",
  pagomovil: "Pago Móvil (Bs)",
  fazercards: "FazerCards API",
  centralone: "Central One API",
  manual: "Stock CSV",
  reloadly: "Reloadly API",
  partner_payout: "Retiro Socios",
  expense: "Gasto / Fee",
  adjustment: "Ajuste Contable",
};

function labelAccount(id: string): string {
  return ACCOUNT_NAMES[id] ?? id;
}

export function TreasuryConsole({
  orders,
  movements,
  suppliers,
  position,
  bsRateCents = null,
  bsRatePolicy = null,
  liveRates = null,
  snapshots: initialSnapshots,
  sqlMigrationApplied,
  migrationSqlSnippet,
  includeTestOrders,
  zenoConfigured,
  initialZenoReceiver,
  zenoProofs,
  activePagoMovilAccount,
  matchedPagoMovilByOrder,
  actualItemCostCents,
}: {
  orders: OrderDTO[];
  movements: TreasuryMovementDTO[];
  suppliers: SupplierPortfolioRow[];
  position: TreasuryPositionSummary;
  bsRateCents?: number | null;
  bsRatePolicy?: BsRateAutoSyncPolicy | null;
  liveRates?: LiveVenezuelaRatesSnapshot | null;
  snapshots: CapitalSnapshotRecord[];
  sqlMigrationApplied: boolean;
  migrationSqlSnippet: string;
  includeTestOrders: boolean;
  zenoConfigured: boolean;
  initialZenoReceiver: ZenoBinanceReceiverDTO | null;
  zenoProofs: Record<string, ZenoPaymentProofDTO>;
  activePagoMovilAccount: ReceiverBankAccountDTO | null;
  matchedPagoMovilByOrder: Record<string, MatchedPagoMovilSummary>;
  actualItemCostCents: Record<string, number>;
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPreset, setModalPreset] = useState<TreasuryMovementModalPreset | undefined>();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showVoided, setShowVoided] = useState(false);
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [capturing, setCapturing] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [showSqlDrawer, setShowSqlDrawer] = useState(false);

  // Historical test settlement wizard state
  const candidateSettledOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          !o.isTest &&
          (o.status === "DELIVERED" || o.paidCents > 0 || o.status === "PAID")
      ),
    [orders]
  );

  const [selectedTestIds, setSelectedTestIds] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const o of orders) {
      if (
        !o.isTest &&
        (o.status === "DELIVERED" || o.paidCents > 0)
      ) {
        initial[o.id] = true;
      }
    }
    return initial;
  });
  const [seedOpeningBalances, setSeedOpeningBalances] = useState(true);
  const [settlingTests, setSettlingTests] = useState(false);

  const activeMovementsCount = useMemo(
    () => movements.filter((m) => !m.voidedAt).length,
    [movements]
  );

  const filteredMovements = useMemo(
    () =>
      movements.filter((m) => {
        if (!showVoided && m.voidedAt) return false;
        if (typeFilter !== "all" && m.movementType !== typeFilter) return false;
        return true;
      }),
    [movements, showVoided, typeFilter]
  );

  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const openModal = (preset?: TreasuryMovementModalPreset) => {
    setModalPreset(preset);
    setModalOpen(true);
  };

  const handleCaptureSnapshot = async () => {
    setCapturing(true);
    try {
      const updated = await captureMonthlyCapitalSnapshotAction(currentMonthKey);
      setSnapshots(updated);
      toast.success(`Cierre mensual guardado (${currentMonthKey})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error guardando cierre");
    } finally {
      setCapturing(false);
    }
  };

  const handleVoidMovement = async (id: string) => {
    const reason = window.prompt(
      "Motivo para anular este asiento contable (ej. Monto duplicado):"
    );
    if (!reason || reason.trim().length < 3) return;
    setVoidingId(id);
    try {
      await voidTreasuryMovementAction({ movementId: id, reason: reason.trim() });
      toast.success("Asiento anulado contablemente");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al anular");
    } finally {
      setVoidingId(null);
    }
  };

  const handleSettleHistoricalTests = async () => {
    const chosenIds = candidateSettledOrders
      .filter((o) => selectedTestIds[o.id])
      .map((o) => o.id);

    if (chosenIds.length === 0 && !seedOpeningBalances) {
      toast.error("Selecciona al menos una orden o activa el saldo de apertura.");
      return;
    }

    const openingSupplierCapitalCents: Record<string, number> = {};
    if (seedOpeningBalances) {
      for (const s of suppliers) {
        if (
          (s.enabled || s.configured) &&
          typeof s.balanceCents === "number" &&
          s.balanceCents > 0
        ) {
          openingSupplierCapitalCents[s.id] = s.balanceCents;
        }
      }
    }

    setSettlingTests(true);
    try {
      const res = await settleHistoricalTestsAction({
        orderIds: chosenIds,
        openingSupplierCapitalCents,
      });
      toast.success(
        `Cuadre aplicado: ${res.flaggedOrdersCount} orden(es) marcadas como prueba y ${res.createdMovementsCount} asiento(s) iniciales creados.`
      );
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al cuadrar pruebas históricas"
      );
    } finally {
      setSettlingTests(false);
    }
  };

  const discrepancyAbs = Math.abs(position.suppliersDiscrepancyUsdCents);
  const isBalanced = discrepancyAbs <= 5; // 5 cents tolerance for API sub-cent rounding ($2.9297 vs $2.93)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-400">
            Finanzas y Caja Real
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
            Tesorería, Reinversiones y Cuadre
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Control exacto de entradas por ventas, fondeos a distribuidores, cambios P2P Bs→USDT y retiros de ganancia.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() =>
              openModal({
                movementType: "SUPPLIER_TOPUP",
                sourceAccount: "zenobank",
                targetAccount: "fazercards",
              })
            }
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs shadow-[0_6px_22px_rgba(99,102,241,0.3)] transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Registrar Movimiento</span>
          </button>

          <button
            type="button"
            onClick={() =>
              openModal({
                movementType: "PROFIT_WITHDRAWAL",
                sourceAccount: "zenobank",
                targetAccount: "partner_payout",
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-emerald-200 font-bold text-xs transition-colors"
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Retirar Ganancia</span>
          </button>

          <button
            type="button"
            onClick={() =>
              openModal({
                movementType: "INTERNAL_TRANSFER",
                sourceAccount: "pagomovil",
                targetAccount: "zenobank",
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-slate-200 font-semibold text-xs transition-colors"
          >
            <ArrowRightLeft className="w-3.5 h-3.5 text-sky-400" />
            <span>Cambio Bs → USDT</span>
          </button>
        </div>
      </div>

      {/* Compatibility banner if SQL 0006 isn't applied yet */}
      {!sqlMigrationApplied && (
        <div className="rounded-2xl bg-sky-500/[0.08] border border-sky-400/25 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 text-xs">
            <div className="font-bold text-sky-200">
              Modo compatible activo en dev (sin haber ejecutado aún la migración SQL 0006)
            </div>
            <p className="text-slate-300">
              Los movimientos y marcas de prueba ya se guardan en <code>store_settings</code> para que pruebes todo en local. Cuando vayas a producción, pega <code>0006_treasury_and_test_orders.sql</code> en el SQL Editor de Supabase.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSqlDrawer((v) => !v)}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white"
            >
              {showSqlDrawer ? "Ocultar SQL" : "Ver SQL 0006"}
            </button>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(migrationSqlSnippet);
                toast.success("SQL 0006 copiado al portapapeles");
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold text-xs"
            >
              <ClipboardCopy className="w-3.5 h-3.5" />
              <span>Copiar SQL</span>
            </button>
          </div>
          {showSqlDrawer && (
            <pre className="w-full max-h-60 overflow-auto rounded-xl bg-slate-950 border border-white/10 p-3 text-[11px] font-mono text-slate-300">
              {migrationSqlSnippet}
            </pre>
          )}
        </div>
      )}

      {/* Accounting Equation Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            1. En Receptoras Hoy
          </div>
          <div className="text-2xl font-black font-mono text-white">
            {formatCents(position.totalReceiversUsdCents)}
          </div>
          <div className="text-[11px] text-slate-400">
            Binance {formatCents(position.zenobankBalanceUsdCents)} · Pago Móvil{" "}
            {formatCents(position.pagomovilBalanceUsdCents)}
          </div>
        </div>

        <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            2. En Distribuidores
          </div>
          <div className="text-2xl font-black font-mono text-sky-300">
            {formatCents(position.totalSuppliersUsdCents)}
          </div>
          <div className="text-[11px] text-slate-400">
            Cupo vivo listo en APIs + CSV
          </div>
        </div>

        <div className="rounded-2xl bg-[#0d101b] border border-indigo-400/25 p-5 space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">
            Patrimonio Dentro (1+2)
          </div>
          <div className="text-2xl font-black font-mono text-white">
            {formatCents(position.totalBusinessEquityUsdCents)}
          </div>
          <div className="text-[11px] text-slate-400">
            Capital Aportado Neto:{" "}
            <strong className="text-slate-200">
              {formatCents(position.netContributedCapitalUsdCents)}
            </strong>
          </div>
        </div>

        <div className="rounded-2xl bg-[#0d101b] border border-emerald-400/25 p-5 space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
            Ganancia Neta Real
          </div>
          <div
            className={`text-2xl font-black font-mono ${
              position.netBusinessProfitUsdCents >= 0
                ? "text-emerald-400"
                : "text-rose-400"
            }`}
          >
            {position.netBusinessProfitUsdCents >= 0 ? "+" : ""}
            {formatCents(position.netBusinessProfitUsdCents)}
          </div>
          <div className="text-[11px] text-slate-400 leading-relaxed">
            Retirada {formatCents(position.withdrawnProfitUsdCents)}
            {position.expensesUsdCents > 0
              ? ` · Fees/Gastos -${formatCents(position.expensesUsdCents)}`
              : ""}
            <div className="text-[11px]">
              <span className="text-emerald-300 font-semibold">
                En caja {formatCents(position.liquidProfitInReceiversUsdCents)}
              </span>
              {" · "}
              <span className="text-sky-300 font-semibold">
                Reinvertida en APIs{" "}
                {formatCents(position.reinvestedProfitInSuppliersUsdCents)}
              </span>
            </div>
          </div>
        </div>

        <div
          className={`rounded-2xl p-5 space-y-1 border ${
            isBalanced
              ? "bg-emerald-500/[0.06] border-emerald-400/25"
              : "bg-amber-500/[0.08] border-amber-400/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
              Estado de Cuadre
            </span>
            {isBalanced ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <Scale className="w-4 h-4 text-amber-400" />
            )}
          </div>
          <div
            className={`text-xl font-black font-mono ${
              isBalanced ? "text-emerald-300" : "text-amber-300"
            }`}
          >
            {isBalanced
              ? "Caja Cuadrada"
              : `${position.suppliersDiscrepancyUsdCents >= 0 ? "+" : ""}${formatCents(
                  position.suppliersDiscrepancyUsdCents
                )}`}
          </div>
          <div className="text-[11px] text-slate-400">
            {isBalanced
              ? "Saldos API coinciden con tu libro contable."
              : position.suppliersDiscrepancyUsdCents > 0
                ? "Hay más saldo en APIs que fondeos registrados (¿aporte inicial o recarga sin anotar?)."
                : "Falta descontar consumo o pruebas del saldo en APIs."}
          </div>
        </div>
      </div>

      {/* Guided Reconciliation for Initial Test Orders */}
      {(candidateSettledOrders.length > 0 || activeMovementsCount === 0) && (
        <div className="rounded-2xl bg-[#111524] border border-amber-400/25 p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
                <FlaskConical className="w-4 h-4" />
                <span>Asistente de Cuadre de Pruebas Históricas</span>
              </div>
              <h2 className="text-base font-bold text-white">
                {candidateSettledOrders.length > 0
                  ? `Detectadas ${candidateSettledOrders.length} orden(es) entregada(s)/pagada(s) aún contadas como operación real`
                  : "Registra los saldos vivos actuales en tus APIs como capital inicial"}
              </h2>
              <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
                Marca abajo las órdenes que fueron de prueba inicial (por ejemplo los pedidos con tu socio Antonio o las pruebas de Central One) para excluirlas de ventas reales y registrar automáticamente tu saldo vivo actual en APIs como capital de arranque.
              </p>
            </div>

            <button
              type="button"
              disabled={settlingTests}
              onClick={() => void handleSettleHistoricalTests()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs disabled:opacity-50 shrink-0"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {settlingTests ? "Aplicando cuadre..." : "Aplicar Cuadre Inicial"}
              </span>
            </button>
          </div>

          {candidateSettledOrders.length > 0 && (
            <div className="divide-y divide-white/[0.06] rounded-xl bg-slate-950/70 border border-white/[0.07] max-h-56 overflow-y-auto text-xs">
              {candidateSettledOrders.map((ord) => {
                const checked = Boolean(selectedTestIds[ord.id]);
                const summary = ord.items
                  .map((i) => `${i.productName} ${i.denominationLabel}`)
                  .join(", ");
                return (
                  <label
                    key={ord.id}
                    className="flex items-center justify-between gap-4 px-4 py-2.5 cursor-pointer hover:bg-white/[0.03]"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelectedTestIds((prev) => ({
                            ...prev,
                            [ord.id]: e.target.checked,
                          }))
                        }
                        className="rounded border-white/25 bg-slate-900"
                      />
                      <span className="font-mono font-bold text-white shrink-0">
                        {ord.orderNumber}
                      </span>
                      <span className="text-slate-300 truncate">{summary}</span>
                      <span className="text-slate-500 hidden sm:inline truncate">
                        ({ord.email})
                      </span>
                    </span>
                    <span className="font-mono font-semibold text-amber-200 shrink-0">
                      {formatCents(ord.subtotalCents)} ·{" "}
                      {ord.paymentGateway.toUpperCase()}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {activeMovementsCount === 0 && (
            <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={seedOpeningBalances}
                onChange={(e) => setSeedOpeningBalances(e.target.checked)}
                className="mt-0.5 rounded border-white/25 bg-slate-900"
              />
              <span>
                Registrar también como <strong>Capital Inicial (`CAPITAL_IN`)</strong> el saldo vivo actual que tienen hoy tus proveedores (
                {suppliers
                  .filter(
                    (s) =>
                      (s.enabled || s.configured) &&
                      typeof s.balanceCents === "number" &&
                      s.balanceCents > 0
                  )
                  .map(
                    (s) =>
                      `${s.label}: ${formatExactUsd(s.balanceCents, s.exactBalanceUsd)}`
                  )
                  .join(" · ") || "sin saldo vivo"}
                ), para que tu caja arranque 100% cuadrada en <strong>\$0.00</strong> de ganancia neta y <strong>\$0.00</strong> en receptoras.
              </span>
            </label>
          )}
        </div>
      )}

      {/* Receivers (ZenoBank / Binance & Pago Movil Config + Ledgers) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Landmark className="w-4 h-4 text-sky-400" />
            <span>Saldos en Cuentas Receptoras y Auditoría de Ingresos</span>
          </h2>
          {includeTestOrders && (
            <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-400/30 text-[11px] font-semibold text-amber-200">
              Incluyendo órdenes de prueba según selector superior
            </span>
          )}
        </div>

        {/* Net Live Balance Cards per Receiver */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-[#0d101b] border border-amber-400/20 p-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-amber-300">
                Saldo Neto Disponible en ZenoBank / Binance Pay
              </div>
              <div className="text-2xl font-black font-mono text-white mt-1">
                {formatCents(position.zenobankBalanceUsdCents)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Cobros {formatCents(position.zenobankSalesGrossUsdCents)} menos recargas API, retiros y ajustes
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                openModal({
                  movementType: "SUPPLIER_TOPUP",
                  sourceAccount: "zenobank",
                  targetAccount: "fazercards",
                })
              }
              className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-semibold text-white shrink-0"
            >
              Reinvertir desde aquí →
            </button>
          </div>

          <div className="rounded-2xl bg-[#0d101b] border border-sky-400/20 p-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-sky-300">
                Saldo Neto Disponible en{" "}
                {activePagoMovilAccount?.bankName
                  ? `${activePagoMovilAccount.bankName} / Pago Móvil`
                  : "Pago Móvil (Bs)"}
              </div>
              <div className="text-2xl font-black font-mono text-white mt-1">
                {formatBsCents(position.pagomovilBalanceBsCents)}{" "}
                <span className="text-sm font-semibold text-slate-400">
                  ({formatCents(position.pagomovilBalanceUsdCents)})
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Cobros {formatCents(position.pagomovilSalesGrossUsdCents)} menos cambios Bs→USDT y retiros
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                openModal({
                  movementType: "INTERNAL_TRANSFER",
                  sourceAccount: "pagomovil",
                  targetAccount: "zenobank",
                })
              }
              className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-semibold text-white shrink-0"
            >
              Cambiar Bs → USDT →
            </button>
          </div>
        </div>

        <BsExchangeDeskCard
          bsRateCents={bsRateCents}
          initialPolicy={bsRatePolicy}
          initialLiveRates={liveRates}
          position={position}
          onOpenSwapModal={() =>
            openModal({
              movementType: "INTERNAL_TRANSFER",
              sourceAccount: "pagomovil",
              targetAccount: "zenobank",
            })
          }
        />

        <ReceiverLedgersSection
          allOrders={
            includeTestOrders ? orders : orders.filter((o) => !o.isTest)
          }
          filteredOrders={
            includeTestOrders ? orders : orders.filter((o) => !o.isTest)
          }
          zenoConfigured={zenoConfigured}
          initialZenoReceiver={initialZenoReceiver}
          zenoProofs={zenoProofs}
          activePagoMovilAccount={activePagoMovilAccount}
          matchedPagoMovilByOrder={matchedPagoMovilByOrder}
          actualItemCostCents={actualItemCostCents}
        />
      </div>

      {/* Treasury Ledger Table */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-indigo-400" />
              <span>Libro de Movimientos de Caja ({filteredMovements.length})</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Registro histórico de aportes, reinversiones a APIs, retiros a socios, cambios Bs→USDT y ajustes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-xl bg-slate-950 border border-white/10 px-3 py-1.5 text-xs text-slate-200"
            >
              <option value="all">Todos los tipos</option>
              {(Object.keys(MOVEMENT_BADGES) as TreasuryMovementType[]).map((k) => (
                <option key={k} value={k}>
                  {MOVEMENT_BADGES[k].label}
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer px-2">
              <input
                type="checkbox"
                checked={showVoided}
                onChange={(e) => setShowVoided(e.target.checked)}
                className="rounded border-white/25 bg-slate-900"
              />
              <span>Ver anulados</span>
            </label>
          </div>
        </div>

        {filteredMovements.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-xs text-slate-400">
              Aún no hay movimientos registrados con este filtro.
            </p>
            <button
              type="button"
              onClick={() => openModal({ movementType: "CAPITAL_IN" })}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-500/15 border border-indigo-400/30 text-xs font-bold text-indigo-200 hover:bg-indigo-500/25"
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>Registrar primer movimiento</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.02] text-slate-400 border-b border-white/[0.06] text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Fecha</th>
                  <th className="px-5 py-3">Tipo</th>
                  <th className="px-5 py-3">Origen → Destino</th>
                  <th className="px-5 py-3">Nota / Socio / Ref</th>
                  <th className="px-5 py-3 text-right">Monto USD</th>
                  <th className="px-5 py-3 text-right">Bs / Tasa</th>
                  <th className="px-5 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filteredMovements.map((mov) => {
                  const badge = MOVEMENT_BADGES[mov.movementType];
                  const voided = Boolean(mov.voidedAt);
                  return (
                    <tr
                      key={mov.id}
                      className={voided ? "opacity-45 bg-rose-950/10" : "hover:bg-white/[0.02]"}
                    >
                      <td className="px-5 py-3.5 text-slate-400 whitespace-nowrap">
                        {new Date(mov.occurredAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-medium text-white whitespace-nowrap">
                        {labelAccount(mov.sourceAccount)}{" "}
                        <span className="text-slate-500 mx-1">→</span>{" "}
                        {labelAccount(mov.targetAccount)}
                      </td>
                      <td className="px-5 py-3.5 max-w-md">
                        <div className="text-slate-200 truncate">
                          {mov.notes || "—"}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {mov.partnerName ? `Socio: ${mov.partnerName} · ` : ""}
                          {mov.reference ? `Ref: ${mov.reference}` : ""}
                          {voided ? ` · ANULADO: ${mov.voidReason ?? ""}` : ""}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono font-bold text-white whitespace-nowrap">
                        {formatCents(mov.amountUsdCents)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-sky-300 whitespace-nowrap">
                        {mov.amountBsCents
                          ? formatBsCents(mov.amountBsCents)
                          : "—"}
                        {mov.exchangeRateCents && (
                          <div className="text-[10px] text-slate-500">
                            {(mov.exchangeRateCents / 100).toFixed(2)} Bs/$
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        {!voided && (
                          <button
                            type="button"
                            disabled={voidingId === mov.id}
                            onClick={() => void handleVoidMovement(mov.id)}
                            title="Anular este asiento"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 text-[11px] font-semibold transition-colors"
                          >
                            <Ban className="w-3 h-3" />
                            <span>Anular</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Monthly Capital Snapshots */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white">
              Cierres Mensuales de Capital en Proveedores
            </h2>
            <p className="text-[11px] text-slate-400">
              Guarda una fotografía histórica al cierre de cada mes para comparar crecimiento intermensual.
            </p>
          </div>
          <button
            type="button"
            disabled={capturing}
            onClick={() => void handleCaptureSnapshot()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Camera className="w-3.5 h-3.5 text-sky-400" />
            <span>
              {capturing ? "Guardando..." : `Capturar foto (${currentMonthKey})`}
            </span>
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div className="text-xs text-slate-500 py-2">
            Todavía no hay cierres mensuales registrados.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {snapshots.map((snap) => (
              <div
                key={snap.month}
                className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3.5 text-xs space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-slate-200">
                    {snap.month}
                  </span>
                  <span className="font-mono font-black text-emerald-400">
                    {formatCents(snap.totalCents)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">
                  Fazer {formatCents(snap.byProvider?.fazercards ?? 0)} · C1{" "}
                  {formatCents(snap.byProvider?.centralone ?? 0)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isBalanced && (
        <div className="flex items-center gap-2 text-[11px] text-amber-300/90 px-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            Nota de auditoría: El estado de cuadre compara los saldos vivos de APIs ({formatCents(position.totalSuppliersUsdCents)}) contra el cupo teórico ({formatCents(position.theoreticalSuppliersUsdCents)} = fondeado - ventas - egresos).
          </span>
        </div>
      )}

      <TreasuryMovementModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        suppliers={suppliers}
        preset={modalPreset}
        activePagoMovilBankName={activePagoMovilAccount?.bankName ?? null}
        receiverBalances={{
          zenobankUsdCents: position.zenobankBalanceUsdCents,
          pagomovilUsdCents: position.pagomovilBalanceUsdCents,
          pagomovilBsCents: position.pagomovilBalanceBsCents,
          weightedBookBsRateCents: position.weightedBookBsRateCents,
          liveP2pRateCents:
            liveRates?.binanceP2pCents ?? position.replacementUsdtRateCents,
        }}
      />
    </div>
  );
}
