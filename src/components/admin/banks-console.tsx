"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BsExchangeDeskCard } from "@/components/admin/bs-exchange-desk-card";
import {
  ReceiverLedgersSection,
  type MatchedPagoMovilSummary,
} from "@/components/admin/receiver-ledgers-section";
import {
  TreasuryMovementModal,
  type TreasuryMovementModalPreset,
} from "@/components/admin/treasury-movement-modal";
import type { BinanceWithdrawalItemDTO } from "@/app/api/admin/treasury/binance-withdrawals/route";
import { formatCents } from "@/lib/catalog-seed";
import type {
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
  TreasuryPositionSummary,
} from "@/types";
import {
  ArrowRightLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Landmark,
  Loader2,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";

export function BanksConsole({
  orders,
  suppliers,
  position,
  bsRateCents,
  bsRatePolicy,
  liveRates,
  includeTestOrders,
  zenoConfigured,
  initialZenoReceiver,
  zenoProofs,
  activePagoMovilAccount,
  matchedPagoMovilByOrder,
  actualItemCostCents,
}: {
  orders: OrderDTO[];
  suppliers: SupplierPortfolioRow[];
  position: TreasuryPositionSummary;
  bsRateCents: number | null;
  bsRatePolicy: BsRateAutoSyncPolicy | null;
  liveRates: LiveVenezuelaRatesSnapshot | null;
  includeTestOrders: boolean;
  zenoConfigured: boolean;
  initialZenoReceiver: ZenoBinanceReceiverDTO | null;
  zenoProofs: Record<string, ZenoPaymentProofDTO>;
  activePagoMovilAccount: ReceiverBankAccountDTO | null;
  matchedPagoMovilByOrder: Record<string, MatchedPagoMovilSummary>;
  actualItemCostCents: Record<string, number>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPreset, setModalPreset] = useState<
    TreasuryMovementModalPreset | undefined
  >();
  const [withdrawals, setWithdrawals] = useState<BinanceWithdrawalItemDTO[] | null>(
    null
  );
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [withdrawalsError, setWithdrawalsError] = useState<string | null>(null);

  const openModal = (preset?: TreasuryMovementModalPreset) => {
    setModalPreset(preset);
    setModalOpen(true);
  };

  const fetchBinanceWithdrawals = async () => {
    setLoadingWithdrawals(true);
    setWithdrawalsError(null);
    try {
      const res = await fetch("/api/admin/treasury/binance-withdrawals", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        withdrawals?: BinanceWithdrawalItemDTO[];
        error?: string;
      };
      if (data.error) {
        setWithdrawalsError(data.error);
        setWithdrawals([]);
      } else {
        setWithdrawals(data.withdrawals ?? []);
      }
    } catch {
      setWithdrawalsError("No se pudo conectar con el endpoint de Binance.");
    } finally {
      setLoadingWithdrawals(false);
    }
  };

  const scopedOrders = includeTestOrders
    ? orders
    : orders.filter((o) => !o.isTest);

  return (
    <div className="space-y-6">
      {/* Department Header */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-400">
            Departamento · Finanzas · Bancos y Cuentas Receptoras
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
            Saldos en Bancos y Receptoras
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Control exclusivo de tu dinero en cuentas receptoras (Binance USDT y Banco de Venezuela Bs), tasas Bs/P2P y extractos. Los saldos de distribuidores viven aparte en{" "}
            <Link
              href="/admin/providers"
              className="text-indigo-400 hover:text-indigo-300 font-semibold"
            >
              Distribuidores y APIs
            </Link>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/admin/treasury"
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-200 font-semibold text-xs transition-colors"
          >
            <Landmark className="w-3.5 h-3.5 text-emerald-400" />
            <span>Libro de Tesorería</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>

          <Link
            href="/admin/pagomovil"
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-200 font-semibold text-xs transition-colors"
          >
            <Smartphone className="w-3.5 h-3.5 text-sky-400" />
            <span>Config. BDV</span>
          </Link>
        </div>
      </div>

      {/* Total in Banks Summary */}
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-300 flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </span>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Total Disponible en Bancos / Receptoras
            </div>
            <div className="text-2xl font-black font-mono text-white">
              {formatCents(position.totalReceiversUsdCents)}{" "}
              <span className="text-xs font-semibold text-slate-400">USD</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              openModal({
                movementType: "INTERNAL_TRANSFER",
                sourceAccount: "pagomovil",
                targetAccount: "zenobank",
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-white transition-colors cursor-pointer"
          >
            <ArrowRightLeft className="w-3.5 h-3.5 text-sky-400" />
            <span>Registrar Cambio Bs → USDT</span>
          </button>

          <button
            type="button"
            onClick={() =>
              openModal({
                movementType: "SUPPLIER_TOPUP",
                sourceAccount: "zenobank",
                targetAccount: "fazercards",
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-xs font-bold text-white transition-colors cursor-pointer"
          >
            <span>Enviar a Distribuidor →</span>
          </button>
        </div>
      </div>

      {/* 2 Dedicated Bank / Receiver Cards (Binance & BDV) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Binance / ZenoBank */}
        <div className="rounded-2xl bg-[#0d101b] border border-amber-400/20 p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-amber-300">
                Binance / ZenoBank (USDT)
              </div>
              <div className="text-3xl font-black font-mono text-white mt-1.5">
                {formatCents(position.zenobankBalanceUsdCents)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Cobros en Binance {formatCents(position.zenobankSalesGrossUsdCents)} menos recargas a proveedores, retiros y fees.
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
              className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-semibold text-white shrink-0 cursor-pointer"
            >
              Reinvertir →
            </button>
          </div>

          {/* Binance API Real Withdrawals Sync Helper */}
          <div className="rounded-xl bg-slate-950/75 border border-white/[0.07] p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-white">
                  Retiros reales desde tu Binance API
                </div>
                <div className="text-[11px] text-slate-400">
                  Consulta envíos recientes de USDT (con comisión exacta) para registrarlos en 1 clic.
                </div>
              </div>
              <button
                type="button"
                disabled={loadingWithdrawals}
                onClick={() => void fetchBinanceWithdrawals()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/30 text-amber-200 text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                {loadingWithdrawals ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>
                  {withdrawals === null ? "Consultar retiros" : "Refrescar"}
                </span>
              </button>
            </div>

            {withdrawalsError && (
              <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2">
                {withdrawalsError}
              </div>
            )}

            {withdrawals !== null && withdrawals.length === 0 && !withdrawalsError && (
              <div className="text-[11px] text-slate-400">
                No se encontraron retiros completados recientes en USDT/USDC.
              </div>
            )}

            {withdrawals && withdrawals.length > 0 && (
              <div className="divide-y divide-white/[0.06] max-h-56 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/25">
                {withdrawals.slice(0, 8).map((w) => (
                  <div
                    key={w.id}
                    className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white">
                          ${w.grossAmountUsd.toFixed(2)} {w.coin}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] text-slate-300">
                          {w.network} · fee ${w.feeUsd.toFixed(2)}
                        </span>
                        {w.alreadyRecorded && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" />
                            Registrado
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {w.applyTime}
                        {w.addressMasked ? ` · Destino ${w.addressMasked}` : ""}
                      </div>
                    </div>

                    {!w.alreadyRecorded && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            openModal({
                              movementType: "SUPPLIER_TOPUP",
                              sourceAccount: "zenobank",
                              targetAccount: "fazercards",
                              amountUsd: w.grossAmountUsd.toFixed(2),
                              networkFeeUsd: w.feeUsd.toFixed(2),
                              reference: w.txId ?? w.id,
                              notes: `Retiro Binance ${w.network} (${w.applyTime})`,
                            });
                            toast.info("Monto y comisión cargados desde Binance");
                          }}
                          className="px-2 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/35 border border-indigo-400/30 text-indigo-200 font-bold text-[10px] cursor-pointer"
                        >
                          → FazerCards
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            openModal({
                              movementType: "SUPPLIER_TOPUP",
                              sourceAccount: "zenobank",
                              targetAccount: "centralone",
                              amountUsd: w.grossAmountUsd.toFixed(2),
                              networkFeeUsd: w.feeUsd.toFixed(2),
                              reference: w.txId ?? w.id,
                              notes: `Retiro Binance ${w.network} (${w.applyTime})`,
                            });
                            toast.info("Monto y comisión cargados desde Binance");
                          }}
                          className="px-2 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/35 border border-sky-400/30 text-sky-200 font-bold text-[10px] cursor-pointer"
                        >
                          → Central One
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Banco de Venezuela / Pago Móvil */}
        <div className="rounded-2xl bg-[#0d101b] border border-sky-400/20 p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-sky-300">
                {activePagoMovilAccount?.bankName
                  ? `${activePagoMovilAccount.bankName} (Pago Móvil Bs)`
                  : "Banco de Venezuela · Pago Móvil (Bs)"}
              </div>
              <div className="text-3xl font-black font-mono text-white mt-1.5 tabular-nums">
                {formatBsCents(position.pagomovilBalanceBsCents)}{" "}
                <span className="text-sm font-semibold text-slate-400">
                  ({formatCents(position.pagomovilBalanceUsdCents)})
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
                Cobros brutos {formatBsCents(position.pagomovilSalesGrossBsCents)} (
                {formatCents(position.pagomovilSalesGrossUsdCents)}) · Comisión entrada ({position.pagomovilIncomingFeePct}%):{" "}
                <span className="text-amber-300 font-semibold">
                  -{formatBsCents(position.pagomovilIncomingFeeBsCents)}
                </span>
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
              className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-semibold text-white shrink-0 cursor-pointer"
            >
              Cambiar Bs → USDT →
            </button>
          </div>
        </div>
      </div>

      {/* Bs Exchange Rate & P2P Desk (Lives here in Banks, NEVER on Home!) */}
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

      {/* Receiver Ledgers & Bank Config */}
      <ReceiverLedgersSection
        allOrders={scopedOrders}
        filteredOrders={scopedOrders}
        zenoConfigured={zenoConfigured}
        initialZenoReceiver={initialZenoReceiver}
        zenoProofs={zenoProofs}
        activePagoMovilAccount={activePagoMovilAccount}
        matchedPagoMovilByOrder={matchedPagoMovilByOrder}
        actualItemCostCents={actualItemCostCents}
      />

      <TreasuryMovementModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        suppliers={suppliers}
        preset={modalPreset}
        activePagoMovilBankName={activePagoMovilAccount?.bankName}
        receiverBalances={{
          zenobankUsdCents: position.zenobankBalanceUsdCents,
          pagomovilUsdCents: position.pagomovilBalanceUsdCents,
          pagomovilBsCents: position.pagomovilBalanceBsCents,
          weightedBookBsRateCents: position.weightedBookBsRateCents,
          liveP2pRateCents: liveRates?.replacementUsdtRateCents ?? bsRateCents,
        }}
      />
    </div>
  );
}
