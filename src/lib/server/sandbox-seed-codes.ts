import "server-only";
import { CATALOG_SEED } from "@/lib/catalog-seed";
import { encryptCode, extractLast4, sha256CodeHash } from "./crypto";

export interface SeededSandboxCode {
  id: string;
  variantId: string;
  codeCiphertext: string;
  pinCiphertext: string | null;
  codeHash: string;
  codeLast4: string;
  batchId: string;
}

const BRAND_PREFIX: Record<string, string> = {
  PlayStation: "PSN",
  Nintendo: "NIN",
  Xbox: "XBX",
  Steam: "STM",
  Roblox: "RBX",
  "Garena Free Fire": "FFP",
  Apple: "APL",
  Netflix: "NFX",
  Spotify: "SPT",
  "Razer Gold": "RZR",
  Binance: "BNC",
};

/**
 * Generates encrypted sample inventory rows strictly for non-production Sandbox/Demo mode.
 */
export function buildSandboxInitialInventory(): SeededSandboxCode[] {
  const rows: SeededSandboxCode[] = [];
  let seq = 1;

  for (const product of CATALOG_SEED) {
    const prefix = BRAND_PREFIX[product.brand] || "GFT";
    for (const variant of product.variants) {
      // Seed 5 demo codes per variant (3 for $50 variants so low-stock alerts are realistic)
      const count = variant.faceValueCents >= 5000 ? 3 : 5;
      for (let i = 1; i <= count; i++) {
        const suffix = String(seq).padStart(4, "0");
        const demoCode = `${prefix}-DEMO-${variant.faceValueCents}-${suffix}`;
        rows.push({
          id: `30000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
          variantId: variant.id,
          codeCiphertext: encryptCode(demoCode),
          pinCiphertext: product.brand === "Razer Gold" ? encryptCode(`PIN${suffix}`) : null,
          codeHash: sha256CodeHash(demoCode),
          codeLast4: extractLast4(demoCode),
          batchId: "BATCH-DEMO-INITIAL",
        });
        seq += 1;
      }
    }
  }

  return rows;
}
