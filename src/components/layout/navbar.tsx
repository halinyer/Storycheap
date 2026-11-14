"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/context/store-context";
import { formatCents } from "@/lib/catalog-seed";
import type { Category } from "@/types";
import {
  ChevronDown,
  Flame,
  Gamepad2,
  HelpCircle,
  KeyRound,
  LogOut,
  Receipt,
  Search,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  User,
  Wallet,
  X,
  Zap,
} from "lucide-react";

const SUBNAV_ITEMS: Array<{
  label: string;
  category?: Category | "ALL";
  href?: string;
  hot?: boolean;
}> = [
  { label: "Tienda", category: "ALL" },
  { label: "Populares", category: "ALL", hot: true },
  { label: "Juegos y Consolas", category: "gaming" },
  { label: "Streaming y Música", category: "streaming" },
  { label: "Apple y Tiendas USA", category: "shopping" },
  { label: "Cripto USDT", category: "crypto" },
  { label: "Mi Bóveda", href: "/account" },
  { label: "Centro de Ayuda", href: "/ayuda" },
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const {
    cartCount,
    setCartDrawerOpen,
    sessionUser,
    creditBalanceCents,
    signOut,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
  } = useStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close profile dropdown on outside click or route change
  useEffect(() => {
    setProfileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        profileRef.current &&
        !profileRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Global Ctrl+K / Cmd+K shortcut to focus top search bar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (pathname !== "/") {
      router.push("/#catalogo");
    }
  };

  const handleCategoryPick = (cat: Category | "ALL", onlyPopular?: boolean) => {
    setSelectedCategory(cat);
    if (onlyPopular) {
      setSearchQuery("");
    }
    if (pathname !== "/") {
      router.push("/#catalogo");
    } else {
      const el = document.getElementById("catalogo");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const userInitial =
    mounted && sessionUser?.email
      ? sessionUser.email.charAt(0).toUpperCase()
      : "U";

  return (
    <header className="sticky top-0 z-40 w-full bg-[#0b0d14]/95 backdrop-blur-2xl border-b border-white/[0.07]">
      {/* Main Header Row: Brand + Wide Search Bar + Utilities & Profile Dropdown */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-6">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-sky-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
            <Sparkles className="w-4 h-4 text-slate-950" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-black tracking-tight text-white leading-none">
              StoryCheap
            </span>
            <span className="hidden sm:inline text-xs font-bold text-indigo-400 tracking-tight">
              gift cards
            </span>
          </div>
        </Link>

        {/* Center CoinGate-style Search Input */}
        <div className="flex-1 max-w-xl">
          <div className="relative flex items-center w-full h-10 rounded-full bg-[#171923] hover:bg-[#1c1f2b] border border-white/[0.08] focus-within:border-indigo-500/60 focus-within:bg-[#1c1f2b] px-3.5 transition-all">
            <Search className="w-4 h-4 text-slate-400 shrink-0 mr-2.5" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar tarjetas: PlayStation, Steam, Netflix, Apple..."
              className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-slate-400 focus:outline-none"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Limpiar búsqueda"
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="hidden sm:flex items-center gap-1 ml-2 shrink-0">
                <kbd className="px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 bg-white/[0.06] border border-white/10 rounded">
                  Ctrl
                </kbd>
                <kbd className="px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 bg-white/[0.06] border border-white/10 rounded">
                  K
                </kbd>
              </div>
            )}
          </div>
        </div>

        {/* Right Utility Bar: Help | USD | ES | Profile Menu | Cart */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link
            href="/ayuda"
            title="Centro de ayuda"
            className="hidden md:inline-flex items-center justify-center w-8 h-8 rounded-full text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
          </Link>

          <div className="hidden lg:flex items-center gap-2.5 text-xs font-bold text-slate-300 border-l border-r border-white/10 px-3 py-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 flex items-center justify-center text-[9px] font-black">
                $
              </span>
              <span>USD</span>
            </span>
            <span className="text-white/20">|</span>
            <span className="text-slate-400">ES</span>
          </div>

          {/* Typical User Profile Trigger + Dropdown */}
          <div className="relative" ref={profileRef}>
            {mounted && sessionUser ? (
              <button
                type="button"
                onClick={() => setProfileOpen((prev) => !prev)}
                className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full bg-[#171923] hover:bg-[#1f2230] border border-white/10 transition-colors"
                aria-expanded={profileOpen}
                aria-label="Menú de cuenta"
              >
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-sky-500 text-white font-black text-xs flex items-center justify-center shadow-sm">
                  {userInitial}
                </span>
                {creditBalanceCents > 0 ? (
                  <span className="hidden sm:inline text-[11px] font-extrabold text-emerald-300">
                    {formatCents(creditBalanceCents)}
                  </span>
                ) : (
                  <span className="hidden sm:inline text-xs font-semibold text-slate-200 max-w-[100px] truncate">
                    {sessionUser.email.split("@")[0]}
                  </span>
                )}
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                    profileOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#171923] hover:bg-[#1f2230] border border-white/10 text-xs font-bold text-slate-200 transition-colors"
              >
                <User className="w-4 h-4 text-indigo-400" />
                <span className="hidden sm:inline">Iniciar sesión</span>
              </Link>
            )}

            {/* Profile Popover Menu */}
            {mounted && sessionUser && profileOpen && (
              <div className="absolute right-0 mt-2.5 w-72 rounded-2xl bg-[#12141d] border border-white/15 shadow-2xl shadow-black/80 py-2 z-50 overflow-hidden">
                {/* User Identity Header */}
                <div className="px-4 py-3 border-b border-white/[0.08]">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-sky-500 text-white font-black text-sm flex items-center justify-center shrink-0">
                      {userInitial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">
                        {sessionUser.email}
                      </p>
                      <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span>
                          {sessionUser.role === "admin"
                            ? "Administrador"
                            : "Cuenta verificada"}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Store Credit Balance Mini-Card inside Profile Menu */}
                  <div className="mt-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-emerald-200 flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Saldo a favor</span>
                    </span>
                    <span className="text-xs font-black text-emerald-300">
                      {formatCents(creditBalanceCents)} USD
                    </span>
                  </div>
                </div>

                {/* Menu Items */}
                <div className="py-1.5 px-1.5 space-y-0.5">
                  <Link
                    href="/account"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-200 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <KeyRound className="w-4 h-4 text-sky-400" />
                    <span>Mi Bóveda y Códigos</span>
                  </Link>

                  <Link
                    href="/account"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-200 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <Receipt className="w-4 h-4 text-indigo-400" />
                    <span>Historial de Órdenes</span>
                  </Link>

                  <Link
                    href="/ayuda"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-200 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <HelpCircle className="w-4 h-4 text-slate-400" />
                    <span>Centro de Ayuda</span>
                  </Link>

                  {sessionUser.role === "admin" && (
                    <div className="pt-1 mt-1 border-t border-white/[0.06]">
                      <Link
                        href="/admin"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 transition-colors"
                      >
                        <span className="flex items-center gap-2.5">
                          <Shield className="w-4 h-4 text-amber-400" />
                          <span>Panel de Administración</span>
                        </span>
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200">
                          Admin
                        </span>
                      </Link>
                    </div>
                  )}
                </div>

                {/* Sign Out Footer */}
                <div className="pt-1.5 mt-1 border-t border-white/[0.08] px-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      void signOut();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 transition-colors text-left"
                  >
                    <LogOut className="w-4 h-4 text-rose-400" />
                    <span>Cerrar sesión</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Cart Trigger */}
          <button
            type="button"
            onClick={() => setCartDrawerOpen(true)}
            aria-label="Abrir carrito"
            className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white text-slate-950 hover:bg-indigo-100 text-xs font-black transition-all shadow-sm"
          >
            <ShoppingBag className="w-4 h-4" />
            {mounted && cartCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-black">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* CoinGate-style Clean Secondary Sub-Navigation Bar */}
      <div className="border-t border-white/[0.05] bg-[#0b0d14]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-10 flex items-center gap-5 sm:gap-7 overflow-x-auto no-scrollbar text-xs font-semibold text-slate-300">
          {SUBNAV_ITEMS.map((item) => {
            if (item.href) {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`whitespace-nowrap transition-colors py-1 ${
                    active
                      ? "text-white font-bold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            }

            const isSelected =
              pathname === "/" &&
              selectedCategory === item.category &&
              !item.hot;

            return (
              <button
                key={item.label}
                type="button"
                onClick={() =>
                  handleCategoryPick(item.category ?? "ALL", item.hot)
                }
                className={`inline-flex items-center gap-1.5 whitespace-nowrap transition-colors py-1 cursor-pointer ${
                  isSelected
                    ? "text-white font-bold"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                {item.hot && (
                  <Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                )}
                {item.category === "gaming" && (
                  <Gamepad2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
