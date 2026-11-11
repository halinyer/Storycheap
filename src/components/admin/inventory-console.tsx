"use client";

import React, { useState } from "react";
import {
  commitCsvInventoryAction,
  parseCsvCodesAction,
  voidInventoryCodeAction,
} from "@/app/admin/actions";
import type { CsvPreviewRow } from "@/lib/server/repository";
import type { InventoryItemAdminDTO, ProductDTO } from "@/types";
import {
  Ban,
  CheckCircle2,
  FileUp,
  SearchCheck,
  Shield,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

export function InventoryConsole({
  catalog,
  inventory,
}: {
  catalog: ProductDTO[];
  inventory: InventoryItemAdminDTO[];
}) {
  const variantOptions = catalog.flatMap((p) =>
    p.variants.map((v) => ({
      id: v.id,
      label: `${p.name} — ${v.denominationLabel} (${v.availableStock} disp.)`,
    }))
  );

  const [variantId, setVariantId] = useState(variantOptions[0]?.id ?? "");
  const [batchId, setBatchId] = useState(
    `BATCH-${new Date().toISOString().slice(0, 10)}`
  );
  const [rawCsv, setRawCsv] = useState("");
  const [preview, setPreview] = useState<CsvPreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawCsv(text);
    setPreview(null);
  };

  const handlePreview = async () => {
    if (!rawCsv.trim()) {
      toast.error("Pega tus códigos o selecciona un archivo CSV primero.");
      return;
    }
    setBusy(true);
    try {
      const rows = await parseCsvCodesAction(rawCsv);
      setPreview(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al analizar CSV");
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!variantId || !rawCsv.trim()) return;
    setBusy(true);
    try {
      const res = await commitCsvInventoryAction({
        variantId,
        batchId,
        rawText: rawCsv,
      });
      toast.success(
        `Inyectados ${res.insertedCount} códigos cifrados (${res.skippedDuplicates} duplicados omitidos).`
      );
      setRawCsv("");
      setPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar lote");
    } finally {
      setBusy(false);
    }
  };

  const handleVoid = async (id: string) => {
    setBusy(true);
    try {
      await voidInventoryCodeAction(id);
      toast.success("Código anulado (VOID)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo anular");
    } finally {
      setBusy(false);
    }
  };

  const validCount = preview?.filter((r) => r.status === "valid").length ?? 0;

  return (
    <div className="space-y-8">
      {/* CSV Importer Card */}
      <div className="rounded-3xl apple-glass p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-white flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-sky-400" />
              <span>Cargar Lote de Códigos Propios (Cifrado AES-256)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Formato por línea: <code className="text-sky-300">CODIGO</code> o{" "}
              <code className="text-sky-300">CODIGO,PIN,YYYY-MM-DD</code>. Se detectan duplicados por SHA-256 antes de insertar.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 rounded-full">
            <Shield className="w-3.5 h-3.5" /> Fuente Primaria Segura
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              Variante / Producto
            </label>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="w-full rounded-xl bg-slate-950 border border-white/15 px-3.5 py-2.5 text-xs text-white focus:outline-none"
            >
              {variantOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              Nombre del Lote (Batch ID)
            </label>
            <input
              type="text"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="w-full rounded-xl bg-slate-950 border border-white/15 px-3.5 py-2.5 text-xs text-white focus:outline-none"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-300">
              Códigos CSV o pegado directo
            </label>
            <label className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-bold text-sky-300 cursor-pointer">
              <FileUp className="w-3.5 h-3.5" />
              <span>Subir .csv / .txt</span>
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>
          </div>
          <textarea
            rows={5}
            value={rawCsv}
            onChange={(e) => {
              setRawCsv(e.target.value);
              setPreview(null);
            }}
            placeholder={"PSN-ABCD-1234-9988\nPSN-WXYZ-5678-4411,PIN123,2027-12-31"}
            className="w-full rounded-2xl bg-slate-950 border border-white/15 p-4 font-mono text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || !rawCsv.trim()}
            onClick={() => void handlePreview()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-xs font-bold text-white"
          >
            <SearchCheck className="w-4 h-4 text-sky-400" />
            <span>Previsualizar y validar duplicados</span>
          </button>

          {preview && validCount > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCommit()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Confirmar e inyectar {validCount} válidos</span>
            </button>
          )}
        </div>

        {preview && (
          <div className="rounded-2xl bg-slate-950/90 border border-white/10 overflow-hidden">
            <div className="px-4 py-2.5 bg-white/[0.04] text-[11px] font-bold text-slate-300 flex justify-between">
              <span>Resultado de validación (sin guardar aún)</span>
              <span>
                Válidos: {validCount} / Total filas: {preview.length}
              </span>
            </div>
            <div className="max-h-56 overflow-y-auto divide-y divide-white/[0.06] text-xs">
              {preview.map((r) => (
                <div
                  key={r.rowNumber}
                  className="px-4 py-2.5 flex items-center justify-between gap-4"
                >
                  <span className="font-mono text-slate-300">
                    #{r.rowNumber} • Terminación: ••••-{r.codeLast4}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                      r.status === "valid"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-rose-500/20 text-rose-300"
                    }`}
                  >
                    {r.status === "valid" ? "Válido" : r.reason ?? r.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Vault Inventory Table (NEVER exposes plaintext PIN) */}
      <div className="rounded-3xl apple-glass overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h3 className="text-sm font-black text-white">
            Bóveda de Inventario (Últimos {inventory.length} registros)
          </h3>
          <span className="text-[11px] text-slate-400">
            Solo últimos 4 caracteres visibles
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.04] text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="px-5 py-3">Producto / Variante</th>
                <th className="px-5 py-3">Sufijo</th>
                <th className="px-5 py-3">Lote</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3">Orden</th>
                <th className="px-5 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {inventory.map((row) => (
                <tr key={row.id} className="hover:bg-white/[0.02]">
                  <td className="px-5 py-3.5">
                    <div className="font-bold text-white">{row.productName}</div>
                    <div className="text-[11px] text-slate-400">
                      {row.denominationLabel}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-slate-200">
                    ••••-{row.codeLast4}
                  </td>
                  <td className="px-5 py-3.5 text-slate-400 font-mono text-[11px]">
                    {row.batchId ?? "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                        row.status === "AVAILABLE"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : row.status === "RESERVED"
                          ? "bg-amber-500/20 text-amber-300"
                          : row.status === "DELIVERED"
                          ? "bg-sky-500/20 text-sky-300"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[11px] text-slate-400">
                    {row.deliveredOrderId?.slice(0, 8) ??
                      row.reservedOrderId?.slice(0, 8) ??
                      "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {row.status === "AVAILABLE" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleVoid(row.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 font-bold text-[11px]"
                      >
                        <Ban className="w-3 h-3" />
                        <span>Anular</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
