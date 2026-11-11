"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "@/context/store-context";
import { formatCents } from "@/lib/catalog-seed";
import type { CreditLedgerEntryDTO, OrderDTO } from "@/types";
import {
  ArrowRight,
  KeyRound,
  Lock,
  Receipt,
  ShoppingBag,
  Wallet,
} from "lucide-react";

type AccountTab = "orders" | "codes" | "credit";

const REASON_LABELS: Record<CreditLedgerEntryDTO["reason"], string> = {
  overpayment: "Excedente de pago",
  partial_payment: "Pago parcial acreditado",
  fulfillment_refund: "Reembolso por orden no entregada",
  checkout_apply: "Aplicado en checkout",
  admin_adjust: "Ajuste manual de soporte",
};

export default function AccountPage() {
  const { sessionUser, isSessionLoading } = useStore();
  const [tab, setTab] = useState<AccountTab>("orders");
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [ledger, setLedger] = useState<CreditLedgerEntryDTO[]>([]);
  const [creditBalanceCents, setCreditBalanceCents] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/account/summary", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            orders?: OrderDTO[];
            ledger?: CreditLedgerEntryDTO[];
            creditBalanceCents?: number;
          } | null
        ) => {
          if (!active || !data) return;
          setOrders(data.orders ?? []);
          setLedger(data.ledger ?? []);
          setCreditBalanceCents(Number(data.creditBalanceCents ?? 0));
        }
      )
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionUser?.id]);

  if (!isSessionLoading && !sessionUser) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <Lock className="w-10 h-10 text-sky-400 mx-auto" />
        <h1 className="text-2xl font-black text-white">Inicia sesión en tu cuenta</h1>
        <p className="text-xs text-slate-400 leading-relaxed">
          Necesitas verificar tu correo electrónico para acceder a tus órdenes, revelar códigos comprados y revisar tu saldo a favor.
        </p>
        <Link
          href="/login?next=/account"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-slate-950 font-black text-xs"
        >
          <span>Ir a iniciar sesión</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  const allFulfillments = orders.flatMap((o) =>
    o.fulfillments.map((f) => ({ ...f, orderNumber: o.orderNumber }))
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Header */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 flex flex-wrap items-center justify-between gap-6">
        <div>
          <span className="text-[11px] font-black uppercase tracking-wider text-sky-400">
            Mi Cuenta • Bóveda Segura
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-white mt-1">
            {sessionUser?.email ?? "Cargando..."}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Todos tus códigos se mantienen cifrados con AES-256-GCM en el servidor hasta que los reveles.
          </p>
        </div>

        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 px-5 py-4 min-w-[220px]">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300 block">
            Saldo a favor interno
          </span>
          <div className="text-2xl font-black text-white mt-0.5">
            {formatCents(creditBalanceCents)}{" "}
            <span className="text-xs text-slate-400 font-bold">USD</span>
          </div>
          <span className="text-[10px] text-emerald-200/80 block mt-1">
            Aplicable automáticamente en tu próximo checkout
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] w-fit">
        <button
          type="button"
          onClick={() => setTab("orders")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            tab === "orders"
              ? "bg-white text-slate-950 shadow-md"
              : "text-slate-300 hover:text-white"
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Mis órdenes ({orders.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("codes")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            tab === "codes"
              ? "bg-white text-slate-950 shadow-md"
              : "text-slate-300 hover:text-white"
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Mis códigos ({allFulfillments.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("credit")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            tab === "credit"
              ? "bg-white text-slate-950 shadow-md"
              : "text-slate-300 hover:text-white"
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Saldo a favor ({ledger.length})</span>
        </button>
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="rounded-3xl apple-glass p-10 text-center text-xs text-slate-400">
          Cargando historial...
        </div>
      ) : tab === "orders" ? (
        <div className="space-y-3">
          {orders.length === 0 ? (
            <div className="rounded-3xl apple-glass p-12 text-center space-y-3">
              <ShoppingBag className="w-8 h-8 text-slate-500 mx-auto" />
              <h2 className="text-base font-bold text-white">
                Todavía no tienes órdenes
              </h2>
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-slate-950 font-black text-xs"
              >
                Explorar Gift Cards
              </Link>
            </div>
          ) : (
            orders.map((o) => (
              <Link
                key={o.id}
                href={`/order/${o.id}`}
                className="block rounded-2xl apple-glass hover:border-white/25 p-5 transition-all"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-mono text-slate-400">
                      {o.orderNumber} • {new Date(o.createdAt).toLocaleString()}
                    </div>
                    <div className="text-sm font-black text-white mt-1">
                      {o.items
                        .map((i) => `${i.productName} (${i.denominationLabel}) ×${i.quantity}`)
                        .join(", ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="px-3 py-1 rounded-xl bg-white/[0.06] border border-white/10 text-xs font-bold text-sky-300">
                      {o.status}
                    </span>
                    <div className="text-right">
                      <div className="text-sm font-black text-white">
                        {formatCents(o.subtotalCents)} USD
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      ) : tab === "codes" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {allFulfillments.length === 0 ? (
            <div className="md:col-span-2 rounded-3xl apple-glass p-12 text-center text-xs text-slate-400">
              Aún no tienes códigos entregados en tu bóveda.
            </div>
          ) : (
            allFulfillments.map((f) => (
              <div
                key={f.id}
                className="rounded-2xl apple-glass p-5 flex items-center justify-between gap-4"
              >
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    Orden {f.orderNumber} • {f.region}
                  </span>
                  <h3 className="text-sm font-black text-white mt-0.5">
                    {f.productName}
                  </h3>
                  <p className="text-xs text-sky-400 font-bold">
                    {f.denominationLabel}
                  </p>
                  <p className="text-[11px] text-slate-400 font-mono mt-2">
                    Terminación: ••••-{f.codeLast4}
                  </p>
                </div>

                <Link
                  href={`/order/${f.orderId}`}
                  className="px-4 py-2.5 rounded-xl bg-white hover:bg-sky-300 text-slate-950 font-black text-xs shrink-0"
                >
                  Abrir / Revelar
                </Link>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="rounded-3xl apple-glass overflow-hidden">
          {ledger.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No tienes movimientos registrados en tu saldo a favor interno.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/[0.04] text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="px-5 py-3">Fecha</th>
                    <th className="px-5 py-3">Motivo</th>
                    <th className="px-5 py-3">Nota</th>
                    <th className="px-5 py-3 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-5 py-3.5 text-slate-400 whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 font-bold text-white">
                        {REASON_LABELS[entry.reason]}
                      </td>
                      <td className="px-5 py-3.5 text-slate-300">
                        {entry.note ?? "—"}
                      </td>
                      <td
                        className={`px-5 py-3.5 font-black text-right whitespace-nowrap ${
                          entry.deltaCents > 0
                            ? "text-emerald-400"
                            : "text-amber-300"
                        }`}
                      >
                        {entry.deltaCents > 0 ? "+" : ""}
                        {formatCents(entry.deltaCents)} USD
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
