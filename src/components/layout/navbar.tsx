"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/context/store-context";
import { formatCents } from "@/lib/catalog-seed";
import {
  Gamepad2,
  HelpCircle,
  KeyRound,
  LogOut,
  Shield,
  ShoppingBag,
  Sparkles,
  User,
} from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const {
    cartCount,
    setCartDrawerOpen,
    sessionUser,
    creditBalanceCents,
    signOut,
  } = useStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  const navLinks = [
    { href: "/", label: "Catálogo", icon: Gamepad2 },
    { href: "/account", label: "Mis Códigos", icon: KeyRound },
    { href: "/ayuda", label: "Ayuda", icon: HelpCircle },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.08] bg-[#08090e]/80 backdrop-blur-2xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 group-hover:scale-105 transition-transform">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-base font-black tracking-tight text-white block leading-none">
              StoryCheap
            </span>
            <span className="text-[10px] font-semibold text-slate-400 tracking-wide">
              Gift Cards Oficiales
            </span>
          </div>
        </Link>

        {/* Center Nav */}
        <nav className="hidden md:flex items-center gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
          {navLinks.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/" || pathname.startsWith("/card/")
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  isActive
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          {mounted && sessionUser?.role === "admin" && (
            <Link
              href="/admin"
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                pathname.startsWith("/admin")
                  ? "bg-amber-400 text-slate-950"
                  : "text-amber-300 hover:bg-amber-500/15"
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Admin</span>
            </Link>
          )}
        </nav>

        {/* Right Controls: Account / Credit Badge + Cart Drawer Trigger */}
        <div className="flex items-center gap-2.5">
          {mounted && sessionUser ? (
            <div className="flex items-center gap-2">
              <Link
                href="/account"
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 text-xs transition-colors"
              >
                <User className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-semibold text-slate-200 max-w-[140px] truncate">
                  {sessionUser.email}
                </span>
                {creditBalanceCents > 0 && (
                  <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 font-bold text-[10px]">
                    Saldo: {formatCents(creditBalanceCents)}
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] border border-white/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-slate-200 transition-colors"
            >
              Entrar
            </Link>
          )}

          {/* Cart Button */}
          <button
            type="button"
            onClick={() => setCartDrawerOpen(true)}
            className="relative flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white text-slate-950 hover:bg-sky-300 text-xs font-black transition-all shadow-md"
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="hidden sm:inline">Carrito</span>
            {mounted && cartCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-slate-950 text-white text-[10px] font-black">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
