export interface VenezuelanBankOption {
  code: string;
  name: string;
  shortName: string;
}

export const VENEZUELAN_BANKS: VenezuelanBankOption[] = [
  { code: "0172", name: "Bancamiga Banco Universal", shortName: "Bancamiga" },
  { code: "0102", name: "Banco de Venezuela", shortName: "BDV" },
  { code: "0134", name: "Banesco Banco Universal", shortName: "Banesco" },
  { code: "0105", name: "Banco Mercantil", shortName: "Mercantil" },
  { code: "0108", name: "BBVA Provincial", shortName: "Provincial" },
  { code: "0191", name: "Banco Nacional de Crédito (BNC)", shortName: "BNC" },
  { code: "0115", name: "Banco Exterior", shortName: "Exterior" },
  { code: "0114", name: "Bancaribe", shortName: "Bancaribe" },
  { code: "0138", name: "Banco Plaza", shortName: "Banco Plaza" },
  { code: "0151", name: "Banco Fondo Común (BFC)", shortName: "BFC" },
  { code: "0163", name: "Banco del Tesoro", shortName: "Tesoro" },
  { code: "0174", name: "Banplus", shortName: "Banplus" },
  { code: "0175", name: "Banco Digital de los Trabajadores (BDT)", shortName: "BDT" },
  { code: "0171", name: "Banco Activo", shortName: "Activo" },
  { code: "0168", name: "Bancrecer", shortName: "Bancrecer" },
  { code: "0169", name: "R4 Banco Microfinanciero", shortName: "R4" },
  { code: "0156", name: "100% Banco", shortName: "100% Banco" },
  { code: "0128", name: "Banco Caroní", shortName: "Caroní" },
  { code: "0137", name: "Banco Sofitasa", shortName: "Sofitasa" },
  { code: "0177", name: "BANFANB", shortName: "BANFANB" },
  { code: "0178", name: "N58 Banco Digital", shortName: "N58" },
  { code: "0146", name: "Bangente", shortName: "Bangente" },
  { code: "0104", name: "Banco Venezolano de Crédito", shortName: "BVC" },
];

export const BANK_BY_CODE = new Map(VENEZUELAN_BANKS.map((b) => [b.code, b]));

export const DEFAULT_ANDROID_PACKAGES_BY_BANK: Record<string, string[]> = {
  "0172": ["com.bancamiga.suite", "com.bancamiga", "com.bancamiga.mobile", "SMS", "EMAIL"],
  "0102": [
    "com.bancodevenezuela.bdvdigital",
    "com.bdv.personas",
    "ve.com.bancodevenezuela.bdvenlinea",
    "com.bancodevenezuela",
    "SMS",
    "EMAIL",
  ],
  "0134": ["com.banesco.banescoMovil", "com.banesco.pagoMovil", "SMS", "EMAIL"],
  "0105": ["com.mercantil.movil", "com.mercantil.tpago", "SMS", "EMAIL"],
};

const BANK_KEYWORD_RULES: Array<{ code: string; pattern: RegExp }> = [
  { code: "0172", pattern: /\bbancamiga\b/i },
  { code: "0102", pattern: /\bbanco\s+de\s+venezuela\b|\bpagom[oó]vil\s*bdv\b|\bbdv\s*(?:app|digital)\b|\bbdv\b/i },
  { code: "0134", pattern: /\bbanesco\b/i },
  { code: "0105", pattern: /\bmercantil\b|\btpago\b/i },
  { code: "0108", pattern: /\bprovincial\b|\bbbva\b/i },
  { code: "0191", pattern: /\bbnc\b|\bnacional\s+de\s+cr[eé]dito\b/i },
  { code: "0115", pattern: /\bbanco\s+exterior\b|\bexterior\b/i },
  { code: "0114", pattern: /\bbancaribe\b/i },
  { code: "0138", pattern: /\bbanco\s+plaza\b|\bplaza\b/i },
  { code: "0151", pattern: /\bbfc\b|\bfondo\s+com[uú]n\b/i },
  { code: "0163", pattern: /\bdel\s+tesoro\b|\btesoro\b/i },
  { code: "0174", pattern: /\bbanplus\b/i },
  { code: "0175", pattern: /\bbdt\b|\bbanco\s+digital\s+de\s+los\s+trabajadores\b|\bbicentenario\b/i },
  { code: "0171", pattern: /\bbanco\s+activo\b/i },
  { code: "0168", pattern: /\bbancrecer\b/i },
  { code: "0169", pattern: /\br4\b|\bmi\s+banco\b/i },
  { code: "0156", pattern: /\b100%\s*banco\b/i },
  { code: "0128", pattern: /\bcaron[ií]\b/i },
  { code: "0137", pattern: /\bsofitasa\b/i },
  { code: "0177", pattern: /\bbanfanb\b/i },
  { code: "0178", pattern: /\bn58\b/i },
  { code: "0146", pattern: /\bbangente\b/i },
  { code: "0104", pattern: /\bvenezolano\s+de\s+cr[eé]dito\b|\bbvc\b/i },
];

export function findBankCodeInText(
  text: string,
  excludeBankCode?: string | null
): string | null {
  const candidates: Array<{ code: string; index: number }> = [];

  for (const m of text.matchAll(/\b(01\d{2})\b/g)) {
    const code = m[1];
    if (BANK_BY_CODE.has(code) && typeof m.index === "number") {
      candidates.push({ code, index: m.index });
    }
  }

  for (const rule of BANK_KEYWORD_RULES) {
    const m = text.match(rule.pattern);
    if (m && typeof m.index === "number") {
      candidates.push({ code: rule.code, index: m.index });
    }
  }

  candidates.sort((a, b) => a.index - b.index);
  for (const c of candidates) {
    if (excludeBankCode && c.code === excludeBankCode) continue;
    return c.code;
  }
  return null;
}

export function normalizeVePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^58(4\d{9})$/.test(digits)) {
    return `0${digits.slice(2)}`;
  }
  if (/^0(4\d{9})$/.test(digits)) {
    return digits;
  }
  if (/^(4\d{9})$/.test(digits)) {
    return `0${digits}`;
  }
  return null;
}
