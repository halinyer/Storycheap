import React, { Suspense } from "react";
import { connection } from "next/server";
import { listAuditLogsAdmin } from "@/lib/server/repository";

async function AdminAuditContent() {
  await connection();
  const logs = await listAuditLogsAdmin(150);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">Registro de Auditoría</h1>
        <p className="text-xs text-slate-400 mt-1">
          Historial inmutable (append-only) de importaciones de códigos, revelaciones de clientes y acciones de operadores.
        </p>
      </div>

      <div className="rounded-3xl apple-glass overflow-hidden">
        {logs.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            No hay eventos auditados todavía.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="px-5 py-3">Fecha</th>
                  <th className="px-5 py-3">Actor</th>
                  <th className="px-5 py-3">Acción</th>
                  <th className="px-5 py-3">Objetivo</th>
                  <th className="px-5 py-3">Detalles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {logs.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-5 py-3.5 text-slate-400 whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-slate-200">
                      <span className="uppercase text-[10px] font-bold text-sky-400">
                        {entry.actorRole}
                      </span>
                      <div className="font-mono text-[10px] text-slate-400">
                        {entry.actorId?.slice(0, 8) ?? "system"}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono font-bold text-white">
                      {entry.action}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-slate-300">
                      {entry.targetType}:{entry.targetId.slice(0, 12)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[10px] text-slate-400 max-w-xs truncate">
                      {JSON.stringify(entry.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminAuditPage() {
  return (
    <Suspense fallback={<div className="text-xs text-slate-400">Cargando auditoría...</div>}>
      <AdminAuditContent />
    </Suspense>
  );
}
