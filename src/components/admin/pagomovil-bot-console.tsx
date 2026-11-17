"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Banknote,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  FlaskConical,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  Power,
  RefreshCw,
  Settings,
  ShieldCheck,
  Smartphone,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  allowBotAppPackageAction,
  deleteBotDeviceAction,
  fetchLiveVenezuelaRatesAction,
  manualConfirmPagoMovilAction,
  registerBotDeviceAction,
  savePagoMovilBotSettingsAction,
  saveReceiverBankAccountAction,
  testNotificationParserAction,
  toggleBotDeviceAction,
  toggleProviderConfigAction,
  updateBsRateAction,
} from "@/app/admin/actions";
import {
  BANK_BY_CODE,
  DEFAULT_ANDROID_PACKAGES_BY_BANK,
  VENEZUELAN_BANKS,
} from "@/lib/catalog-banks";
import { formatCents } from "@/lib/catalog-seed";
import type {
  BankPaymentNotificationDTO,
  BotDeviceDTO,
  OrderDTO,
  PagoMovilBotSettingsDTO,
  ReceiverBankAccountDTO,
} from "@/types";

interface PagoMovilBotConsoleProps {
  siteUrl: string;
  providerEnabled: boolean;
  bsRateCents: number | null;
  watchdog: {
    online: boolean;
    activeDevicesCount: number;
    onlineDevicesCount: number;
    latestHeartbeatAt: string | null;
  };
  settings: PagoMovilBotSettingsDTO;
  receiverAccounts: ReceiverBankAccountDTO[];
  devices: BotDeviceDTO[];
  notifications: BankPaymentNotificationDTO[];
  pendingOrders: OrderDTO[];
}

type ConsoleTab = "ledger" | "setup" | "devices" | "simulator";

