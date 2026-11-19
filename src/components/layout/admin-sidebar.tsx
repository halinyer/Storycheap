"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Building2,
  ChevronRight,
  FileKey2,
  Headset,
  Landmark,
  LayoutDashboard,
  PackageSearch,
  PlugZap,
  Receipt,
  Smartphone,
  Users,
  type LucideIcon,
} from "lucide-react";

interface AdminSidebarProps {
  needsAttentionCount: number;
  lowStockCount: number;
  unhealthySuppliersCount?: number;
  openSupportTicketsCount?: number;
}

interface SidebarNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  badge?: number;
  badgeTone?: string;
}

interface SidebarGroup {
  title: string;
  items: SidebarNavItem[];
}

export function AdminSidebar({
  needsAttentionCount,
  lowStockCount,
  unhealthySuppliersCount = 0,
  openSupportTicketsCount = 0,
}: AdminSidebarProps) {
  const pathname = usePathname();

  const groups: SidebarGroup[] = [
    {
      title: "Dirección",
      items: [
        { href: "/admin", label: "Inicio Ejecutivo", icon: LayoutDashboard, exact: true },
      ],
    },
    {
      title: "Ventas y Operaciones",
      items: [
        {
          href: "/admin/orders",
          label: "Órdenes",
          icon: Receipt,
          badge: needsAttentionCount > 0 ? needsAttentionCount : undefined,
          badgeTone: "bg-rose-500 text-white",
        },
        { href: "/admin/customers", label: "Clientes y Saldos", icon: Users },
        {
          href: "/admin/support",
          label: "Soporte y Tickets",
          icon: Headset,
          badge:
            openSupportTicketsCount > 0 ? openSupportTicketsCount : undefined,
          badgeTone: "bg-sky-400 text-slate-950",
        },
      ],
    },
    {
      title: "Finanzas y Tesorería",
      items: [
        { href: "/admin/banks", label: "Bancos y Cuentas", icon: Building2 },
        { href: "/admin/treasury", label: "Tesorería y Movimientos", icon: Landmark },
        {
          href: "/admin/pagomovil",
          label: "Pago Móvil (BDV)",
          icon: Smartphone,
        },
      ],
    },
    {
      title: "Catálogo y Proveedores",
      items: [
        {
          href: "/admin/products",
          label: "Productos y Recargas",
          icon: PackageSearch,
        },
        {
          href: "/admin/inventory",
          label: "Inventario CSV",
          icon: FileKey2,
          badge: lowStockCount > 0 ? lowStockCount : undefined,
          badgeTone: "bg-amber-400 text-slate-950",
        },
        {
          href: "/admin/providers",
          label: "Distribuidores y APIs",
          icon: PlugZap,
          badge: unhealthySuppliersCount > 0 ? unhealthySuppliersCount : undefined,
          badgeTone: "bg-amber-500 text-slate-950",
        },
      ],
    },
    {
      title: "Sistema",
      items: [
        {
          href: "/admin/audit",
          label: "Auditoría y Logs",
          icon: Activity,
        },
      ],
    },
  ];

  return (
    <aside className="w-full lg:w-[260px] shrink-0">
      <div className="rounded-2xl bg-[#0d101b] border border-white/[0.08] p-3 lg:sticky lg:top-[84px] shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
        <div className="flex lg:flex-col gap-4 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
          {groups.map((group) => (
            <div key={group.title} className="min-w-max lg:min-w-0">
              <div className="hidden lg:block px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                {group.title}
              </div>
              <nav className="flex lg:flex-col gap-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.exact
                    ? pathname === item.href
                    : pathname.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`group flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                        active
                          ? "bg-indigo-500/[0.14] text-white border-indigo-400/30 shadow-[0_4px_18px_rgba(99,102,241,0.14)]"
                          : "border-transparent text-slate-300 hover:text-white hover:bg-white/[0.04]"
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                            active
                              ? "bg-indigo-500/25 text-indigo-300"
                              : "bg-white/[0.04] text-slate-400 group-hover:text-slate-200"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <span className="truncate">{item.label}</span>
                      </span>

                      <span className="flex items-center gap-1.5 shrink-0">
                        {item.badge !== undefined && (
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-black leading-none ${item.badgeTone}`}
                          >
                            {item.badge}
                          </span>
                        )}
                        <ChevronRight
                          className={`hidden lg:block w-3.5 h-3.5 transition-transform ${
                            active
                              ? "text-indigo-300 translate-x-0.5"
                              : "text-slate-600 group-hover:text-slate-400"
                          }`}
                        />
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
