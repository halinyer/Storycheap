"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  Building2,
  Calculator,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  Loader2,
  Power,
  RefreshCw,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  manualConfirmPagoMovilAction,
  savePagoMovilSettingsAction,
  saveReceiverBankAccountAction,
  testBdvConciliacionAction,
  toggleProviderConfigAction,
} from "@/app/admin/actions";
import { BsExchangeDeskCard } from "@/components/admin/bs-exchange-desk-card";
import {
  computeBdvFeeBreakdown,
  computeGrossUpForTargetBs,
  type BdvFeePassThroughMode,
} from "@/lib/bdv-fees";
import { BANK_BY_CODE, VENEZUELAN_BANKS } from "@/lib/catalog-banks";
import { formatCents } from "@/lib/catalog-seed";
import type {
  BankPaymentNotificationDTO,
  BsRateAutoSyncPolicy,
  LiveVenezuelaRatesSnapshot,
  OrderDTO,
  PagoMovilSettingsDTO,
  ReceiverBankAccountDTO,
  TreasuryPositionSummary,
} from "@/types";

interface PagoMovilBdvConsoleProps {
  providerEnabled: boolean;
  bdvApiConfigured: boolean;
  bdvEndpoint: string;
  todayDateVe: string;
  bsRateCents: number | null;
  initialBsRatePolicy?: BsRateAutoSyncPolicy;
  initialLiveRates?: LiveVenezuelaRatesSnapshot | null;
  position: TreasuryPositionSummary;
  settings: PagoMovilSettingsDTO;
  receiverAccounts: ReceiverBankAccountDTO[];
  notifications: BankPaymentNotificationDTO[];
  pendingOrders: OrderDTO[];
}

type ConsoleTab = "ledger" | "setup" | "tester";

