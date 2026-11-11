"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FileKey2,
  LayoutDashboard,
  PackageSearch,
  PlugZap,
  Receipt,
  ShieldAlert,
  Users,
} from "lucide-react";

interface AdminSidebarProps {
  needsAttentionCount: number;
  lowStockCount: number;
}

export function AdminSidebar({
  needsAttentionCount,
  lowStockCount,
}: AdminSidebarProps) {
  const pathname = usePathname();

  const items = [
    { href: "/admin", label: "Resumen", icon: LayoutDashboard, exact: true },
    {
      href: "/admin/orders",
      label: "Órdenes",
      icon: Receipt,
      badge: needsAttentionCount > 0 ? needsAttentionCount : undefined,
      badgeTone: "bg-rose-500 text-white",
    },
    {
      href: "/admin/inventory",
      label: "Inventario CSV",
      icon: FileKey2,
      badge: lowStockCount > 0 ? lowStockCount : undefined,
      badgeTone: "bg-amber-400 text-slate-950",
    },
    { href: "/admin/products", label: "Productos y Precios", icon: PackageSearch },
    { href: "/admin/customers", label: "Clientes y Saldo", icon: Users },
    { href: "/admin/providers", label: "Pasarelas y Webhooks", icon: PlugZap },
    { href: "/admin/audit", label: "Auditoría", icon: Activity },
  ];

  return (
    <aside className="w-full lg:w-64 shrink-0">
      <div className="rounded-3xl apple-glass p-4 space-y-2 lg:sticky lg:top-24">
        <div className="px-3 py-2 border-b border-white/[0.08] mb-2 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-black uppercase tracking-wider text-white">
            Consola Operativa
          </span>
        </div>

        <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
          {items.map((item) => {
            const Icon = item.icon;
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition-all ${
                  active
                    ? "bg-white text-slate-950 shadow-md"
                    : "text-slate-300 hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black ${item.badgeTone}`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