function formatBs(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return "—";
  }
  return `Bs ${(cents / 100).toLocaleString("es-VE", {
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

export function PagoMovilBotConsole(props: PagoMovilBotConsoleProps) {
  const router = useRouter();
  const primaryAccount =
    props.receiverAccounts.find((a) => a.active) ?? props.receiverAccounts[0] ?? null;

  const [activeTab, setActiveTab] = useState<ConsoleTab>(
    props.pendingOrders.length > 0 || props.notifications.length > 0
      ? "ledger"
      : "setup"
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Live Venezuela rates preview
  const [liveRates, setLiveRates] = useState<{
    officialBcv: number | null;
    paralelo: number | null;
    source: string;
  } | null>(null);

  // Receiver Account form
  const [bankCode, setBankCode] = useState(primaryAccount?.bankCode ?? "0102");
  const [accountType, setAccountType] = useState<"natural" | "juridical">(
    primaryAccount?.accountType ?? "juridical"
  );
  const [phone, setPhone] = useState(primaryAccount?.phone ?? "");
  const [dni, setDni] = useState(primaryAccount?.dni ?? "");
  const [holderName, setHolderName] = useState(primaryAccount?.holderName ?? "");
  const [allowedPackagesRaw, setAllowedPackagesRaw] = useState(
    primaryAccount?.allowedPackages.join(", ") ??
      DEFAULT_ANDROID_PACKAGES_BY_BANK[primaryAccount?.bankCode ?? "0102"]?.join(", ") ??
      "com.bancodevenezuela.bdvdigital, SMS, EMAIL"
  );
  const [accountActive, setAccountActive] = useState(primaryAccount?.active ?? true);

  // Settings form
  const [rateExpMin, setRateExpMin] = useState(
    String(props.settings.rateExpirationMinutes)
  );
  const [orderExpMin, setOrderExpMin] = useState(
    String(props.settings.orderExpirationMinutes)
  );
  const [toleranceBsCents, setToleranceBsCents] = useState(
    String(props.settings.amountToleranceBsCents)
  );
  const [watchdogMin, setWatchdogMin] = useState(
    String(props.settings.watchdogOfflineMinutes)
  );
  const [minRefDigits, setMinRefDigits] = useState(
    String(props.settings.minReferenceDigits)
  );
  const [enforceWatchdog, setEnforceWatchdog] = useState(
    props.settings.enforceWatchdog
  );
  const [requireSenderPhone, setRequireSenderPhone] = useState(
    props.settings.requireSenderPhone
  );

  // Device registration
  const [deviceName, setDeviceName] = useState("Android Receptor BDVApp");
  const [channelType, setChannelType] =
    useState<BotDeviceDTO["channelType"]>("ANDROID_PUSH");
  const [allowPlainBearer, setAllowPlainBearer] = useState(true);
  const [freshPairing, setFreshPairing] = useState<{
    device: BotDeviceDTO;
    plainSecret: string;
  } | null>(null);

  // Simulator
  const [simTitle, setSimTitle] = useState("PagomóvilBDV");
  const [simContent, setSimContent] = useState(
    "Has recibido un pago por concepto de PagomovilBDV por Bs. 1.250,45 de 0414-5559988 Banco 0134 Ref: 84930219"
  );
  const [simPackage, setSimPackage] = useState("com.bancodevenezuela.bdvdigital");
  const [simSource, setSimSource] = useState<"APP_PUSH" | "SMS" | "EMAIL">(
    "APP_PUSH"
  );
  const [simResult, setSimResult] = useState<Record<string, unknown> | null>(null);

  // Manual confirm drawer
  const [confirmTargetOrder, setConfirmTargetOrder] = useState<OrderDTO | null>(null);
  const [manualRef, setManualRef] = useState("");
  const [manualPaidBs, setManualPaidBs] = useState("");
  const [manualNotifId, setManualNotifId] = useState("");
  const [manualNote, setManualNote] = useState("");

  const unmatchedNotifications = useMemo(
    () => props.notifications.filter((n) => n.status === "UNMATCHED"),
    [props.notifications]
  );

  const copyText = async (key: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(`${label} copiado`);
      setTimeout(() => setCopiedKey((p) => (p === key ? null : p)), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const handleToggleProvider = async () => {
    setBusyKey("toggle_provider");
    try {
      await toggleProviderConfigAction({
        id: "pagomovil",
        enabled: !props.providerEnabled,
      });
      toast.success(
        !props.providerEnabled
          ? "Pago Móvil activado en Checkout"
          : "Pago Móvil pausado en Checkout"
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error cambiando estado");
    } finally {
      setBusyKey(null);
    }
  };

  const handleFetchLiveRates = async () => {
    setBusyKey("live_rates");
    try {
      const rates = await fetchLiveVenezuelaRatesAction();
      setLiveRates(rates);
      toast.success("Tasas consultadas desde ve.dolarapi.com");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error consultando tasas");
    } finally {
      setBusyKey(null);
    }
  };

  const handleApplyBsRate = async (rate: number | null) => {
    if (!rate || rate <= 0) return;
    setBusyKey("apply_rate");
    try {
      await updateBsRateAction(rate);
      toast.success(`Tasa Bs/USD actualizada a Bs ${rate.toFixed(2)}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error guardando tasa");
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
        allowedPackagesRaw,
        active: accountActive,
      });
      toast.success("Cuenta receptora Pago Móvil guardada");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error guardando cuenta");
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyKey("save_settings");
    try {
      await savePagoMovilBotSettingsAction({
        rateExpirationMinutes: Number(rateExpMin),
        orderExpirationMinutes: Number(orderExpMin),
        amountToleranceBsCents: Number(toleranceBsCents),
        watchdogOfflineMinutes: Number(watchdogMin),
        minReferenceDigits: Number(minRefDigits),
        enforceWatchdog,
        requireSenderPhone,
      });
      toast.success("Parámetros de verificación guardados");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error guardando reglas");
    } finally {
      setBusyKey(null);
    }
  };

  const handleRegisterDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyKey("reg_device");
    try {
      const res = await registerBotDeviceAction({
        name: deviceName,
        channelType,
        allowPlainBearer,
      });
      setFreshPairing(res);
      toast.success("Sensor creado. Copia su Token/Secreto ahora.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error creando sensor");
    } finally {
      setBusyKey(null);
    }
  };

  const handleRunSimulator = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyKey("sim");
    try {
      const out = await testNotificationParserAction({
        title: simTitle,
        content: simContent,
        appPackage: simPackage,
        sourceType: simSource,
        preferredBankCode: bankCode,
      });
      setSimResult(out as unknown as Record<string, unknown>);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error en simulador");
    } finally {
      setBusyKey(null);
    }
  };

  const handleManualConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmTargetOrder) return;
    setBusyKey("manual_confirm");
    try {
      const paidBsCents = manualPaidBs.trim()
        ? Math.round(Number(manualPaidBs.replace(",", ".")) * 100)
        : null;
      await manualConfirmPagoMovilAction({
        orderId: confirmTargetOrder.id,
        referenceDigits: manualRef,
        paidBsCents,
        notificationId: manualNotifId || null,
        note: manualNote || "owner_manual",
      });
      toast.success(`Orden #${confirmTargetOrder.orderNumber} confirmada y liberada`);
      setConfirmTargetOrder(null);
      setManualRef("");
      setManualPaidBs("");
      setManualNotifId("");
      setManualNote("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error confirmando manual");
    } finally {
      setBusyKey(null);
    }
  };

  const activeDeviceIdentifier =
    freshPairing?.device.deviceIdentifier ??
    props.devices[0]?.deviceIdentifier ??
    "TU_DEVICE_ID";
  const activeSecretPlaceholder =
    freshPairing?.plainSecret ?? "PEGA_AQUI_TU_SECRETO_DEL_SENSOR";

  const activeBankShort =
    BANK_BY_CODE.get(bankCode)?.shortName ??
    primaryAccount?.bankName ??
    "Pago Móvil";

  const macroDroidBodySnippet = JSON.stringify(
    {
      title: "[not_title]",
      content: "[notification]",
      app_package: "[not_app_package]",
      source_type: "APP_PUSH",
      battery_level: "[battery]",
      network_type: "WIFI_DATA",
    },
    null,
    2
  );

  const googleAppsScriptSnippet = `// Pega esto en script.google.com (Trigger: Cada 1 minuto)
const INGEST_URL = "${props.siteUrl}/api/bot/ingest";
const DEVICE_ID = "${activeDeviceIdentifier}";
const DEVICE_SECRET = "${activeSecretPlaceholder}";

function checkBankEmails() {
  const query = 'is:unread ("Banco de Venezuela" OR BDV OR PagomovilBDV OR Bancamiga OR "Pago Movil" OR "Pago Móvil" OR "pago recibido")';
  const threads = GmailApp.search(query, 0, 10);
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      if (!msg.isUnread()) continue;
      const bodyObj = {
        event_id: msg.getId(),
        source_type: "EMAIL",
        app_package: "EMAIL",
        title: msg.getSubject(),
        content: msg.getPlainBody().slice(0, 1200),
        posted_at: msg.getDate().toISOString(),
      };
      const rawBody = JSON.stringify(bodyObj);
      const ts = String(Math.floor(Date.now() / 1000));
      const sigBytes = Utilities.computeHmacSha256Signature(ts + "." + rawBody, DEVICE_SECRET);
      const sigHex = sigBytes.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, "0")).join("");

      const res = UrlFetchApp.fetch(INGEST_URL, {
        method: "post",
        contentType: "application/json",
        payload: rawBody,
        headers: {
          "X-Bot-Device-Id": DEVICE_ID,
          "X-Bot-Timestamp": ts,
          "X-Bot-Signature": sigHex,
        },
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
        msg.markRead();
      }
    }
  }
}`;

  return (
    <div className="space-y-6">
      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Watchdog */}
        <div className="rounded-3xl apple-glass p-5 space-y-2 border border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Watchdog Sensor
            </span>
            {props.watchdog.online ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px] font-black">
                <Wifi className="w-3 h-3" /> ONLINE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-[10px] font-black">
                <WifiOff className="w-3 h-3" /> OFFLINE
              </span>
            )}
          </div>
          <div className="text-xl font-black text-white">
            {props.watchdog.onlineDevicesCount} / {props.watchdog.activeDevicesCount}{" "}
            activos
          </div>
          <div className="text-[11px] text-slate-400">
            Último latido: {shortDate(props.watchdog.latestHeartbeatAt)}
          </div>
        </div>

        {/* Card 2: Checkout Gateway Status */}
        <div className="rounded-3xl apple-glass p-5 space-y-2 border border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Checkout StoryCheap
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                props.providerEnabled
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-rose-500/15 text-rose-300"
              }`}
            >
              {props.providerEnabled ? "ACTIVO" : "PAUSADO"}
            </span>
          </div>
          <div className="text-base font-black text-white truncate">
            {primaryAccount
              ? `${primaryAccount.bankCode} · ${primaryAccount.bankName}`
              : "Sin cuenta receptora"}
          </div>
          <button
            type="button"
            disabled={busyKey === "toggle_provider"}
            onClick={() => void handleToggleProvider()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-bold text-white transition-colors"
          >
            <Power className="w-3.5 h-3.5" />
            <span>
              {props.providerEnabled ? "Pausar pasarela" : "Activar en Checkout"}
            </span>
          </button>
        </div>

        {/* Card 3: Live Bs/USD Rate Helper */}
        <div className="rounded-3xl apple-glass p-5 space-y-2 border border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Tasa Bs/USD Aplicada
            </span>
            <Banknote className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-emerald-300 font-mono">
            {props.bsRateCents
              ? `Bs ${(props.bsRateCents / 100).toFixed(2)}`
              : "No configurada"}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busyKey === "live_rates"}
              onClick={() => void handleFetchLiveRates()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-[10px] font-bold text-emerald-300"
            >
              <RefreshCw
                className={`w-3 h-3 ${busyKey === "live_rates" ? "animate-spin" : ""}`}
              />
              <span>Consultar BCV/Paralelo</span>
            </button>
            {liveRates?.officialBcv && (
              <button
                type="button"
                onClick={() => void handleApplyBsRate(liveRates.officialBcv)}
                className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-bold text-white"
              >
                BCV {liveRates.officialBcv.toFixed(2)}
              </button>
            )}
            {liveRates?.paralelo && (
              <button
                type="button"
                onClick={() => void handleApplyBsRate(liveRates.paralelo)}
                className="px-2 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-[10px] font-bold text-sky-200"
              >
                Par {liveRates.paralelo.toFixed(2)}
              </button>
            )}
          </div>
        </div>

        {/* Card 4: Ledger Summary */}
        <div className="rounded-3xl apple-glass p-5 space-y-2 border border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Actividad Verificador
            </span>
            <Activity className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-xl font-black text-white">
            {unmatchedNotifications.length} sin reclamar · {props.pendingOrders.length}{" "}
            pendientes
          </div>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-bold text-white"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refrescar feed</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          {
            id: "ledger" as const,
            label: "Feed Bancario & Aprobación Manual",
            icon: Activity,
            badge:
              props.pendingOrders.length + unmatchedNotifications.length || null,
          },
          {
            id: "setup" as const,
            label: `Cuenta ${activeBankShort} & Reglas`,
            icon: Building2,
            badge: null,
          },
          {
            id: "devices" as const,
            label: "Sensores Android / Gmail Script",
            icon: Smartphone,
            badge: props.devices.length || null,
          },
          {
            id: "simulator" as const,
            label: "Simulador Parser",
            icon: FlaskConical,
            badge: null,
          },
        ].map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black transition-all ${
                active
                  ? "bg-white text-slate-950 shadow-lg"
                  : "bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{t.label}</span>
              {t.badge !== null && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                    active
                      ? "bg-slate-950 text-white"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: LEDGER & MANUAL CONFIRM */}
      {activeTab === "ledger" && (
        <div className="space-y-6">
          {/* Pending / Attention Orders */}
          <div className="rounded-3xl apple-glass p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-black text-white">
                  Órdenes Pago Móvil Pendientes o en Revisión ({props.pendingOrders.length})
                </h2>
                <p className="text-xs text-slate-400">
                  Si un cliente reportó un error o pagó tarde tras expirar, aprueba o libera manualmente desde aquí.
                </p>
              </div>
            </div>

            {props.pendingOrders.length === 0 ? (
              <div className="rounded-2xl bg-slate-950/60 border border-white/[0.06] p-5 text-xs text-slate-400">
                No hay órdenes Pago Móvil esperando confirmación manual en este momento.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 uppercase text-[10px]">
                      <th className="py-2.5 pr-4">Orden</th>
                      <th className="py-2.5 pr-4">Cliente</th>
                      <th className="py-2.5 pr-4">Monto USD / Bs</th>
                      <th className="py-2.5 pr-4">Estado</th>
                      <th className="py-2.5 pr-4">Nota</th>
                      <th className="py-2.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {props.pendingOrders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 pr-4 font-mono font-bold text-white">
                          <Link
                            href={`/order/${ord.id}`}
                            className="hover:text-sky-300 underline"
                          >
                            #{ord.orderNumber}
                          </Link>
                        </td>
                        <td className="py-3 pr-4 text-slate-300">{ord.email}</td>
                        <td className="py-3 pr-4 font-mono">
                          <div className="text-white font-bold">
                            {formatCents(ord.amountDueCents)} USD
                          </div>
                          <div className="text-[11px] text-emerald-300">
                            {formatBs(ord.totalBsCents)}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                              ord.needsAttention
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-sky-500/15 text-sky-300"
                            }`}
                          >
                            {ord.status}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-[11px] text-amber-200 max-w-xs truncate">
                          {ord.attentionReason ?? "Esperando pago/ref"}
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmTargetOrder(ord);
                              setManualRef("");
                              setManualPaidBs(
                                ord.totalBsCents
                                  ? (ord.totalBsCents / 100).toFixed(2)
                                  : ""
                              );
                            }}
                            className="px-3 py-1.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-[11px]"
                          >
                            Aprobar Manual
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Notifications Ledger */}
          <div className="rounded-3xl apple-glass p-6 space-y-4">
            <h2 className="text-base font-black text-white">
              Historial de Notificaciones Bancarias Recibidas ({props.notifications.length})
            </h2>
            {props.notifications.length === 0 ? (
              <div className="rounded-2xl bg-slate-950/60 border border-white/[0.06] p-6 text-xs text-slate-400">
                Aún no han llegado notificaciones al webhook `/api/bot/ingest`. Configura un sensor en la pestaña &quot;Sensores Android / Gmail Script&quot;.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 uppercase text-[10px]">
                      <th className="py-2.5 pr-3">Fecha</th>
                      <th className="py-2.5 pr-3">Canal / Parser</th>
                      <th className="py-2.5 pr-3">Monto Bs</th>
                      <th className="py-2.5 pr-3">Ref</th>
                      <th className="py-2.5 pr-3">Emisor</th>
                      <th className="py-2.5 pr-3">Mensaje</th>
                      <th className="py-2.5 pr-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {props.notifications.map((n) => (
                      <tr key={n.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 pr-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                          {shortDate(n.postedAt)}
                        </td>
                        <td className="py-3 pr-3">
                          <div className="font-bold text-white">{n.sourceType}</div>
                          <div className="text-[10px] text-slate-400">
                            {n.parserUsed ?? n.appPackage ?? "—"}
                          </div>
                        </td>
                        <td className="py-3 pr-3 font-mono font-bold text-emerald-300 whitespace-nowrap">
                          {formatBs(n.amountBsCents)}
                        </td>
                        <td className="py-3 pr-3 font-mono font-bold text-white">
                          {n.referenceFull ?? "—"}
                        </td>
                        <td className="py-3 pr-3 text-[11px] text-slate-300">
                          {[n.senderBankCode, n.senderPhone, n.senderDni]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td className="py-3 pr-3 text-[11px] text-slate-400 max-w-xs truncate">
                          {n.rawContentPreview}
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                                n.status === "MATCHED"
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : n.status === "UNMATCHED"
                                    ? "bg-sky-500/20 text-sky-300"
                                    : n.status === "DUPLICATE"
                                      ? "bg-amber-500/20 text-amber-300"
                                      : n.status === "IGNORED"
                                        ? "bg-slate-700 text-slate-300"
                                        : "bg-rose-500/20 text-rose-300"
                              }`}
                            >
                              {n.status}
                            </span>
                            {n.status === "IGNORED" &&
                              n.parserUsed === "package_guard" &&
                              n.appPackage &&
                              !/^[\{\[].*[\}\]]$/.test(n.appPackage) && (
                                <button
                                  type="button"
                                  disabled={busyKey === `allow_${n.id}`}
                                  onClick={async () => {
                                    setBusyKey(`allow_${n.id}`);
                                    try {
                                      const updated =
                                        await allowBotAppPackageAction(n.appPackage!);
                                      setAllowedPackagesRaw(
                                        updated.allowedPackages.join(", ")
                                      );
                                      toast.success(
                                        `App autorizada: ${n.appPackage}`
                                      );
                                      router.refresh();
                                    } catch (err) {
                                      toast.error(
                                        err instanceof Error
                                          ? err.message
                                          : "Error autorizando paquete"
                                      );
                                    } finally {
                                      setBusyKey(null);
                                    }
                                  }}
                                  className="px-2 py-0.5 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/40 text-amber-200 text-[10px] font-bold"
                                >
                                  + Autorizar app
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: RECEIVER BANK ACCOUNT & BOT RULES */}
      {activeTab === "setup" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Receiver Account Form */}
          <form
            onSubmit={handleSaveAccount}
            className="lg:col-span-6 rounded-3xl apple-glass p-6 space-y-4"
          >
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <span>Cuenta Receptora Pago Móvil (Natural o Jurídica)</span>
            </h2>
            <p className="text-xs text-slate-400">
              Funciona 100% con tu cuenta personal (Natural, cédula V-) sin requerir RIF jurídico.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Banco receptor
                </label>
                <select
                  value={bankCode}
                  onChange={(e) => {
                    const nextCode = e.target.value;
                    setBankCode(nextCode);
                    const nextDefaults = DEFAULT_ANDROID_PACKAGES_BY_BANK[nextCode];
                    if (nextDefaults) {
                      setAllowedPackagesRaw(nextDefaults.join(", "));
                    }
                  }}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs text-white"
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
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs text-white"
                >
                  <option value="natural">Persona Natural (Cédula V/E)</option>
                  <option value="juridical">Jurídica (RIF J/G)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Teléfono Pago Móvil
                </label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="04121234567"
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Cédula / RIF
                </label>
                <input
                  type="text"
                  required
                  value={dni}
                  onChange={(e) => setDni(e.target.value)}
                  placeholder="V-24123456"
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs font-mono text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Titular visible en el checkout
              </label>
              <input
                type="text"
                required
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                placeholder="Ej. StoryCheap Digital / Tu Nombre"
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Allowlist de paquetes Android / Canales permitidos
              </label>
              <input
                type="text"
                value={allowedPackagesRaw}
                onChange={(e) => setAllowedPackagesRaw(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs font-mono text-white"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Anti-spoofing: notificaciones de WhatsApp u otras apps no listadas aquí se ignoran automáticamente.
              </p>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={accountActive}
                onChange={(e) => setAccountActive(e.target.checked)}
                className="rounded border-white/20 bg-slate-950 text-emerald-400"
              />
              <span>Activar como cuenta receptora principal</span>
            </label>

            <button
              type="submit"
              disabled={busyKey === "save_account"}
              className="w-full py-3 rounded-2xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs flex items-center justify-center gap-2"
            >
              {busyKey === "save_account" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              <span>Guardar Cuenta {activeBankShort}</span>
            </button>
          </form>

          {/* Settings Form */}
          <form
            onSubmit={handleSaveSettings}
            className="lg:col-span-6 rounded-3xl apple-glass p-6 space-y-4"
          >
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <Settings className="w-4 h-4 text-sky-400" />
              <span>Reglas de Verificación, Tasa y Watchdog</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Expiración tasa congelada (min)
                </label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={rateExpMin}
                  onChange={(e) => setRateExpMin(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Expiración orden Pago Móvil (min)
                </label>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={orderExpMin}
                  onChange={(e) => setOrderExpMin(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Tolerancia redondeo (céntimos Bs)
                </label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={toleranceBsCents}
                  onChange={(e) => setToleranceBsCents(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs font-mono text-white"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Ej. 5 = Bs 0,05 de tolerancia.
                </p>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Mínimo dígitos de referencia
                </label>
                <input
                  type="number"
                  min={4}
                  max={12}
                  value={minRefDigits}
                  onChange={(e) => setMinRefDigits(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs font-mono text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Umbral Watchdog Offline (minutos sin heartbeat)
                </label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={watchdogMin}
                  onChange={(e) => setWatchdogMin(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs font-mono text-white"
                />
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enforceWatchdog}
                  onChange={(e) => setEnforceWatchdog(e.target.checked)}
                  className="mt-0.5 rounded border-white/20 bg-slate-950 text-sky-400"
                />
                <span>
                  <strong className="text-white block">
                    Bloquear Pago Móvil en Checkout si Watchdog está Offline
                  </strong>
                  <span className="text-[11px] text-slate-400">
                    Actívalo cuando ya tengas tu teléfono o Apps Script corriendo para no aceptar pedidos si el sensor perdió internet.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireSenderPhone}
                  onChange={(e) => setRequireSenderPhone(e.target.checked)}
                  className="mt-0.5 rounded border-white/20 bg-slate-950 text-sky-400"
                />
                <span>
                  <strong className="text-white block">
                    Exigir teléfono emisor obligatorio en formulario cliente
                  </strong>
                  <span className="text-[11px] text-slate-400">
                    Útil si manejas alto volumen y necesitas mayor desempate de referencias cortas.
                  </span>
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={busyKey === "save_settings"}
              className="w-full py-3 rounded-2xl bg-white hover:bg-sky-300 text-slate-950 font-black text-xs flex items-center justify-center gap-2"
            >
              {busyKey === "save_settings" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>Guardar Configuración</span>
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: DEVICES & TEMPLATES */}
      {activeTab === "devices" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Register new sensor */}
            <form
              onSubmit={handleRegisterDevice}
              className="lg:col-span-5 rounded-3xl apple-glass p-6 space-y-4"
            >
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                <span>Emparejar Nuevo Sensor (Android o Gmail)</span>
              </h2>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Nombre identificador
                </label>
                <input
                  type="text"
                  required
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Tipo de canal
                </label>
                <select
                  value={channelType}
                  onChange={(e) =>
                    setChannelType(e.target.value as BotDeviceDTO["channelType"])
                  }
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2.5 text-xs text-white"
                >
                  <option value="ANDROID_PUSH">
                    Android Push Listener (MacroDroid / Tasker / APK)
                  </option>
                  <option value="ANDROID_SMS">Android SMS Bancario</option>
                  <option value="EMAIL_SCRIPT">
                    Google Apps Script (Gmail Bancario)
                  </option>
                </select>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowPlainBearer}
                  onChange={(e) => setAllowPlainBearer(e.target.checked)}
                  className="mt-0.5 rounded border-white/20 bg-slate-950 text-emerald-400"
                />
                <span>
                  <strong className="text-white block">
                    Permitir cabecera simple `X-Bot-Token` (Recomendado para MacroDroid sin código)
                  </strong>
                  <span className="text-[11px] text-slate-400">
                    Si lo desactivas, solo aceptará firma HMAC-SHA256 (`X-Bot-Signature` + `X-Bot-Timestamp`).
                  </span>
                </span>
              </label>

              <button
                type="submit"
                disabled={busyKey === "reg_device"}
                className="w-full py-3 rounded-2xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs flex items-center justify-center gap-2"
              >
                <KeyRound className="w-4 h-4" />
                <span>Generar Credenciales del Sensor</span>
              </button>

              {freshPairing && (
                <div className="rounded-2xl bg-emerald-500/15 border border-emerald-400/40 p-4 space-y-2.5 text-xs">
                  <div className="font-black text-emerald-300">
                    ¡Credenciales generadas! Cópialas ahora (el secreto solo se muestra una vez):
                  </div>
                  <div>
                    <span className="text-slate-400">X-Bot-Device-Id:</span>
                    <div className="flex items-center justify-between gap-2 mt-0.5 bg-slate-950 px-2.5 py-1.5 rounded-lg font-mono text-[11px] text-white">
                      <span className="truncate">
                        {freshPairing.device.deviceIdentifier}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(
                            "dev_id",
                            freshPairing.device.deviceIdentifier,
                            "Device ID"
                          )
                        }
                        className="text-emerald-300"
                      >
                        {copiedKey === "dev_id" ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400">Secreto / X-Bot-Token:</span>
                    <div className="flex items-center justify-between gap-2 mt-0.5 bg-slate-950 px-2.5 py-1.5 rounded-lg font-mono text-[11px] text-white">
                      <span className="truncate">{freshPairing.plainSecret}</span>
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(
                            "dev_sec",
                            freshPairing.plainSecret,
                            "Secreto del sensor"
                          )
                        }
                        className="text-emerald-300"
                      >
                        {copiedKey === "dev_sec" ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </form>

            {/* Registered Devices Table */}
            <div className="lg:col-span-7 rounded-3xl apple-glass p-6 space-y-4">
              <h2 className="text-base font-black text-white">
                Sensores Emparejados ({props.devices.length})
              </h2>
              {props.devices.length === 0 ? (
                <div className="rounded-2xl bg-slate-950/60 border border-white/[0.06] p-5 text-xs text-slate-400">
                  Aún no hay sensores creados. Genera uno a la izquierda para conectar tu Android ({activeBankShort}) o Gmail.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {props.devices.map((d) => (
                    <div
                      key={d.id}
                      className="rounded-2xl bg-slate-950/75 border border-white/10 p-4 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-white">
                            {d.name}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-bold text-slate-300">
                            {d.channelType}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                              d.active
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-slate-700 text-slate-300"
                            }`}
                          >
                            {d.active ? "ACTIVO" : "PAUSADO"}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          ID: {d.deviceIdentifier} · Latido:{" "}
                          {shortDate(d.lastHeartbeatAt)}
                          {d.batteryLevel !== null ? ` · 🔋 ${d.batteryLevel}%` : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await toggleBotDeviceAction({
                              deviceId: d.id,
                              active: !d.active,
                            });
                            router.refresh();
                          }}
                          className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-bold text-white"
                        >
                          {d.active ? "Pausar" : "Activar"}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteBotDeviceAction(d.id);
                            toast.success("Sensor eliminado");
                            router.refresh();
                          }}
                          className="p-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300"
                          aria-label="Eliminar sensor"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Copy-Paste Setup Guides */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* MacroDroid Card */}
            <div className="rounded-3xl apple-glass p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span>Guía Rápida MacroDroid (Notificaciones Push {activeBankShort})</span>
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    void copyText("macro_json", macroDroidBodySnippet, "JSON MacroDroid")
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 text-[11px] font-bold text-white"
                >
                  <Copy className="w-3 h-3" /> Copiar JSON
                </button>
              </div>
              <ol className="text-xs text-slate-300 space-y-1.5 list-decimal pl-4 leading-relaxed">
                <li>
                  Trigger: <strong>Notificación Recibida</strong> → elige únicamente la app del banco (ej. <strong>BDVApp / BDV Digital</strong>). No necesitas SMS.
                </li>
                <li>
                  Action: <strong>HTTP Request (POST)</strong> hacia{" "}
                  <code className="text-emerald-300">{props.siteUrl}/api/bot/ingest</code>
                </li>
                <li>
                  Cabeceras: <code className="text-sky-300">X-Bot-Device-Id: {activeDeviceIdentifier}</code> y <code className="text-sky-300">X-Bot-Token</code> con tu secreto.
                </li>
                <li>
                  Body: elige <strong>Tipo de contenido: application/json</strong> y pega el bloque en <strong>Texto</strong> (o usa <strong>Parámetros</strong> con los mismos campos). Si usas JSON, asegúrate de que los comodines tengan <strong>corchetes `[...]`</strong> insertados desde el botón <code className="text-amber-300">...</code> Magic Text (nunca llaves <code>{"{...}"}</code>).
                </li>
                <li>
                  Heartbeat recomendado: Macro cada 5 min haciendo <code className="text-emerald-300">POST {props.siteUrl}/api/bot/heartbeat</code>.
                </li>
              </ol>
              <pre className="rounded-2xl bg-slate-950 border border-white/10 p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                {macroDroidBodySnippet}
              </pre>
            </div>

            {/* Google Apps Script Card */}
            <div className="rounded-3xl apple-glass p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-white flex items-center gap-2">
                  <Mail className="w-4 h-4 text-sky-400" />
                  <span>Respaldo Google Apps Script (Gmail con HMAC-SHA256)</span>
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    void copyText("gas_code", googleAppsScriptSnippet, "Google Apps Script")
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 text-[11px] font-bold text-white"
                >
                  <Copy className="w-3 h-3" /> Copiar Script
                </button>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Ideal si activas alertas por correo en {activeBankShort}: corre gratis en Google Cloud cada 1 minuto con firma criptográfica HMAC-SHA256.
              </p>
              <pre className="rounded-2xl bg-slate-950 border border-white/10 p-3 text-[10px] font-mono text-sky-200 overflow-x-auto max-h-60">
                {googleAppsScriptSnippet}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: LIVE PARSER SIMULATOR */}
      {activeTab === "simulator" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleRunSimulator}
            className="lg:col-span-6 rounded-3xl apple-glass p-6 space-y-4"
          >
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-sky-400" />
              <span>Simulador de Texto Bancario (Sin modificar la BD)</span>
            </h2>

            <div className="flex flex-wrap gap-2">
              {[
                {
                  label: "App BDV (PagomóvilBDV)",
                  title: "PagomóvilBDV",
                  content:
                    "Has recibido un pago por concepto de PagomovilBDV por Bs. 1.250,45 de 0414-5559988 Banco 0134 Ref: 84930219",
                  pkg: "com.bancodevenezuela.bdvdigital",
                  src: "APP_PUSH" as const,
                },
                {
                  label: "Bancamiga OK",
                  title: "Pago Móvil Recibido",
                  content:
                    "Has recibido un Pago Movil de V-20111222 0412-5559988 Banesco (0134) por Bs. 1.250,45 Ref: 84930219",
                  pkg: "com.bancamiga.suite",
                  src: "APP_PUSH" as const,
                },
                {
                  label: "SMS Mercantil",
                  title: "SMS",
                  content:
                    "MERCANTIL: Recibiste Pago Movil de 04141112233 por Bs 865.00 Ref 00391827",
                  pkg: "SMS",
                  src: "SMS" as const,
                },
                {
                  label: "Débito Saliente (Ignorar)",
                  title: "PagomóvilBDV",
                  content:
                    "Realizaste un PagomovilBDV exitoso por Bs. 500,00 Ref: 77441122",
                  pkg: "com.bancodevenezuela.bdvdigital",
                  src: "APP_PUSH" as const,
                },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setSimTitle(preset.title);
                    setSimContent(preset.content);
                    setSimPackage(preset.pkg);
                    setSimSource(preset.src);
                  }}
                  className="px-3 py-1 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-bold text-slate-200"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Título
                </label>
                <input
                  type="text"
                  value={simTitle}
                  onChange={(e) => setSimTitle(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Package Android / Canal
                </label>
                <input
                  type="text"
                  value={simPackage}
                  onChange={(e) => setSimPackage(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs font-mono text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Cuerpo de la notificación
              </label>
              <textarea
                rows={4}
                value={simContent}
                onChange={(e) => setSimContent(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs font-mono text-white"
              />
            </div>

            <button
              type="submit"
              disabled={busyKey === "sim"}
              className="w-full py-3 rounded-2xl bg-white hover:bg-sky-300 text-slate-950 font-black text-xs"
            >
              Probar Extracción de Campos
            </button>
          </form>

          <div className="lg:col-span-6 rounded-3xl apple-glass p-6 space-y-3">
            <h3 className="text-sm font-black text-white">
              Resultado del Motor Parser
            </h3>
            <pre className="rounded-2xl bg-slate-950 border border-white/10 p-4 text-xs font-mono text-emerald-300 overflow-x-auto">
              {simResult
                ? JSON.stringify(simResult, null, 2)
                : "// Haz clic en 'Probar Extracción de Campos' para ver cómo el parser interpreta el texto."}
            </pre>
          </div>
        </div>
      )}

      {/* MANUAL CONFIRM MODAL */}
      {confirmTargetOrder && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleManualConfirmSubmit}
            className="w-full max-w-md rounded-3xl bg-[#11131c] border border-white/15 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-black text-white">
                  Aprobar Orden #{confirmTargetOrder.orderNumber}
                </h3>
                <p className="text-xs text-slate-400">
                  Estado actual: {confirmTargetOrder.status} · Total:{" "}
                  {formatCents(confirmTargetOrder.amountDueCents)} USD (
                  {formatBs(confirmTargetOrder.totalBsCents)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmTargetOrder(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            {unmatchedNotifications.length > 0 && (
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Opcional: Vincular notificación bancaria recibida
                </label>
                <select
                  value={manualNotifId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setManualNotifId(id);
                    const found = unmatchedNotifications.find((n) => n.id === id);
                    if (found) {
                      if (found.referenceFull) setManualRef(found.referenceFull);
                      if (found.amountBsCents) {
                        setManualPaidBs((found.amountBsCents / 100).toFixed(2));
                      }
                    }
                  }}
                  className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
                >
                  <option value="">-- Ingresar referencia manual --</option>
                  {unmatchedNotifications.map((n) => (
                    <option key={n.id} value={n.id}>
                      Ref {n.referenceFull} · {formatBs(n.amountBsCents)} ({n.sourceType})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Número de referencia bancaria
              </label>
              <input
                type="text"
                required={!manualNotifId}
                value={manualRef}
                onChange={(e) => setManualRef(e.target.value)}
                placeholder="Ej. 84930219"
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs font-mono text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Monto recibido en Bs (ej. 1250.45)
              </label>
              <input
                type="text"
                value={manualPaidBs}
                onChange={(e) => setManualPaidBs(e.target.value)}
                placeholder="Deja vacío para usar el total esperado"
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs font-mono text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Nota de auditoría
              </label>
              <input
                type="text"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                placeholder={`Verificado en app ${activeBankShort}`}
                className="w-full rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
              />
            </div>

            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-[11px] text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <span>
                Al aprobar, se registrará el reclamo único de esta referencia y se disparará la entrega automática de gift cards.
              </span>
            </div>

            <button
              type="submit"
              disabled={busyKey === "manual_confirm"}
              className="w-full py-3 rounded-2xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs"
            >
              {busyKey === "manual_confirm"
                ? "Liberando códigos..."
                : "Confirmar Pago y Liberar Códigos"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
