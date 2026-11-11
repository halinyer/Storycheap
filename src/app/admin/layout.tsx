import React, { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AuthError, requireAdminUser } from "@/lib/server/auth";
import { listCatalog, listOrdersAdmin } from "@/lib/server/repository";
import { Lock } from "lucide-react";

async function AdminAuthGate({ children }: { children: React.ReactNode }) {
  await connection();
  try {
    await requireAdminUser();
  } catch (err) {
    const message =
      err instanceof AuthError
        ? err.message
        : "Acceso restringido a operadores autorizados.";
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="text-2xl font-black text-white">Acceso Administrativo</h1>
        <p className="text-xs text-slate-400 leading-relaxed">{message}</p>
        <Link
          href="/login?next=/admin"
          className="inline-flex px-5 py-3 rounded-2xl bg-white text-slate-950 font-black text-xs"
        >
          Iniciar sesión Admin
        </Link>
      </div>
    );
  }

  const [attentionOrders, catalog] = await Promise.all([
    listOrdersAdmin({ needsAttentionOnly: true }),
    listCatalog(true),
  ]);

  const lowStockCount = catalog
    .flatMap((p) => p.variants)
    .filter((v) => v.active && v.availableStock <= v.lowStockThreshold).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <AdminSidebar
          needsAttentionCount={attentionOrders.length}
          lowStockCount={lowStockCount}
        />
        <div className="flex-1 min-w-0 w-full">{children}</div>
      </div>
    </div>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 text-center text-xs text-slate-400">
          Verificando credenciales administrativas...
        </div>
      }
    >
      <AdminAuthGate>{children}</AdminAuthGate>
    </Suspense>
  );
}
