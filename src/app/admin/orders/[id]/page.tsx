import React, { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { OrderDetailActions } from "@/components/admin/order-detail-actions";
import { computeBdvFeeBreakdown } from "@/lib/bdv-fees";
import { formatCents } from "@/lib/catalog-seed";
import {
  getActiveReceiverBankAccount,
  getMatchedNotificationsForOrder,
  getOrderPagoMovilReport,
  getPagoMovilSettings,
} from "@/lib/server/pagomovil-store";
import {
  getOrderById,
  getZenoBinanceReceiver,
  getZenoPaymentProofForOrder,
  listSupplierItemCostsAdmin,
} from "@/lib/server/repository";
import {
  formatBsCents,
  formatBsRate,
  getOrderSnapshot,
  resolveFulfillmentProvider,
} from "@/lib/server/sales-metrics";
import { AlertTriangle, ArrowLeft, Bitcoin, Shield, Smartphone } from "lucide-react";

async function AdminOrderDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const [order, actualItemCostCents] = await Promise.all([
    getOrderById(id),
    listSupplierItemCostsAdmin(),
  ]);
  if (!order) notFound();
  const snap = getOrderSnapshot(order, actualItemCostCents);

  const [
    zenoReceiver,
    zenoProof,
    activeBank,
    pmReport,
    pmNotifications,
    pmSettings,
  ] = await Promise.all([
    order.paymentGateway === "zenobank" ? getZenoBinanceReceiver() : Promise.resolve(null),
    order.paymentGateway === "zenobank"
      ? getZenoPaymentProofForOrder(order.id)
      : Promise.resolve(null),
    order.paymentGateway !== "zenobank"
      ? getActiveReceiverBankAccount()
      : Promise.resolve(null),
    order.paymentGateway !== "zenobank"
      ? getOrderPagoMovilReport(order.id)
      : Promise.resolve(null),
    order.paymentGateway !== "zenobank"
      ? getMatchedNotificationsForOrder(order.id)
      : Promise.resolve([]),
    order.paymentGateway !== "zenobank"
      ? getPagoMovilSettings()
      : Promise.resolve(null),
  ]);

  const pmExpectedBsCents =
    pmReport?.amountDueBsCents ??
    (order.bsRateCents
      ? Math.round((order.amountDueCents * order.bsRateCents) / 100)
      : order.totalBsCents ?? 0);
  const pmReceivedBsCents = pmNotifications.reduce(
    (acc, n) => acc + (n.amountBsCents ?? 0),
    0
  );
  const pmSurplusBsCents = Math.max(0, pmReceivedBsCents - pmExpectedBsCents);
  const pmMissingBsCents = Math.max(0, pmExpectedBsCents - pmReceivedBsCents);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Volver a Órdenes</span>
      </Link>

      <div className="rounded-3xl apple-glass p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-mono text-slate-400">
              {order.orderNumber} • ID: {order.id}
            </div>
            <h1 className="text-2xl font-black text-white mt-1">
              {order.email}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Gateway: {order.paymentGateway.toUpperCase()} • Checkout ID:{" "}
              {order.gatewayCheckoutId ?? "N/A"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {order.isTest && (
              <span className="px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-400/35 text-xs font-black text-amber-200 uppercase">
                Prueba
              </span>
            )}
            <span className="px-3.5 py-1.5 rounded-xl bg-white/[0.08] border border-white/15 text-xs font-black text-white">
              {order.status}
            </span>
          </div>
        </div>

        {order.needsAttention && (
          <div className="rounded-2xl bg-rose-500/15 border border-rose-500/35 p-4 flex items-start gap-3 text-xs text-rose-100">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <span className="font-black block">Motivo de alerta:</span>
              <span>{order.attentionReason ?? "Revisión operativa requerida"}</span>
            </div>
          </div>
        )}

        {order.paidCents > order.amountDueCents && (
          <div className="rounded-2xl bg-emerald-500/15 border border-emerald-400/35 p-4 flex items-start gap-3 text-xs text-emerald-100">
            <AlertTriangle className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-black text-emerald-200">
                Sobrepago detectado y acreditado al saldo del cliente
              </div>
              <div className="leading-relaxed tabular-nums">
                Recibido:{" "}
                <strong className="text-white">
                  {formatCents(order.paidCents)} USD
                </strong>{" "}
                · Esperado:{" "}
                <strong className="text-white">
                  {formatCents(order.amountDueCents)} USD
                </strong>{" "}
                · Excedente acreditado:{" "}
                <strong className="text-emerald-200">
                  +{formatCents(order.paidCents - order.amountDueCents)} USD
                </strong>
                {order.paymentGateway !== "zenobank" && pmSurplusBsCents > 0 && (
                  <>
                    {" "}
                    (recibido{" "}
                    <strong className="text-white">
                      {formatBsCents(pmReceivedBsCents)}
                    </strong>{" "}
                    vs esperado{" "}
                    <strong className="text-white">
                      {formatBsCents(pmExpectedBsCents)}
                    </strong>{" "}
                    · excedente{" "}
                    <strong className="text-emerald-200">
                      +{formatBsCents(pmSurplusBsCents)}
                    </strong>
                    {order.bsRateCents
                      ? ` a tasa congelada ${formatBsRate(order.bsRateCents)}`
                      : ""}
                    )
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {order.paidCents > 0 && order.paidCents < order.amountDueCents && (
          <div className="rounded-2xl bg-amber-500/15 border border-amber-500/40 p-4 flex items-start gap-3 text-xs text-amber-100">
            <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-black text-amber-200">
                Pago parcial recibido (código retenido)
              </div>
              <div className="leading-relaxed">
                Pagado:{" "}
                <strong className="text-white">
                  {formatCents(order.paidCents)} USD
                </strong>{" "}
                · Total esperado:{" "}
                <strong className="text-white">
                  {formatCents(order.amountDueCents)} USD
                </strong>{" "}
                ·{" "}
                <strong className="text-amber-200">
                  Falta para soltar el código:{" "}
                  {formatCents(order.amountDueCents - order.paidCents)} USD
                </strong>
                . La entrega permanece bloqueada hasta recibir el saldo faltante
                o acreditarlo como saldo interno al cliente.
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Subtotal</span>
            <span className="font-black text-white text-sm">
              {formatCents(order.subtotalCents)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Crédito aplicado</span>
            <span className="font-black text-emerald-400 text-sm">
              {formatCents(order.creditAppliedCents)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Total esperado</span>
            <span className="font-black text-white text-sm">
              {formatCents(order.amountDueCents)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Pagado verificado</span>
            <span className="font-black text-sky-400 text-sm">
              {formatCents(order.paidCents)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">
              {order.paymentGateway === "zenobank"
                ? "Cobro en Bs"
                : "Total cobrado en Bs"}
            </span>
            <span className="font-black text-white text-sm">
              {snap.actualBsCents !== null && snap.bsRateCents !== null
                ? `${formatBsCents(snap.actualBsCents)} (${formatBsRate(snap.bsRateCents)})`
                : "Solo USD / USDT"}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Costo códigos</span>
            <span className="font-black text-slate-200 text-sm">
              {snap.costCents !== null ? formatCents(snap.costCents) : "Sin costo"}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-slate-400 block">Ganancia estimada</span>
            <span
              className={`font-black text-sm ${
                snap.profitCents !== null && snap.profitCents < 0
                  ? "text-rose-400"
                  : "text-emerald-400"
              }`}
            >
              {snap.profitCents !== null ? formatCents(snap.profitCents) : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Cuenta Receptora y Comprobante de Pago */}
      <div className="rounded-3xl apple-glass p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-black text-white flex items-center gap-2">
            {order.paymentGateway === "zenobank" ? (
              <Bitcoin className="w-4 h-4 text-amber-400" />
            ) : (
              <Smartphone className="w-4 h-4 text-sky-400" />
            )}
            <span>Cuenta Receptora y Comprobante</span>
          </h2>
          <Link
            href="/admin/treasury"
            className="text-xs font-semibold text-sky-400 hover:text-sky-300"
          >
            Ver libro de receptoras →
          </Link>
        </div>

        {order.paymentGateway === "zenobank" ? (
          <div className="space-y-3 text-xs">
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] uppercase font-bold text-amber-300">
                  Cuenta Binance / ZenoBank Receptora
                </div>
                {order.paidCents > order.amountDueCents && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/35 text-[10px] font-black text-emerald-200">
                    Sobrepago: +{formatCents(order.paidCents - order.amountDueCents)} USD acreditado
                  </span>
                )}
                {order.paidCents > order.amountDueCents && (
          <div className="rounded-2xl bg-emerald-500/15 border border-emerald-400/35 p-4 flex items-start gap-3 text-xs text-emerald-100">
            <AlertTriangle className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-black text-emerald-200">
                Sobrepago detectado y acreditado al saldo del cliente
              </div>
              <div className="leading-relaxed tabular-nums">
                Recibido:{" "}
                <strong className="text-white">
                  {formatCents(order.paidCents)} USD
                </strong>{" "}
                · Esperado:{" "}
                <strong className="text-white">
                  {formatCents(order.amountDueCents)} USD
                </strong>{" "}
                · Excedente acreditado:{" "}
                <strong className="text-emerald-200">
                  +{formatCents(order.paidCents - order.amountDueCents)} USD
                </strong>
                {order.paymentGateway !== "zenobank" && pmSurplusBsCents > 0 && (
                  <>
                    {" "}
                    (recibido{" "}
                    <strong className="text-white">
                      {formatBsCents(pmReceivedBsCents)}
                    </strong>{" "}
                    vs esperado{" "}
                    <strong className="text-white">
                      {formatBsCents(pmExpectedBsCents)}
                    </strong>{" "}
                    · excedente{" "}
                    <strong className="text-emerald-200">
                      +{formatBsCents(pmSurplusBsCents)}
                    </strong>
                    {order.bsRateCents
                      ? ` a tasa congelada ${formatBsRate(order.bsRateCents)}`
                      : ""}
                    )
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {order.paidCents > 0 && order.paidCents < order.amountDueCents && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/35 text-[10px] font-black text-amber-200">
                    Pago parcial: {formatCents(order.paidCents)} de {formatCents(order.amountDueCents)} USD
                  </span>
                )}
              </div>
              {zenoReceiver ? (
                <>
                  <div className="font-bold text-white">
                    {zenoReceiver.label} — {zenoReceiver.binanceAccount}
                  </div>
                  <div className="text-slate-300">
                    Red: {zenoReceiver.network}
                    {zenoReceiver.storeReference
                      ? ` • Store: ${zenoReceiver.storeReference}`
                      : ""}
                  </div>
                </>
              ) : zenoProof?.transactions?.[0]?.to ? (
                <div className="space-y-1">
                  <div className="font-bold text-emerald-300">
                    Binance Pay ID detectado: {zenoProof.transactions[0].to}
                    {zenoProof.transactions[0].toLabel
                      ? ` (${zenoProof.transactions[0].toLabel})`
                      : ""}
                  </div>
                  <div className="text-slate-300">
                    Red: {zenoProof.transactions[0].tokenId ?? "USDT"}
                    {zenoProof.storeId ? ` • Store: ${zenoProof.storeId}` : ""}
                  </div>
                </div>
              ) : (
                <div className="text-amber-200">
                  No has registrado tu correo/UID de Binance en{" "}
                  <Link href="/admin" className="underline font-bold">
                    Resumen Ejecutivo → Cuentas Receptoras
                  </Link>
                  . Los fondos se liquidaron a la cuenta Binance asociada a tu{" "}
                  <code>ZENOBANK_API_KEY</code>
                  {zenoProof?.storeId ? ` (Store: ${zenoProof.storeId})` : ""}.
                </div>
              )}
              <div className="text-[11px] text-slate-400 pt-1">
                Checkout ZenoBank: <code>{order.gatewayCheckoutId ?? "N/A"}</code>
                {zenoProof?.eventType ? ` • Último evento: ${zenoProof.eventType}` : ""}
              </div>
            </div>

            {zenoProof && zenoProof.transactions.length > 0 ? (
              <div className="space-y-2">
                {zenoProof.transactions.map((tx) => (
                  <div
                    key={tx.uid}
                    className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-emerald-400">
                        {tx.tokenAmount} {tx.tokenId ?? "USDT"}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {tx.networkId ?? "Red ZenoBank"}
                        {tx.createdAt
                          ? ` • ${new Date(tx.createdAt).toLocaleString("es-VE")}`
                          : ""}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-sky-300 break-all">
                      TX / Hash / Binance Order: <strong>{tx.transactionId}</strong>
                      {tx.uid && tx.uid !== tx.transactionId ? ` (UID: ${tx.uid})` : ""}
                    </div>
                    {(tx.toLabel || tx.to) && (
                      <div className="text-slate-200">
                        Destino reportado por ZenoBank:{" "}
                        <strong className="text-white">
                          {tx.toLabel ? `${tx.toLabel} (${tx.to ?? ""})` : tx.to}
                        </strong>
                      </div>
                    )}
                    {(tx.fromLabel || tx.from) && (
                      <div className="text-slate-300">
                        Origen cliente:{" "}
                        <strong className="text-white">
                          {tx.fromLabel ? `${tx.fromLabel} (${tx.from ?? ""})` : tx.from}
                        </strong>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">
                {order.creditAppliedCents >= order.subtotalCents
                  ? "Esta orden se pagó 100% con créditos internos de la tienda (sin movimiento externo en Binance)."
                  : "ZenoBank validó el checkout sin adjuntar un sub-objeto de hash/wallet en el evento."}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/25 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] uppercase font-bold text-sky-300">
                  Cuenta Bancaria Receptora (Pago Móvil)
                </div>
                {order.paidCents > order.amountDueCents && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/35 text-[10px] font-black text-emerald-200 tabular-nums">
                    Sobrepago: +{formatCents(order.paidCents - order.amountDueCents)} USD
                    {pmSurplusBsCents > 0 ? ` (+${formatBsCents(pmSurplusBsCents)})` : ""}
                  </span>
                )}
                {order.paidCents > 0 && order.paidCents < order.amountDueCents && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/35 text-[10px] font-black text-amber-200 tabular-nums">
                    Pago parcial: {formatBsCents(pmReceivedBsCents)} de{" "}
                    {formatBsCents(pmExpectedBsCents)} · Faltan{" "}
                    {formatBsCents(pmMissingBsCents)}
                  </span>
                )}
              </div>
              {activeBank ? (
                <div className="font-bold text-white">
                  {activeBank.bankName} ({activeBank.bankCode}) • {activeBank.phone} •{" "}
                  {activeBank.dni} • {activeBank.holderName}
                </div>
              ) : (
                <div className="text-amber-200">Sin cuenta receptora activa registrada.</div>
              )}
            </div>

            {pmNotifications.length > 0 ? (
              <div className="space-y-2">
                {pmNotifications.map((pmNotif) => {
                  const fee =
                    pmNotif.amountBsCents && pmSettings
                      ? computeBdvFeeBreakdown({
                          grossBsCents: pmNotif.amountBsCents,
                          incomingFeePct: pmSettings.incomingFeePct,
                          outgoingFeePct: pmSettings.outgoingFeePct,
                        })
                      : null;
                  return (
                    <div
                      key={pmNotif.id}
                      className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 space-y-1"
                    >
                      <div className="font-bold text-emerald-300">
                        {pmNotif.sourceType === "BDV_API"
                          ? "Movimiento conciliado vía API Banco de Venezuela"
                          : `Movimiento bancario registrado (${pmNotif.sourceType})`}
                      </div>
                      <div className="text-white tabular-nums">
                        Referencia: <strong>#{pmNotif.referenceFull ?? "N/A"}</strong> •
                        Bruto:{" "}
                        <strong>
                          {pmNotif.amountBsCents
                            ? formatBsCents(pmNotif.amountBsCents)
                            : "N/A"}
                        </strong>
                        {fee && fee.incomingFeePct > 0 && (
                          <>
                            {" "}
                            · Comisión BDV (-{fee.incomingFeePct}%):{" "}
                            <strong className="text-amber-300">
                              -{formatBsCents(fee.incomingFeeBsCents)}
                            </strong>{" "}
                            · Real en BDV:{" "}
                            <strong className="text-emerald-300">
                              {formatBsCents(fee.netCreditedBsCents)}
                            </strong>
                          </>
                        )}
                      </div>
                      <div className="text-slate-300 text-[11px]">
                        Emisor: {pmNotif.senderBankCode ?? "?"} • Tel:{" "}
                        {pmNotif.senderPhone ?? "?"} • CI:{" "}
                        {pmNotif.senderDni ?? "?"}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : pmReport?.reportedReference ? (
              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-1">
                <div className="font-bold text-slate-200">
                  Último intento reportado por el cliente: #{pmReport.reportedReference}
                </div>
                <div className="text-[11px] text-slate-400">
                  Banco origen: {pmReport.reportedSenderBank ?? "?"} • Tel:{" "}
                  {pmReport.reportedSenderPhone ?? "?"}
                  {pmReport.reportedSenderDni
                    ? ` • CI: ${pmReport.reportedSenderDni}`
                    : ""}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">
                Sin movimiento conciliado con API BDV todavía.
              </p>
            )}
          </div>
        )}
      </div>

      <OrderDetailActions
        orderId={order.id}
        status={order.status}
        needsAttention={order.needsAttention}
        paymentGateway={order.paymentGateway}
        hasGatewayCheckoutId={Boolean(order.gatewayCheckoutId)}
        amountDueCents={order.amountDueCents}
        isTest={order.isTest}
        testNote={order.testNote}
      />

      {/* Direct ID / UID Top-Ups (Central One Recargas Directas) */}
      {order.items.some((item) => Boolean(item.targetInfo)) && (
        <div className="rounded-3xl apple-glass p-6 space-y-4 border border-cyan-500/25">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-black text-white">
              Recargas Directas por ID (
              {order.items.filter((item) => Boolean(item.targetInfo)).length})
            </h2>
            <span className="px-2.5 py-1 rounded-full bg-cyan-500/15 border border-cyan-400/30 text-[10px] font-black uppercase text-cyan-200">
              Central One · Direct Top-Up
            </span>
          </div>

          <div className="space-y-2.5">
            {order.items
              .filter((item) => Boolean(item.targetInfo))
              .map((item) => {
                const info = item.targetInfo!;
                const isDone =
                  info.topupStatus === "completed" ||
                  item.deliveredCount >= item.quantity;
                const isFailed =
                  info.topupStatus === "failed" ||
                  info.topupStatus === "refunded";
                return (
                  <div
                    key={item.id}
                    className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-bold text-white">
                        {item.productName} ({item.denominationLabel}) ×{" "}
                        {item.quantity}
                      </div>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                          isDone
                            ? "bg-emerald-500/15 border-emerald-400/35 text-emerald-300"
                            : isFailed
                              ? "bg-rose-500/15 border-rose-400/35 text-rose-300"
                              : "bg-sky-500/15 border-sky-400/35 text-sky-300"
                        }`}
                      >
                        {info.topupStatus ??
                          (isDone ? "completed" : item.status)}
                      </span>
                    </div>

                    <div className="font-mono text-emerald-300 text-[11px] break-all">
                      Destino: {info.displaySummary}
                    </div>

                    {info.playerName && (
                      <div className="text-[11px] text-slate-300">
                        Nickname verificado:{" "}
                        <strong className="text-white">
                          {info.playerName}
                        </strong>
                      </div>
                    )}

                    <div className="text-[11px] text-slate-400 flex flex-wrap gap-3">
                      <span>
                        Entregado:{" "}
                        <strong className="text-white">
                          {item.deliveredCount}/{item.quantity}
                        </strong>
                      </span>
                      {info.supplierReferenceCode && (
                        <span>
                          Ref Central One:{" "}
                          <strong className="font-mono text-sky-300">
                            {info.supplierReferenceCode}
                          </strong>
                        </span>
                      )}
                    </div>

                    {info.topupFailureReason && (
                      <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-[11px] text-rose-200">
                        Error proveedor: {info.topupFailureReason}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Fulfillments (Privacy Enforced: Last 4 Chars Only) */}
      <div className="rounded-3xl apple-glass p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-white">
            Entregas registradas ({order.fulfillments.length})
          </h2>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-300 font-bold">
            <Shield className="w-3.5 h-3.5" />
            Privacidad: PINs ocultos para admin
          </span>
        </div>

        {order.fulfillments.length === 0 ? (
          <p className="text-xs text-slate-400">
            Aún no hay códigos asignados a esta orden.
          </p>
        ) : (
          <div className="space-y-2">
            {order.fulfillments.map((f) => (
              <div
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-4 p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-xs"
              >
                <div>
                  <div className="font-bold text-white">
                    {f.productName} ({f.denominationLabel})
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Origen:{" "}
                    <span className="uppercase text-sky-300 font-bold">
                      {resolveFulfillmentProvider(f)}
                    </span>
                    {f.supplierTxId ? ` (TX: ${f.supplierTxId})` : ""} •
                    Revelado por cliente:{" "}
                    {f.revealedAt
                      ? new Date(f.revealedAt).toLocaleString()
                      : "Pendiente"}
                  </div>
                </div>
                <span className="font-mono font-bold text-slate-200 bg-slate-950 px-3 py-1.5 rounded-lg border border-white/10">
                  ••••-{f.codeLast4}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<div className="text-xs text-slate-400">Cargando detalle...</div>}>
      <AdminOrderDetailContent params={params} />
    </Suspense>
  );
}