function formatBs(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return "—";
  }
  return `Bs. ${(cents / 100).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "Nunca";
  try {
    return new Date(iso).toLocaleString("es-VE", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function PagoMovilBdvConsole(props: PagoMovilBdvConsoleProps) {
  const router = useRouter();
  const primaryAccount =
    props.receiverAccounts.find((a) => a.active) ??
    props.receiverAccounts[0] ??
    null;

  const [activeTab, setActiveTab] = useState<ConsoleTab>(
    props.pendingOrders.length > 0 || props.notifications.length > 0
      ? "ledger"
      : "setup"
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Receiver Account form (BDV Jurídica default)
  const [bankCode, setBankCode] = useState(primaryAccount?.bankCode ?? "0102");
  const [accountType, setAccountType] = useState<"natural" | "juridical">(
    primaryAccount?.accountType ?? "juridical"
  );
  const [phone, setPhone] = useState(primaryAccount?.phone ?? "");
  const [dni, setDni] = useState(primaryAccount?.dni ?? "");
  const [holderName, setHolderName] = useState(
    primaryAccount?.holderName ?? ""
  );
  const [accountActive, setAccountActive] = useState(
    primaryAccount?.active ?? true
  );

  // Settings & BDV Commission form
  const [rateExpMin, setRateExpMin] = useState(
    String(props.settings.rateExpirationMinutes)
  );
  const [orderExpMin, setOrderExpMin] = useState(
    String(props.settings.orderExpirationMinutes)
  );
  const [toleranceBsCents, setToleranceBsCents] = useState(
    String(props.settings.amountToleranceBsCents)
  );
  const [minRefDigits, setMinRefDigits] = useState(
    String(props.settings.minReferenceDigits)
  );
  const [incomingFeePct, setIncomingFeePct] = useState(
    String(props.settings.incomingFeePct)
  );
  const [feePassThroughMode, setFeePassThroughMode] =
    useState<BdvFeePassThroughMode>(
      props.settings.feePassThroughMode === "off" ? "off" : "incoming"
    );

  // Interactive BDV target-net simulator (default 1080 Bs matching operator example)
  const [simTargetBs, setSimTargetBs] = useState("1080.00");

  // Manual backup confirm state
  const [manualRefs, setManualRefs] = useState<Record<string, string>>({});
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>(
    {}
  );

  // Live BDV API Tester state
  const [testCedula, setTestCedula] = useState("V27037606");
  const [testPhone, setTestPhone] = useState("04121234567");
  const [testDestPhone, setTestDestPhone] = useState(
    primaryAccount?.phone ?? "04121234567"
  );
  const [testRef, setTestRef] = useState("00000000");
  const [testDate, setTestDate] = useState(props.todayDateVe);
  const [testImporte, setTestImporte] = useState("1.00");
  const [testBank, setTestBank] = useState("0102");
  const [testResult, setTestResult] = useState<{
    endpoint: string;
    verified: boolean;
    code: number | null;
    httpStatus: number;
    message: string;
    amountBsCents: number | null;
    rawAmount: string | null;
    notFound: boolean;
    authError: boolean;
  } | null>(null);

  const simGrossUp = useMemo(() => {
    const parsedNum = Number(simTargetBs.replace(",", "."));
    const targetNetBsCents =
      Number.isFinite(parsedNum) && parsedNum > 0
        ? Math.round(parsedNum * 100)
        : 0;
    return computeGrossUpForTargetBs({
      targetNetBsCents,
      incomingFeePct: Number(incomingFeePct.replace(",", ".")),
      outgoingFeePct: 0,
      passThroughMode: feePassThroughMode,
    });
  }, [simTargetBs, incomingFeePct, feePassThroughMode]);
  const simBreakdown = simGrossUp.breakdown;

  const handleToggleGateway = async () => {
    setBusyKey("toggle_gateway");
    try {
      await toggleProviderConfigAction({
        id: "pagomovil",
        enabled: !props.providerEnabled,
      });
      toast.success(
        !props.providerEnabled
          ? "Pago Móvil BDV habilitado en el checkout."
          : "Pago Móvil BDV pausado."
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error cambiando estado.");
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyKey("save_account");
    try {
      await saveReceiverBankAccountAction({
        id: primaryAccount?.id,
        bankCode,
        accountType,
        phone,
        dni,
        holderName,
        active: accountActive,
      });
      toast.success("Cuenta receptora BDV guardada correctamente.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyKey("save_settings");
    try {
      await savePagoMovilSettingsAction({
        rateExpirationMinutes: Number(rateExpMin),
        orderExpirationMinutes: Number(orderExpMin),
        amountToleranceBsCents: Number(toleranceBsCents),
        minReferenceDigits: Number(minRefDigits),
        incomingFeePct: Number(incomingFeePct.replace(",", ".")),
        outgoingFeePct: 0,
        feePassThroughMode,
      });
      toast.success("Comisiones BDV y reglas de conciliación actualizadas.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error guardando reglas.");
    } finally {
      setBusyKey(null);
    }
  };

  const handleManualConfirm = async (order: OrderDTO) => {
    const ref = (manualRefs[order.id] ?? "").trim();
    if (ref.length < 4) {
      toast.error("Ingresa la referencia bancaria (mínimo 4 dígitos).");
      return;
    }
    const rawBs = (manualAmounts[order.id] ?? "").trim().replace(",", ".");
    const paidBsCents =
      rawBs && Number.isFinite(Number(rawBs)) && Number(rawBs) > 0
        ? Math.round(Number(rawBs) * 100)
        : undefined;

    setBusyKey(`manual_${order.id}`);
    try {
      await manualConfirmPagoMovilAction({
        orderId: order.id,
        referenceDigits: ref,
        paidBsCents,
      });
      toast.success(`Orden #${order.orderNumber} confirmada manualmente.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo confirmar.");
    } finally {
      setBusyKey(null);
    }
  };

  const handleRunBdvTest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setBusyKey("test_bdv");
    setTestResult(null);
    try {
      const res = await testBdvConciliacionAction({
        cedulaPagador: testCedula,
        telefonoPagador: testPhone,
        telefonoDestino: testDestPhone || primaryAccount?.phone || "04121234567",
        referencia: testRef,
        fechaPago: testDate,
        importeBs: testImporte,
        bancoOrigen: testBank,
      });
      setTestResult(res);
      if (res.verified) {
        toast.success(`¡BDV verificó el movimiento! Monto: Bs. ${res.rawAmount}`);
      } else if (res.authError) {
        toast.error("BDV rechazó la API Key (HTTP 401).");
      } else if (res.notFound) {
        toast.info(
          "Conexión BDV exitosa (HTTP 200 · code 1010: movimiento no existe con esos datos)."
        );
      } else {
        toast.warning(`BDV respondió código ${res.code}: ${res.message}`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error consultando API BDV."
      );
    } finally {
      setBusyKey(null);
    }
  };

  const { position } = props;

  return (
    <div className="space-y-6">
      {/* Top Status & Controls Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: BDV API Connectivity */}
        <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              API Conciliación BDV
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                props.bdvApiConfigured
                  ? "bg-emerald-500/15 border-emerald-400/35 text-emerald-300"
                  : "bg-rose-500/15 border-rose-400/35 text-rose-300"
              }`}
            >
              <KeyRound className="w-3 h-3" />
              <span>
                {props.bdvApiConfigured ? "API Key Activa" : "Falta BDV_API_KEY"}
              </span>
            </span>
          </div>
          <div>
            <div className="text-sm font-black text-white">
              {props.bdvApiConfigured
                ? "Verificación Directa 24/7"
                : "Configura BDV_API_KEY en .env"}
            </div>
            <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
              {props.bdvEndpoint}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busyKey === "toggle_gateway"}
              onClick={() => void handleToggleGateway()}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-colors ${
                props.providerEnabled
                  ? "bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/35 text-emerald-200"
                  : "bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200"
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>
                {props.providerEnabled ? "Checkout Activo" : "Checkout Pausado"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("tester");
                void handleRunBdvTest();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-sky-200 text-xs font-bold transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Probar BDV</span>
            </button>
          </div>
        </div>

        {/* Card 2: REAL BDV Bank Account Balance (after incoming 1.5% fee) */}
        <div className="rounded-2xl bg-[#0d101b] border border-sky-400/25 p-5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-sky-300">
              Saldo REAL en tu Cuenta BDV
            </span>
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/30 text-[10px] font-black text-amber-200">
              -{position.pagomovilIncomingFeePct}% entrada BDV
            </span>
          </div>
          <div className="text-2xl font-black font-mono text-white tabular-nums">
            {formatBs(position.pagomovilBalanceBsCents)}
          </div>
          <div className="text-[11px] text-slate-300 space-y-0.5 tabular-nums">
            <div>
              Cobrado bruto a clientes:{" "}
              <strong className="text-white">
                {formatBs(position.pagomovilSalesGrossBsCents)}
              </strong>
            </div>
            <div>
              Comisión BDV descontada al recibir:{" "}
              <strong className="text-amber-300">
                -{formatBs(position.pagomovilIncomingFeeBsCents)}
              </strong>{" "}
              <span className="text-slate-400">
                (≈ -{formatCents(position.pagomovilIncomingFeeUsdCents)})
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Equivalent USDT Value (Bs -> USDT) */}
        <div className="rounded-2xl bg-[#0d101b] border border-emerald-400/25 p-5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
              Equivalente en USDT (P2P)
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-black text-emerald-200">
              Bs → USDT
            </span>
          </div>
          <div className="text-2xl font-black font-mono text-emerald-300 tabular-nums">
            {formatCents(position.pagomovilMarkToMarketUsdtCents)} USDT
          </div>
          <div className="text-[11px] text-slate-300 space-y-0.5 tabular-nums">
            <div>
              En libros:{" "}
              <strong className="text-white">
                {formatCents(position.pagomovilBalanceUsdCents)} USD
              </strong>
            </div>
            <div className="text-sky-300">
              Para convertir estos Bs a USDT usa{" "}
              <Link
                href="/admin/banks"
                className="underline font-bold hover:text-sky-200"
              >
                Bancos → Cambiar Bs → USDT
              </Link>
              .
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] pb-3">
        {[
          {
            id: "ledger" as const,
            label: `Conciliación & Órdenes (${props.pendingOrders.length})`,
            icon: Banknote,
          },
          {
            id: "setup" as const,
            label: "Cuenta BDV, Comisiones y Tasa Bs",
            icon: Settings,
          },
          {
            id: "tester" as const,
            label: "Probar API BDV",
            icon: FlaskConical,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                active
                  ? "bg-white text-slate-950"
                  : "bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/10"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ================================================================= */}
      {/* TAB 1: LEDGER & PENDING ORDERS                                    */}
      {/* ================================================================= */}
      {activeTab === "ledger" && (
        <div className="space-y-6">
          {/* Pending Orders with Manual Backup Confirm */}
          <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-black text-white">
                  Órdenes Pago Móvil Pendientes / En Revisión (
                  {props.pendingOrders.length})
                </h2>
                <p className="text-[11px] text-slate-400">
                  Las órdenes nuevas se concilian automáticamente al instante vía API
                  BDV. Usa confirmación manual solo como respaldo si BDV tiene
                  mantenimiento.
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-bold text-slate-200"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Actualizar</span>
              </button>
            </div>

            {props.pendingOrders.length === 0 ? (
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-6 text-center text-xs text-slate-400">
                No hay órdenes Pago Móvil pendientes en este momento.
              </div>
            ) : (
              <div className="space-y-3">
                {props.pendingOrders.map((order) => {
                  const expectedBs =
                    order.bsRateCents && order.bsRateCents > 0
                      ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
                      : order.totalBsCents ?? 0;
                  return (
                    <div
                      key={order.id}
                      className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="font-mono text-xs font-black text-sky-300 hover:underline"
                          >
                            #{order.orderNumber}
                          </Link>
                          <span className="text-xs text-slate-300 ml-2">
                            {order.email}
                          </span>
                          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                            Esperado:{" "}
                            <strong className="text-white">
                              {formatBs(expectedBs)}
                            </strong>{" "}
                            ({formatCents(order.amountDueCents)} USD) · Pagado:{" "}
                            <strong className="text-emerald-300">
                              {formatCents(order.paidCents)} USD
                            </strong>{" "}
                            · Estado:{" "}
                            <span className="uppercase font-bold text-amber-300">
                              {order.status}
                            </span>
                          </div>
                        </div>
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="text-xs font-bold text-sky-400 hover:text-sky-300"
                        >
                          Ver orden →
                        </Link>
                      </div>

                      {order.attentionReason && (
                        <div className="rounded-lg bg-amber-500/10 border border-amber-400/25 px-3 py-2 text-[11px] text-amber-200">
                          {order.attentionReason}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={manualRefs[order.id] ?? ""}
                          onChange={(e) =>
                            setManualRefs((prev) => ({
                              ...prev,
                              [order.id]: e.target.value,
                            }))
                          }
                          placeholder="Referencia bancaria (respaldo manual)"
                          className="flex-1 min-w-[180px] rounded-lg bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white font-mono"
                        />
                        <input
                          type="text"
                          value={manualAmounts[order.id] ?? ""}
                          onChange={(e) =>
                            setManualAmounts((prev) => ({
                              ...prev,
                              [order.id]: e.target.value,
                            }))
                          }
                          placeholder={`Monto Bs (def. ${(expectedBs / 100).toFixed(2)})`}
                          className="w-40 rounded-lg bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white font-mono"
                        />
                        <button
                          type="button"
                          disabled={busyKey === `manual_${order.id}`}
                          onClick={() => void handleManualConfirm(order)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs"
                        >
                          {busyKey === `manual_${order.id}` ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          <span>Confirmar manual</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Verified BDV Movements Ledger */}
          <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-5 space-y-4">
            <div>
              <h2 className="text-sm font-black text-white">
                Historial de Movimientos Conciliados ({props.notifications.length})
              </h2>
              <p className="text-[11px] text-slate-400">
                Cada movimiento muestra el monto bruto enviado por el cliente, la
                comisión BDV de entrada ({props.settings.incomingFeePct}%) y los Bs
                reales acreditados en tu cuenta.
              </p>
            </div>

            {props.notifications.length === 0 ? (
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-6 text-center text-xs text-slate-400">
                Aún no hay movimientos conciliados registrados.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase text-slate-400 border-b border-white/[0.08]">
                    <tr>
                      <th className="py-2 pr-3">Fecha</th>
                      <th className="py-2 pr-3">Origen</th>
                      <th className="py-2 pr-3">Referencia</th>
                      <th className="py-2 pr-3">Pagador</th>
                      <th className="py-2 pr-3 text-right">Bruto Bs</th>
                      <th className="py-2 pr-3 text-right">
                        Comisión BDV (-{props.settings.incomingFeePct}%)
                      </th>
                      <th className="py-2 pr-3 text-right">Real en BDV</th>
                      <th className="py-2 text-right">Orden</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05] tabular-nums">
                    {props.notifications.map((n) => {
                      const fee = computeBdvFeeBreakdown({
                        grossBsCents: n.amountBsCents ?? 0,
                        incomingFeePct: props.settings.incomingFeePct,
                        outgoingFeePct: props.settings.outgoingFeePct,
                      });
                      const bankShort = n.senderBankCode
                        ? BANK_BY_CODE.get(n.senderBankCode)?.shortName ??
                          n.senderBankCode
                        : "—";
                      return (
                        <tr key={n.id} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 pr-3 text-[11px] text-slate-400 whitespace-nowrap">
                            {shortDate(n.createdAt)}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                                n.sourceType === "BDV_API"
                                  ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-300"
                                  : n.sourceType === "MANUAL"
                                    ? "bg-amber-500/15 border-amber-400/30 text-amber-200"
                                    : "bg-slate-500/15 border-slate-400/30 text-slate-300"
                              }`}
                            >
                              {n.sourceType}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 font-mono font-bold text-white">
                            {n.referenceFull ?? "—"}
                          </td>
                          <td className="py-2.5 pr-3 text-[11px] text-slate-300">
                            <div>
                              {bankShort}
                              {n.senderDni ? ` · ${n.senderDni}` : ""}
                            </div>
                            {n.senderPhone && (
                              <div className="font-mono text-slate-400">
                                {n.senderPhone}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono text-slate-200">
                            {formatBs(n.amountBsCents)}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono text-amber-300">
                            {n.amountBsCents
                              ? `-${formatBs(fee.incomingFeeBsCents)}`
                              : "—"}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono font-black text-emerald-300">
                            {n.amountBsCents
                              ? formatBs(fee.netCreditedBsCents)
                              : "—"}
                          </td>
                          <td className="py-2.5 text-right">
                            {n.matchedOrderId ? (
                              <Link
                                href={`/admin/orders/${n.matchedOrderId}`}
                                className="font-semibold text-sky-400 hover:underline"
                              >
                                Ver orden →
                              </Link>
                            ) : (
                              <span className="text-slate-500">{n.status}</span>
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
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: BDV RECEIVER ACCOUNT, COMMISSIONS & BS RATE DESK           */}
      {/* ================================================================= */}
      {activeTab === "setup" && (
        <div className="space-y-6">
          <BsExchangeDeskCard
            bsRateCents={props.bsRateCents}
            initialPolicy={props.initialBsRatePolicy}
            initialLiveRates={props.initialLiveRates}
            position={props.position}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Receiver Bank Account Form (BDV Jurídica) */}
            <form
              onSubmit={handleSaveAccount}
              className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 space-y-4"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white">
                    Cuenta Receptora Pago Móvil (BDV)
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Estos son los datos mostrados al cliente y el{" "}
                    <code className="text-sky-300">telefonoDestino</code> enviado al
                    API Conciliación BDV.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Banco receptor
                  </label>
                  <select
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white"
                  >
                    {VENEZUELAN_BANKS.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.code} · {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Tipo de cuenta
                  </label>
                  <select
                    value={accountType}
                    onChange={(e) =>
                      setAccountType(e.target.value as "natural" | "juridical")
                    }
                    className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white"
                  >
                    <option value="juridical">Cuenta Jurídica (BDV Empresa)</option>
                    <option value="natural">Cuenta Natural</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Teléfono destino BDV (11 dígitos)
                  </label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="04127141363"
                    className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    RIF / Cédula receptora
                  </label>
                  <input
                    type="text"
                    required
                    value={dni}
                    onChange={(e) => setDni(e.target.value)}
                    placeholder="J-500123456"
                    className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Nombre del titular / comercio
                  </label>
                  <input
                    type="text"
                    required
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                    placeholder="StoryCheap C.A."
                    className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={accountActive}
                  onChange={(e) => setAccountActive(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-slate-950"
                />
                <span>Cuenta receptora activa en el checkout</span>
              </label>

              <button
                type="submit"
                disabled={busyKey === "save_account"}
                className="w-full py-3 rounded-xl bg-white hover:bg-sky-200 disabled:opacity-50 text-slate-950 font-black text-xs transition-colors"
              >
                {busyKey === "save_account"
                  ? "Guardando cuenta BDV..."
                  : "Guardar cuenta receptora BDV"}
              </button>
            </form>

            {/* BDV Fees & Reconciliation Rules Form + Live Simulator */}
            <form
              onSubmit={handleSaveSettings}
              className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 space-y-5"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-300">
                  <Calculator className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white">
                    Comisión BDV y Reglas de Conciliación
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Define la comisión del BDV para trasladarla automáticamente al precio en Bs y recibir exacto lo que quieres en el banco.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold text-amber-300 mb-1">
                    Comisión BDV al recibir Pago Móvil (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="25"
                    value={incomingFeePct}
                    onChange={(e) => setIncomingFeePct(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-amber-400/30 px-3 py-2.5 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Expiración tasa (min)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="120"
                    value={rateExpMin}
                    onChange={(e) => setRateExpMin(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Expiración orden (min)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="180"
                    value={orderExpMin}
                    onChange={(e) => setOrderExpMin(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Tolerancia céntimos Bs
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={toleranceBsCents}
                    onChange={(e) => setToleranceBsCents(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Dígitos mín. referencia
                  </label>
                  <input
                    type="number"
                    min="4"
                    max="12"
                    value={minRefDigits}
                    onChange={(e) => setMinRefDigits(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                  />
                </div>
              </div>

              {/* Gross-Up Mode: Pass BDV commission onto customer Bs price */}
              <div className="space-y-2 pt-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-sky-300">
                  Traslado automático de comisión BDV al cliente
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(
                    [
                      {
                        id: "incoming" as const,
                        title: "Cubrir comisión BDV (Recomendado)",
                        desc: "Si quieres Bs 1,080 en tu cuenta BDV, se vende en Bs 1,096.45 y te caen Bs 1,080 exactos.",
                      },
                      {
                        id: "off" as const,
                        title: "Sin recargo",
                        desc: "Se cobra tu tasa base tal cual; tú absorbes la comisión del banco.",
                      },
                    ] as const
                  ).map((opt) => {
                    const active = feePassThroughMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setFeePassThroughMode(opt.id)}
                        className={`text-left rounded-xl border p-3 transition-all cursor-pointer ${
                          active
                            ? "bg-sky-500/15 border-sky-400/50 text-white ring-1 ring-sky-400/30"
                            : "bg-slate-950/60 border-white/10 text-slate-300 hover:border-white/25"
                        }`}
                      >
                        <div className="text-xs font-bold text-white">
                          {opt.title}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                          {opt.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live BDV Target-Net Simulator Card */}
              <div className="rounded-xl bg-slate-950/90 border border-white/10 p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-black text-white">
                    Simulador: ¿cuántos Bs quieres que caigan en BDV?
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">Quiero Bs:</span>
                    <input
                      type="text"
                      value={simTargetBs}
                      onChange={(e) =>
                        setSimTargetBs(e.target.value.replace(/[^0-9.,]/g, ""))
                      }
                      className="w-24 rounded-lg bg-slate-900 border border-white/15 px-2 py-1 text-xs font-mono text-white text-right"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 text-[11px] tabular-nums">
                  <div className="flex justify-between text-slate-200">
                    <span>
                      Precio al cliente en tienda{" "}
                      {simGrossUp.effectiveMarkupPct > 0
                        ? `(+${simGrossUp.effectiveMarkupPct.toFixed(2)}%)`
                        : "(sin recargo)"}
                    </span>
                    <span className="font-mono font-black text-white">
                      {formatBs(simBreakdown.grossBsCents)}
                    </span>
                  </div>
                  <div className="flex justify-between text-amber-300">
                    <span>
                      Comisión BDV (-{simBreakdown.incomingFeePct}%)
                    </span>
                    <span className="font-mono font-bold">
                      -{formatBs(simBreakdown.incomingFeeBsCents)}
                    </span>
                  </div>
                  <div className="flex justify-between text-emerald-300 font-black pt-1.5 border-t border-white/[0.08] text-xs">
                    <span>Te cae REAL en tu cuenta BDV</span>
                    <span className="font-mono">
                      {formatBs(simBreakdown.netCreditedBsCents)}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={busyKey === "save_settings"}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs transition-colors"
              >
                {busyKey === "save_settings"
                  ? "Guardando comisiones y reglas..."
                  : "Guardar comisiones BDV y reglas"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: LIVE BDV API TESTER                                        */}
      {/* ================================================================= */}
      {activeTab === "tester" && (
        <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-6 space-y-5 max-w-3xl">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white">
                Probador en Vivo · API Conciliación BDV (POST /getMovement)
              </h2>
              <p className="text-[11px] text-slate-400">
                Consulta un movimiento real o verifica conectividad directa con tu{" "}
                <code>BDV_API_KEY</code> sin tocar ninguna orden.
              </p>
            </div>
          </div>

          <form onSubmit={handleRunBdvTest} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Cédula pagador (cedulaPagador)
                </label>
                <input
                  type="text"
                  required
                  value={testCedula}
                  onChange={(e) => setTestCedula(e.target.value)}
                  placeholder="V27037606"
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Teléfono pagador (telefonoPagador)
                </label>
                <input
                  type="text"
                  required
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="04127141363"
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Teléfono destino BDV (telefonoDestino)
                </label>
                <input
                  type="text"
                  required
                  value={testDestPhone}
                  onChange={(e) => setTestDestPhone(e.target.value)}
                  placeholder="04127141363"
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Banco origen (bancoOrigen)
                </label>
                <select
                  value={testBank}
                  onChange={(e) => setTestBank(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white"
                >
                  {VENEZUELAN_BANKS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Referencia (referencia)
                </label>
                <input
                  type="text"
                  required
                  value={testRef}
                  onChange={(e) => setTestRef(e.target.value)}
                  placeholder="123112313"
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Importe en Bs (importe)
                </label>
                <input
                  type="text"
                  required
                  value={testImporte}
                  onChange={(e) => setTestImporte(e.target.value)}
                  placeholder="120.00"
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Fecha pago (YYYY-MM-DD, hora Venezuela)
                </label>
                <input
                  type="date"
                  required
                  value={testDate}
                  onChange={(e) => setTestDate(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-white font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busyKey === "test_bdv"}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-sky-200 disabled:opacity-50 text-slate-950 font-black text-xs transition-colors"
            >
              {busyKey === "test_bdv" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FlaskConical className="w-4 h-4" />
              )}
              <span>Consultar POST /getMovement en BDV</span>
            </button>
          </form>

          {testResult && (
            <div
              className={`rounded-xl border p-4 space-y-2 text-xs ${
                testResult.verified
                  ? "bg-emerald-500/10 border-emerald-400/35 text-emerald-100"
                  : testResult.authError
                    ? "bg-rose-500/10 border-rose-400/35 text-rose-100"
                    : "bg-sky-500/10 border-sky-400/30 text-sky-100"
              }`}
            >
              <div className="flex items-center gap-2 font-black">
                {testResult.verified ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-300" />
                )}
                <span>
                  HTTP {testResult.httpStatus} · Código BDV:{" "}
                  {testResult.code ?? "—"} ·{" "}
                  {testResult.verified
                    ? "TRANSACCIÓN VERIFICADA"
                    : testResult.authError
                      ? "ERROR DE AUTENTICACIÓN (API KEY)"
                      : "CONEXIÓN OK · REGISTRO NO ENCONTRADO"}
                </span>
              </div>
              <div className="font-mono text-[11px]">{testResult.message}</div>
              {testResult.verified && testResult.amountBsCents && (
                <div className="pt-1 border-t border-white/10 text-[11px]">
                  {(() => {
                    const b = computeBdvFeeBreakdown({
                      grossBsCents: testResult.amountBsCents,
                      incomingFeePct: props.settings.incomingFeePct,
                      outgoingFeePct: props.settings.outgoingFeePct,
                    });
                    return (
                      <>
                        Monto verificado: <strong>{formatBs(b.grossBsCents)}</strong>{" "}
                        · Comisión BDV (-{b.incomingFeePct}%):{" "}
                        <strong className="text-amber-300">
                          -{formatBs(b.incomingFeeBsCents)}
                        </strong>{" "}
                        · Te cae real:{" "}
                        <strong className="text-emerald-300">
                          {formatBs(b.netCreditedBsCents)}
                        </strong>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
