import React from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { StoreProvider } from "@/context/store-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StoryCheap — Gift Cards Oficiales al Instante",
  description:
    "Compra tarjetas de regalo oficiales de PlayStation, Nintendo, Xbox, Steam, Roblox, Free Fire y streaming con entrega automática y pago cripto seguro.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col bg-[#08090e] text-[#f5f6fa]`}
      >
        <StoreProvider>
          <Navbar />
          <CartDrawer />
          <main className="flex-1">{children}</main>
          <Footer />
          <Toaster
            theme="dark"
            position="bottom-left"
            toastOptions={{
              className: "apple-glass text-white border border-white/15",
            }}
          />
        </StoreProvider>
      </body>
    </html>
  );
}
