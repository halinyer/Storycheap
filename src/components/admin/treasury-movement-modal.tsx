"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createTreasuryMovementAction } from "@/app/admin/actions";
import { formatCents } from "@/lib/catalog-seed";
import type {
  SupplierPortfolioRow,
  TreasuryMovementDTO,
  TreasuryMovementType,
} from "@/types";
import { AlertCircle, ArrowRightLeft, PlusCircle, X } from "lucide-react";
import { toast } from "sonner";

export interface TreasuryMovementModalPreset {
  movementType?: TreasuryMovementType;
  sourceAccount?: string;
  targetAccount?: string;
  amountUsd?: string;
  networkFeeUsd?: string;
  reference?: string;
  notes?: string;
}

const TYPE_META: Record<
  TreasuryMovementType,
  {
    label: string;
    helper: string;
    defaultSource: string;
    defaultTarget: string;
  }
> = {
  SUPPLIER_TOPUP: {
    label: "Reinvertir / Recargar Distribuidor",
    helper:
      "Mueve saldo de Binance o Pago Móvil hacia un proveedor (ej. FazerCards o Central One). Si pagas comisión de red (ej. $0.01 BSC), regístrala para descontarla de la ganancia neta.",
    defaultSource: "zenobank",
    defaultTarget: "fazercards",
  },
  PROFIT_WITHDRAWAL: {
    label: "Retirar Ganancia / Pago a Socio",
    helper:
      "Registra dinero retirado del negocio hacia tu bolsillo o socios. Reduce el efectivo en tu receptora y marca esa ganancia como ya retirada.",
    defaultSource: "zenobank",
    defaultTarget: "partner_payout",
  },
  CAPITAL_IN: {
    label: "Inyectar Capital Externo (+)",
    helper:
      "Dinero nuevo aportado desde afuera hacia una cuenta receptora o directamente a un distribuidor. Suma a Capital Aportado sin falsificar ventas ni ganancias.",
    defaultSource: "external",
    defaultTarget: "fazercards",
  },
  INTERNAL_TRANSFER: {
    label: "Cambio P2P / Transferencia Interna",
    helper:
      "Convierte Bolívares de Pago Móvil a USDT en Binance (o viceversa) registrando el monto real en Bs salientes y USD recibidos.",
    defaultSource: "pagomovil",
    defaultTarget: "zenobank",
  },
  EXPENSE_FEE: {
    label: "Gasto Operativo / Comisión",
    helper:
      "Comisiones de red, tarifas bancarias o gastos fijos pagados desde una receptora o proveedor. Se descuenta de la utilidad neta.",
    defaultSource: "zenobank",
    defaultTarget: "expense",
  },
  RECONCILIATION_ADJUSTMENT: {
    label: "Ajuste / Devolución de Cuadre",
    helper:
      "Ajuste contable explícito (ej. devolución manual fuera de plataforma o corrección de saldo inicial) para dejar la caja cuadrada.",
    defaultSource: "zenobank",
    defaultTarget: "adjustment",
  },
};

function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export interface TreasuryMovementModalProps {
  open: boolean;
  onClose: () => void;
  suppliers: SupplierPortfolioRow[];
  preset?: TreasuryMovementModalPreset;
  activePagoMovilBankName?: string | null;
  receiverBalances?: {
    zenobankUsdCents: number;
    pagomovilUsdCents: number;
    pagomovilBsCents?: number;
    weightedBookBsRateCents?: number | null;
    liveP2pRateCents?: number | null;
  };
  onCreated?: (movement: TreasuryMovementDTO) => void;
}

export function TreasuryMovementModal(props: TreasuryMovementModalProps) {
  if (!props.open) return null;
  return (
    <TreasuryMovementModalForm
      key={`${props.preset?.movementType ?? "SUPPLIER_TOPUP"}-${props.preset?.sourceAccount ?? ""}-${props.preset?.targetAccount ?? ""}-${props.preset?.reference ?? ""}-${props.preset?.amountUsd ?? ""}`}
      onClose={props.onClose}
      suppliers={props.suppliers}
      preset={props.preset}
      activePagoMovilBankName={props.activePagoMovilBankName}
      receiverBalances={props.receiverBalances}
      onCreated={props.onCreated}
    />
  );
}

