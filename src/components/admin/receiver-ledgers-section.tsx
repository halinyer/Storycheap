"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { saveZenoBinanceReceiverAction } from "@/app/admin/actions";
import { formatCents } from "@/lib/catalog-seed";
import type {
  ZenoBinanceReceiverDTO,
  ZenoPaymentProofDTO,
} from "@/lib/server/repository";
import { formatBsCents, getOrderSnapshot } from "@/lib/server/sales-metrics";
import type { OrderDTO, ReceiverBankAccountDTO } from "@/types";
import {
  ArrowUpRight,
  Bitcoin,
  CheckCircle2,
  Pencil,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";

export interface MatchedPagoMovilSummary {
  referenceFull: string | null;
  amountBsCents: number | null;
  senderPhone: string | null;
  senderBankCode: string | null;
  postedAt: string;
}

export function ReceiverLedgersSection({
  allOrders,
  filteredOrders,
  zenoConfigured,
  initialZenoReceiver,
  zenoProofs = {},
  activePagoMovilAccount,
  matchedPagoMovilByOrder = {},
}: {
  allOrders: OrderDTO[];
  filteredOrders: OrderDTO[];
  zenoConfigured: boolean;
  initialZenoReceiver: ZenoBinanceReceiverDTO | null;
  zenoProofs?: Record<string, ZenoPaymentProofDTO>;
  activePagoMovilAccount: ReceiverBankAccountDTO | null;
  matchedPagoMovilByOrder?: Record<string, MatchedPagoMovilSummary>;
}) {
  const [zenoReceiver, setZenoReceiver] = useState<ZenoBinanceReceiverDTO | null>(
    initialZenoReceiver
  );
  const [editingZeno, setEditingZeno] = useState(false);
  const [savingZeno, setSavingZeno] = useState(false);
  const [label, setLabel] = useState(
    initialZenoReceiver?.label ?? "Binance Principal (ZenoBank)"
  );
  const [binanceAccount, setBinanceAccount] = useState(
    initialZenoReceiver?.binanceAccount ?? ""
  );
  const [network, setNetwork] = useState(
    initialZenoReceiver?.network ?? "USDT (Binance Pay / BEP20 / TRC20)"
  );
  const [storeReference, setStoreReference] = useState(
    initialZenoReceiver?.storeReference ?? ""
  );
  const [notes, setNotes] = useState(initialZenoReceiver?.notes ?? "");

  const zenoLedger = useMemo(() => {
    const summarize = (list: OrderDTO[]) => {
      let paidUsdCents = 0;
      let paidCount = 0;
      let openUsdCents = 0;
      let openCount = 0;
      const settledOrders: OrderDTO[] = [];

      for (const order of list) {
        if (order.paymentGateway !== "zenobank") continue;
        const snap = getOrderSnapshot(order);
        if (order.status === "PENDING_PAYMENT" || order.status === "CREATED") {
          openCount += 1;
          openUsdCents += order.amountDueCents;
          continue;
        }
        if (!snap.isSettledSale) continue;
        const cashPaid =
          order.paidCents > 0
            ? order.paidCents
            : Math.max(0, snap.revenueCents - order.creditAppliedCents);
        if (cashPaid <= 0) continue;
        paidCount += 1;
        paidUsdCents += cashPaid;
        settledOrders.push(order);
      }

      return { paidUsdCents, paidCount, openUsdCents, openCount, settledOrders };
    };

    return {
      period: summarize(filteredOrders),
      allTime: summarize(allOrders),
    };
  }, [allOrders, filteredOrders]);

  const pmLedger = useMemo(() => {
    const summarize = (list: OrderDTO[]) => {
      let paidUsdCents = 0;
      let paidBsCents = 0;
      let paidCount = 0;
      let openUsdCents = 0;
      let openCount = 0;
      const settledOrders: OrderDTO[] = [];

      for (const order of list) {
        if (
          order.paymentGateway !== "pagomovil" &&
          order.paymentGateway !== "pablito"
        ) {
          continue;
        }
        const snap = getOrderSnapshot(order);
        if (
          order.status === "PENDING_PAYMENT" ||
          order.status === "CREATED" ||
          order.status === "MANUAL_REVIEW"
        ) {
          openCount += 1;
          openUsdCents += order.amountDueCents;
          continue;
        }
        if (!snap.isSettledSale) continue;
        const cashPaid =
          order.paidCents > 0
            ? order.paidCents
            : Math.max(0, snap.revenueCents - order.creditAppliedCents);
        if (cashPaid <= 0) continue;
        paidCount += 1;
        paidUsdCents += cashPaid;
        const matched = matchedPagoMovilByOrder[order.id];
        const bsCents = matched?.amountBsCents ?? snap.totalBsCents ?? 0;
        paidBsCents += bsCents;
        settledOrders.push(order);
      }

      return {
        paidUsdCents,
        paidBsCents,
        paidCount,
        openUsdCents,
        openCount,
        settledOrders,
      };
    };

    return {
      period: summarize(filteredOrders),
      allTime: summarize(allOrders),
    };
  }, [allOrders, filteredOrders, matchedPagoMovilByOrder]);

  const handleSaveZenoReceiver = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingZeno(true);
    try {
      const saved = await saveZenoBinanceReceiverAction({
        label,
        binanceAccount,
        network,
        storeReference,
        notes,
      });
      setZenoReceiver(saved);
      setEditingZeno(false);
      toast.success("Cuenta receptora Binance / ZenoBank guardada.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo guardar la cuenta Binance."
      );
    } finally {
      setSavingZeno(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Cuentas Receptoras — Binance (USDT) vs Pago Móvil (Bs)
          </h2>
          <p className="text-xs text-slate-400">
            Control exacto de qué cuenta recibió cada cobro validado y entregado, sin mezclar pasarelas.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* TARJETA 1: BINANCE / ZENOBANK RECEPTORA */}
        <div className="rounded-2xl bg-slate-900/75 border border-amber-500/20 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0 mt-0.5">
                <Bitcoin className="w-4 h-4 text-amber-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-white">
                    {zenoReceiver?.label || "Receptora Binance / ZenoBank"}
                  </h3>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      zenoConfigured
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {zenoConfigured ? "ZenoBank Live" : "Modo Sandbox"}
                  </span>
                </div>
                {zenoReceiver?.binanceAccount ? (
                  <p className="text-xs text-amber-200 font-semibold mt-0.5 break-all">
                    Cuenta Binance: {zenoReceiver.binanceAccount}
                  </p>
                ) : (
                  <p className="text-xs text-amber-300/90 mt-0.5">
                    Sin cuenta Binance registrada aquí todavía — pulsa Editar para anotar tu correo/UID/Pay ID conectado en ZenoBank.
                  </p>
                )}
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Red: {zenoReceiver?.network || "USDT"}
                  {zenoReceiver?.storeReference ? ` · Ref: ${zenoReceiver.storeReference}` : ""}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setEditingZeno((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-[11px] font-semibold text-slate-200 hover:text-white hover:bg-white/[0.06] shrink-0"
            >
              <Pencil className="w-3 h-3" />
              <span>{editingZeno ? "Cerrar" : zenoReceiver ? "Editar" : "Registrar cuenta"}</span>
            </button>
          </div>

          {editingZeno && (
            <form
              onSubmit={handleSaveZenoReceiver}
              className="rounded-xl bg-slate-950/90 border border-amber-500/25 p-4 space-y-3 text-xs"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Nombre identificador
                  </label>
                  <input
                    type="text"
                    required
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Binance Principal (ZenoBank)"
                    className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Correo / Binance Pay ID / UID / Wallet
                  </label>
                  <input
                    type="text"
                    required
                    value={binanceAccount}
                    onChange={(e) => setBinanceAccount(e.target.value)}
                    placeholder="ej. pagos@correo.com · UID 123456789"
                    className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Red / Activo esperado
                  </label>
                  <input
                    type="text"
                    value={network}
                    onChange={(e) => setNetwork(e.target.value)}
                    placeholder="USDT (Binance Pay / BEP20 / TRC20)"
                    className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Store ID / Etiqueta en ZenoBank (opcional)
                  </label>
                  <input
                    type="text"
                    value={storeReference}
                    onChange={(e) => setStoreReference(e.target.value)}
                    placeholder="ej. Store StoryCheap"
                    className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Nota operativa (opcional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej. Liquidación directa a Binance cuenta personal"
                  className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  ZenoBank API no expone saldo vivo de Binance; aquí se auditan tus cobros validados.
                </span>
                <button
                  type="submit"
                  disabled={savingZeno}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-bold text-xs hover:bg-amber-300 disabled:opacity-50"
                >
                  {savingZeno ? "Guardando..." : "Guardar cuenta"}
                </button>
              </div>
            </form>
          )}

          {/* Totales Binance / ZenoBank */}
          <div className="grid grid-cols-3 gap-2.5 text-xs">
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">Periodo actual</div>
              <div className="text-base font-bold text-white mt-0.5">
                {formatCents(zenoLedger.period.paidUsdCents)}
              </div>
              <div className="text-[11px] text-slate-500">
                {zenoLedger.period.paidCount} cobros
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">Histórico acumulado</div>
              <div className="text-base font-bold text-emerald-400 mt-0.5">
                {formatCents(zenoLedger.allTime.paidUsdCents)}
              </div>
              <div className="text-[11px] text-slate-500">
                {zenoLedger.allTime.paidCount} cobros total
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">Abierto / Esperando</div>
              <div className="text-base font-bold text-amber-300 mt-0.5">
                {formatCents(zenoLedger.period.openUsdCents)}
              </div>
              <div className="text-[11px] text-slate-500">
                {zenoLedger.period.openCount} abierta(s)
              </div>
            </div>
          </div>

          {/* Lista de cobros validados ZenoBank */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-semibold uppercase tracking-wider">
                Últimos cobros validados (Binance / ZenoBank)
              </span>
              <span>{zenoLedger.period.settledOrders.length} en periodo</span>
            </div>

            {zenoLedger.period.settledOrders.length === 0 ? (
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 text-center text-xs text-slate-500">
                Aún no hay cobros validados de ZenoBank / Binance en este periodo.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06] max-h-56 overflow-y-auto pr-1 text-xs rounded-xl bg-white/[0.02] border border-white/[0.06]">
                {zenoLedger.period.settledOrders.slice(0, 20).map((order) => {
                  const proof = zenoProofs[order.id];
                  const tx = proof?.transactions[0] ?? null;
                  const cashPaid =
                    order.paidCents > 0
                      ? order.paidCents
                      : Math.max(0, order.subtotalCents - order.creditAppliedCents);
                  return (
                    <div
                      key={order.id}
                      className="p-3 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="font-mono font-bold text-white hover:text-sky-300"
                          >
                            {order.orderNumber}
                          </Link>
                          <span className="text-slate-400 truncate">{order.email}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {tx
                            ? `Destino: ${tx.toLabel ?? tx.to ?? zenoReceiver?.binanceAccount ?? "Binance (ZenoBank)"}${tx.networkId ? ` · ${tx.networkId}` : ""}${tx.transactionId ? ` · TX ${tx.transactionId.slice(0, 14)}` : ""}`
                            : `Destino: ${zenoReceiver?.binanceAccount || "Cuenta Binance vinculada a ZenoBank"}${order.gatewayCheckoutId ? ` · ${order.gatewayCheckoutId}` : ""}`}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-emerald-400">
                          {formatCents(cashPaid)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* TARJETA 2: BANCAMIGA / PAGO MOVIL RECEPTORA */}
        <div className="rounded-2xl bg-slate-900/75 border border-sky-500/20 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center shrink-0 mt-0.5">
                <Smartphone className="w-4 h-4 text-sky-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-white">
                    {activePagoMovilAccount
                      ? `Receptora ${activePagoMovilAccount.bankName}`
                      : "Receptora Pago Móvil (Bs)"}
                  </h3>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      activePagoMovilAccount
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-rose-500/15 text-rose-300"
                    }`}
                  >
                    {activePagoMovilAccount ? "Activa" : "Sin cuenta"}
                  </span>
                </div>
                {activePagoMovilAccount ? (
                  <>
                    <p className="text-xs text-sky-200 font-semibold mt-0.5">
                      {activePagoMovilAccount.phone} · {activePagoMovilAccount.dni} ·{" "}
                      {activePagoMovilAccount.holderName}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Código banco: {activePagoMovilAccount.bankCode} · Tipo:{" "}
                      {activePagoMovilAccount.accountType === "juridical"
                        ? "Jurídica"
                        : "Natural"}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-amber-300 mt-0.5">
                    Configura tu cuenta receptora en el módulo Pago Móvil.
                  </p>
                )}
              </div>
            </div>

            <Link
              href="/admin/pagomovil"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-[11px] font-semibold text-slate-200 hover:text-white hover:bg-white/[0.06] shrink-0"
            >
              <span>Ver bot y cuenta</span>
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>

          {/* Totales Pago Móvil */}
          <div className="grid grid-cols-3 gap-2.5 text-xs">
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">Periodo actual</div>
              <div className="text-base font-bold text-white mt-0.5">
                {formatCents(pmLedger.period.paidUsdCents)}
              </div>
              <div className="text-[11px] text-sky-300 truncate">
                {formatBsCents(pmLedger.period.paidBsCents)}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">Histórico acumulado</div>
              <div className="text-base font-bold text-emerald-400 mt-0.5">
                {formatCents(pmLedger.allTime.paidUsdCents)}
              </div>
              <div className="text-[11px] text-emerald-300/80 truncate">
                {formatBsCents(pmLedger.allTime.paidBsCents)}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-[11px] text-slate-400">En espera / Revisión</div>
              <div className="text-base font-bold text-amber-300 mt-0.5">
                {formatCents(pmLedger.period.openUsdCents)}
              </div>
              <div className="text-[11px] text-slate-500">
                {pmLedger.period.openCount} pendiente(s)
              </div>
            </div>
          </div>

          {/* Lista de cobros validados Pago Móvil */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-semibold uppercase tracking-wider">
                Últimos cobros validados (Pago Móvil)
              </span>
              <span>{pmLedger.period.settledOrders.length} en periodo</span>
            </div>

            {pmLedger.period.settledOrders.length === 0 ? (
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 text-center text-xs text-slate-500">
                Aún no hay cobros validados de Pago Móvil en este periodo.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06] max-h-56 overflow-y-auto pr-1 text-xs rounded-xl bg-white/[0.02] border border-white/[0.06]">
                {pmLedger.period.settledOrders.slice(0, 20).map((order) => {
                  const matched = matchedPagoMovilByOrder[order.id];
                  const snap = getOrderSnapshot(order);
                  const bsCents = matched?.amountBsCents ?? snap.totalBsCents ?? 0;
                  const cashPaid =
                    order.paidCents > 0
                      ? order.paidCents
                      : Math.max(0, order.subtotalCents - order.creditAppliedCents);
                  return (
                    <div
                      key={order.id}
                      className="p-3 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="font-mono font-bold text-white hover:text-sky-300"
                          >
                            {order.orderNumber}
                          </Link>
                          <span className="text-slate-400 truncate">{order.email}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {matched?.referenceFull
                            ? `Ref #${matched.referenceFull}${matched.senderBankCode ? ` · Banco ${matched.senderBankCode}` : ""}${matched.senderPhone ? ` · ${matched.senderPhone}` : ""}`
                            : "Validado / Aprobado en cuenta receptora"}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-sky-300">
                          {bsCents > 0 ? formatBsCents(bsCents) : formatCents(cashPaid)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {formatCents(cashPaid)} ·{" "}
                          {new Date(order.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