function TreasuryMovementModalForm({
  onClose,
  suppliers,
  preset,
  activePagoMovilBankName,
  receiverBalances,
  onCreated,
}: Omit<TreasuryMovementModalProps, "open">) {
  const router = useRouter();
  const pagoMovilLabel = activePagoMovilBankName
    ? `Pago Móvil · ${activePagoMovilBankName} (Bs)`
    : "Pago Móvil (Bs)";
  const initialType = preset?.movementType ?? "SUPPLIER_TOPUP";
  const [movementType, setMovementType] =
    useState<TreasuryMovementType>(initialType);
  const [sourceAccount, setSourceAccount] = useState(
    preset?.sourceAccount ?? TYPE_META[initialType].defaultSource
  );
  const [targetAccount, setTargetAccount] = useState(
    preset?.targetAccount ?? TYPE_META[initialType].defaultTarget
  );
  const [usdInput, setUsdInput] = useState(preset?.amountUsd ?? "");
  const [networkFeeInput, setNetworkFeeInput] = useState(
    preset?.networkFeeUsd ?? ""
  );
  const [bsInput, setBsInput] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [reference, setReference] = useState(preset?.reference ?? "");
  const [notes, setNotes] = useState(preset?.notes ?? "");
  const [adjustDirection, setAdjustDirection] = useState<"out" | "in">("out");
  const [adjustAccount, setAdjustAccount] = useState("zenobank");
  const [saving, setSaving] = useState(false);

  const supplierOptions = useMemo(
    () =>
      suppliers.map((s) => ({
        value: s.id,
        label: s.label,
      })),
    [suppliers]
  );

  const applyTypeDefaults = (nextType: TreasuryMovementType) => {
    setMovementType(nextType);
    setSourceAccount(TYPE_META[nextType].defaultSource);
    setTargetAccount(TYPE_META[nextType].defaultTarget);
    setNetworkFeeInput("");
  };

  const supportsNetworkFee =
    movementType === "SUPPLIER_TOPUP" ||
    movementType === "CAPITAL_IN" ||
    movementType === "PROFIT_WITHDRAWAL";

  const parsedUsdCents = parseMoneyToCents(usdInput);
  const parsedFeeCents = supportsNetworkFee
    ? parseMoneyToCents(networkFeeInput) ?? 0
    : 0;
  const netTargetCents =
    parsedUsdCents !== null ? Math.max(0, parsedUsdCents - parsedFeeCents) : null;
  const parsedBsCents = parseMoneyToCents(bsInput);
  const impliedP2pRate =
    parsedUsdCents && parsedUsdCents > 0 && parsedBsCents && parsedBsCents > 0
      ? ((parsedBsCents / parsedUsdCents) * 100) / 100
      : null;

  const isSwapBsToUsd =
    sourceAccount === "pagomovil" &&
    (movementType === "SUPPLIER_TOPUP" ||
      (movementType === "INTERNAL_TRANSFER" && targetAccount === "zenobank"));
  const showBsInput =
    isSwapBsToUsd ||
    sourceAccount === "pagomovil" ||
    targetAccount === "pagomovil";

  const availableBsCents = receiverBalances?.pagomovilBsCents ?? 0;
  const liveP2pRateCents = receiverBalances?.liveP2pRateCents ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedUsdCents === null || parsedUsdCents <= 0) {
      toast.error("Ingresa un monto en USD válido mayor a 0.");
      return;
    }
    if (parsedFeeCents > 0 && parsedFeeCents >= parsedUsdCents) {
      toast.error("La comisión de red debe ser menor al monto total enviado.");
      return;
    }

    let finalSource = sourceAccount;
    let finalTarget = targetAccount;
    if (movementType === "RECONCILIATION_ADJUSTMENT") {
      if (adjustDirection === "in") {
        finalSource = "adjustment";
        finalTarget = adjustAccount;
      } else {
        finalSource = adjustAccount;
        finalTarget = "adjustment";
      }
    }

    if (finalSource === finalTarget) {
      toast.error("Origen y destino no pueden ser la misma cuenta.");
      return;
    }

    setSaving(true);
    try {
      const created = await createTreasuryMovementAction({
        movementType,
        sourceAccount: finalSource,
        targetAccount: finalTarget,
        amountUsdCents: parsedUsdCents,
        networkFeeUsdCents: parsedFeeCents > 0 ? parsedFeeCents : undefined,
        amountBsCents: parsedBsCents,
        exchangeRateCents: impliedP2pRate ? Math.round(impliedP2pRate * 100) : null,
        partnerName: partnerName.trim() || null,
        reference: reference.trim() || null,
        notes: notes.trim(),
      });
      toast.success(
        parsedFeeCents > 0
          ? `Movimiento registrado (${formatCents(created.amountUsdCents)} + ${formatCents(parsedFeeCents)} fee de red)`
          : `Movimiento registrado (${formatCents(created.amountUsdCents)})`
      );
      onCreated?.(created);
      router.refresh();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo registrar el movimiento"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-3xl bg-[#101421] border border-white/15 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <ArrowRightLeft className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                Registrar Movimiento de Caja
              </h2>
              <p className="text-[11px] text-slate-400">
                Asiento inmutable de tesorería (auditable y reversible con motivo)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Tipo de operación
            </label>
            <select
              value={movementType}
              onChange={(e) =>
                applyTypeDefaults(e.target.value as TreasuryMovementType)
              }
              className="w-full rounded-xl bg-slate-950 border border-white/15 px-3.5 py-2.5 text-xs font-semibold text-white focus:outline-none focus:border-indigo-400"
            >
              {(Object.keys(TYPE_META) as TreasuryMovementType[]).map((k) => (
                <option key={k} value={k}>
                  {TYPE_META[k].label}
                </option>
              ))}
            </select>
            <p className="mt-2 rounded-xl bg-indigo-500/[0.08] border border-indigo-400/20 px-3 py-2 text-[11px] text-indigo-100/90 leading-relaxed">
              {TYPE_META[movementType].helper}
            </p>
          </div>

          {movementType === "RECONCILIATION_ADJUSTMENT" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Dirección del ajuste
                </label>
                <select
                  value={adjustDirection}
                  onChange={(e) =>
                    setAdjustDirection(e.target.value as "out" | "in")
                  }
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
                >
                  <option value="out">Salida / Restar saldo (ej. devolución)</option>
                  <option value="in">Entrada / Sumar saldo</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Cuenta afectada
                </label>
                <select
                  value={adjustAccount}
                  onChange={(e) => setAdjustAccount(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
                >
                  <option value="zenobank">Binance / ZenoBank (USDT)</option>
                  <option value="pagomovil">{pagoMovilLabel}</option>
                  {supplierOptions.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Origen (de dónde sale)
                </label>
                <select
                  value={sourceAccount}
                  onChange={(e) => setSourceAccount(e.target.value)}
                  disabled={movementType === "CAPITAL_IN"}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white disabled:opacity-60"
                >
                  {movementType === "CAPITAL_IN" ? (
                    <option value="external">Capital externo / Bolsillo / Socio</option>
                  ) : (
                    <>
                      <option value="zenobank">Binance / ZenoBank (USDT)</option>
                      <option value="pagomovil">{pagoMovilLabel}</option>
                      {movementType === "SUPPLIER_TOPUP" && (
                        <option value="external">Capital externo directo</option>
                      )}
                      {movementType !== "SUPPLIER_TOPUP" &&
                        supplierOptions.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                    </>
                  )}
                </select>
                {receiverBalances &&
                  (sourceAccount === "zenobank" || sourceAccount === "pagomovil") && (
                    <p className="mt-1 text-[10px] text-slate-400">
                      Disponible en caja:{" "}
                      <strong className="text-slate-200 font-mono">
                        {formatCents(
                          sourceAccount === "zenobank"
                            ? receiverBalances.zenobankUsdCents
                            : receiverBalances.pagomovilUsdCents
                        )}
                      </strong>
                    </p>
                  )}
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Destino (adónde entra)
                </label>
                <select
                  value={targetAccount}
                  onChange={(e) => setTargetAccount(e.target.value)}
                  disabled={
                    movementType === "PROFIT_WITHDRAWAL" ||
                    movementType === "EXPENSE_FEE"
                  }
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white disabled:opacity-60"
                >
                  {movementType === "PROFIT_WITHDRAWAL" ? (
                    <option value="partner_payout">Retiro de utilidades / Socio</option>
                  ) : movementType === "EXPENSE_FEE" ? (
                    <option value="expense">Gasto operativo / Comisión</option>
                  ) : (
                    <>
                      {(movementType === "CAPITAL_IN" ||
                        movementType === "INTERNAL_TRANSFER") && (
                        <>
                          <option value="zenobank">Binance / ZenoBank (USDT)</option>
                          <option value="pagomovil">{pagoMovilLabel}</option>
                        </>
                      )}
                      {movementType !== "INTERNAL_TRANSFER" &&
                        supplierOptions.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                    </>
                  )}
                </select>
              </div>
            </div>
          )}

          <div
            className={`grid grid-cols-1 ${
              showBsInput || supportsNetworkFee ? "sm:grid-cols-2" : ""
            } gap-3`}
          >
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                {isSwapBsToUsd
                  ? "USDT reales recibidos (USD)"
                  : supportsNetworkFee
                    ? "Monto enviado / debitado (USD)"
                    : "Monto (USD)"}
              </label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Ej. 154.53"
                value={usdInput}
                onChange={(e) => setUsdInput(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3.5 py-2 text-sm font-mono font-bold text-white focus:outline-none focus:border-indigo-400"
              />
            </div>

            {supportsNetworkFee && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-1">
                  Comisión de red / Fee (USD, opcional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Ej. 0.01 (BSC)"
                  value={networkFeeInput}
                  onChange={(e) => setNetworkFeeInput(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-amber-400/25 px-3.5 py-2 text-sm font-mono font-bold text-amber-200 focus:outline-none focus:border-amber-400"
                />
              </div>
            )}

            {showBsInput && (
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {isSwapBsToUsd
                      ? "Bolívares salientes del banco (Bs)"
                      : "Monto equivalente en Bolívares (opcional)"}
                  </label>
                  {isSwapBsToUsd && availableBsCents > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const bsVal = (availableBsCents / 100).toFixed(2);
                        setBsInput(bsVal);
                        if (liveP2pRateCents && liveP2pRateCents > 0 && !usdInput) {
                          const estUsd = (
                            availableBsCents / liveP2pRateCents
                          ).toFixed(2);
                          setUsdInput(estUsd);
                        }
                      }}
                      className="text-[10px] font-bold text-sky-300 hover:text-sky-200 underline"
                    >
                      Usar todo (Bs {(availableBsCents / 100).toFixed(2)})
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Ej. 5435.00"
                  value={bsInput}
                  onChange={(e) => setBsInput(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3.5 py-2 text-sm font-mono tabular-nums font-bold text-sky-300 focus:outline-none focus:border-sky-400"
                />
              </div>
            )}
          </div>

          {supportsNetworkFee && parsedUsdCents !== null && parsedUsdCents > 0 && (
            <div className="rounded-xl bg-amber-500/[0.07] border border-amber-400/25 px-3.5 py-2.5 text-[11px] space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-slate-200">
                <span>
                  Sale de origen:{" "}
                  <strong className="font-mono text-white">
                    {formatCents(parsedUsdCents)}
                  </strong>
                </span>
                <span>
                  Comisión (-Ganancia Neta):{" "}
                  <strong className="font-mono text-amber-300">
                    -{formatCents(parsedFeeCents)}
                  </strong>
                </span>
                <span>
                  Acredita neto en destino:{" "}
                  <strong className="font-mono text-emerald-300">
                    {formatCents(netTargetCents ?? parsedUsdCents)}
                  </strong>
                </span>
              </div>
              {movementType === "SUPPLIER_TOPUP" && (
                <div className="flex items-start gap-1.5 text-amber-200/85 pt-0.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Recuerda: si el distribuidor te exige factura exacta en red BSC/TRC20, envía{" "}
                    <strong>monto deseado + fee</strong> en Binance para que no llegue {parsedFeeCents > 0 ? formatCents(parsedFeeCents) : "$0.01"} corto.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Socio / Responsable (opcional)
              </label>
              <input
                type="text"
                placeholder="Ej. Halinyer, Antonio..."
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Referencia / TxID (opcional)
              </label>
              <input
                type="text"
                placeholder="Hash Binance, ref Bancamiga..."
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Nota contable
            </label>
            <input
              type="text"
              placeholder="Ej. Reinversión lote Netflix US o retiro utilidad semanal"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-semibold text-slate-300"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold shadow-[0_6px_24px_rgba(99,102,241,0.3)] disabled:opacity-50"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>{saving ? "Guardando..." : "Registrar en Libro de Caja"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
