import type { OrderItemTargetInfo, TargetSchemaField } from "@/types";

const LOGIN_MODE_KEY_PATTERNS = [
  /password/i,
  /passcode/i,
  /passwd/i,
  /account_email/i,
  /login_email/i,
  /login_id/i,
  /login_type/i,
  /login_method/i,
  /cookie/i,
  /two_factor/i,
  /2fa/i,
  /backup_code/i,
];

const DEFAULT_FIELD_LABELS: Record<string, string> = {
  player_id: "ID de Jugador (UID)",
  game_user_id: "ID de Jugador (UID)",
  user_id: "ID de Usuario",
  account_id: "ID de Cuenta",
  zone_id: "ID de Zona / Servidor",
  game_zone_id: "Servidor / Zona",
  server_id: "Servidor",
  server: "Servidor",
  account_server: "Servidor",
  region: "Región / Servidor",
  riot_id: "Riot ID (Nombre#TAG)",
  game_charname: "Nombre del personaje",
  tiktok_user_id: "ID de usuario de TikTok",
};

const DEFAULT_FIELD_PLACEHOLDERS: Record<string, string> = {
  player_id: "Ej. 1234567890",
  game_user_id: "Ej. 1234567890",
  user_id: "Ej. 123456789",
  account_id: "Ej. 123456789",
  zone_id: "Ej. 1234",
  game_zone_id: "Ej. 1234",
  server_id: "Ej. 1234",
  riot_id: "Ej. Jugador#LATAM",
  game_charname: "Nombre exacto en el juego",
};

export function isLoginModeTarget(
  targetFields?: string[] | null,
  targetSchema?: TargetSchemaField[] | null,
  productName?: string | null
): boolean {
  const keys = new Set<string>();
  for (const k of targetFields ?? []) {
    if (typeof k === "string" && k.trim()) keys.add(k.trim());
  }
  for (const field of targetSchema ?? []) {
    if (field?.key) keys.add(field.key.trim());
  }
  for (const key of keys) {
    if (LOGIN_MODE_KEY_PATTERNS.some((re) => re.test(key))) {
      return true;
    }
  }
  if (productName && /\blogin\s*mode\b/i.test(productName)) {
    return true;
  }
  return false;
}

export function getHumanTargetFieldLabel(
  key: string,
  rawLabel?: string | null
): string {
  const trimmed = rawLabel?.trim();
  if (trimmed) return trimmed;
  const known = DEFAULT_FIELD_LABELS[key.toLowerCase()];
  if (known) return known;
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getTargetFieldPlaceholder(key: string): string {
  return (
    DEFAULT_FIELD_PLACEHOLDERS[key.toLowerCase()] ??
    `Ingresa ${getHumanTargetFieldLabel(key)}`
  );
}

/**
 * Normalizes Central One's `target_schema` and `target_fields` into a consistent
 * array of fields. Handles products where `target_schema` is empty even though
 * `target_fields` specifies required keys (e.g. Free Fire Level Up Pass).
 */
export function normalizeTargetSchema(
  targetFields?: string[] | null,
  rawSchema?: Array<{
    key?: unknown;
    label?: unknown;
    type?: unknown;
    options?: unknown;
  }> | null
): TargetSchemaField[] {
  const byKey = new Map<string, TargetSchemaField>();

  if (Array.isArray(rawSchema)) {
    for (const raw of rawSchema) {
      if (!raw || typeof raw !== "object") continue;
      const key = typeof raw.key === "string" ? raw.key.trim() : "";
      if (!key) continue;

      const rawOptions = Array.isArray(raw.options)
        ? raw.options
            .map((opt) => {
              if (typeof opt === "string") {
                const v = opt.trim();
                return v ? { value: v, label: v } : null;
              }
              if (opt && typeof opt === "object") {
                const o = opt as Record<string, unknown>;
                const value = String(o.value ?? "").trim();
                const label = String(o.label ?? value).trim();
                return value ? { value, label: label || value } : null;
              }
              return null;
            })
            .filter((o): o is { value: string; label: string } => Boolean(o))
        : null;

      const hasOptions = Boolean(rawOptions && rawOptions.length > 0);
      const type: "text" | "select" =
        raw.type === "select" || hasOptions ? "select" : "text";
      const label = getHumanTargetFieldLabel(
        key,
        typeof raw.label === "string" ? raw.label : null
      );

      byKey.set(key, {
        key,
        label,
        type,
        options: hasOptions ? rawOptions : null,
      });
    }
  }

  for (const rawKey of targetFields ?? []) {
    if (typeof rawKey !== "string") continue;
    const key = rawKey.trim();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      key,
      label: getHumanTargetFieldLabel(key),
      type: "text",
      options: null,
    });
  }

  return Array.from(byKey.values());
}

export function normalizeTargetPayloadMap(
  raw: Record<string, string> | null | undefined
): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const entries = Object.entries(raw)
    .map(([k, v]) => [k.trim(), typeof v === "string" ? v.trim() : String(v ?? "").trim()] as const)
    .filter(([k, v]) => k.length > 0 && v.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

/**
 * Deterministic key identifying a cart/checkout line so two orders for the same
 * variant but different player IDs never collide or merge together.
 */
export function buildCartLineKey(
  variantId: string,
  targetPayload?: Record<string, string> | null
): string {
  const clean = normalizeTargetPayloadMap(targetPayload);
  const keys = Object.keys(clean);
  if (keys.length === 0) return variantId;
  const serialized = keys.map((k) => `${k}=${clean[k]}`).join("&");
  return `${variantId}::${serialized}`;
}

export function validateTargetPayloadAgainstSchema(
  rawPayload: Record<string, string> | null | undefined,
  schema: TargetSchemaField[]
):
  | { ok: true; cleanPayload: Record<string, string> }
  | { ok: false; error: string } {
  if (schema.length === 0) {
    return {
      ok: false,
      error: "Esta recarga no tiene campos de destino configurados.",
    };
  }

  const input = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const cleanPayload: Record<string, string> = {};

  for (const field of schema) {
    const rawVal = input[field.key];
    const value = typeof rawVal === "string" ? rawVal.trim() : String(rawVal ?? "").trim();
    const displayLabel = getHumanTargetFieldLabel(field.key, field.label);

    if (!value) {
      return {
        ok: false,
        error: `Completa el campo obligatorio "${displayLabel}".`,
      };
    }

    if (value.length > 64) {
      return {
        ok: false,
        error: `El campo "${displayLabel}" excede el máximo de 64 caracteres.`,
      };
    }

    if (field.type === "select" && field.options && field.options.length > 0) {
      const matched = field.options.find((opt) => opt.value === value);
      if (!matched) {
        return {
          ok: false,
          error: `Selecciona una opción válida para "${displayLabel}".`,
        };
      }
      cleanPayload[field.key] = matched.value;
    } else {
      cleanPayload[field.key] = value;
    }
  }

  return { ok: true, cleanPayload };
}

export function formatTargetSummary(
  payload: Record<string, string>,
  schema?: TargetSchemaField[] | null,
  playerName?: string | null
): string {
  const parts: string[] = [];
  const normalizedSchema =
    schema && schema.length > 0
      ? schema
      : Object.keys(payload).map((key) => ({
          key,
          label: getHumanTargetFieldLabel(key),
          type: "text" as const,
          options: null,
        }));

  for (const field of normalizedSchema) {
    const val = payload[field.key];
    if (!val) continue;
    const optLabel =
      field.type === "select" && field.options
        ? field.options.find((o) => o.value === val)?.label ?? val
        : val;
    const label = getHumanTargetFieldLabel(field.key, field.label);
    parts.push(`${label}: ${optLabel}`);
  }

  if (playerName?.trim()) {
    parts.push(`Jugador: ${playerName.trim()}`);
  }

  return parts.join(" · ");
}

export function buildOrderItemTargetInfo(args: {
  payload: Record<string, string>;
  schema?: TargetSchemaField[] | null;
  playerName?: string | null;
  validationStatus?: "valid" | "unverified";
}): OrderItemTargetInfo {
  const cleanPayload = normalizeTargetPayloadMap(args.payload);
  return {
    payload: cleanPayload,
    playerName: args.playerName?.trim() || null,
    validationStatus: args.validationStatus ?? "unverified",
    displaySummary: formatTargetSummary(cleanPayload, args.schema, args.playerName),
    supplierReferenceCode: null,
    topupStatus: "pending",
    topupFailureReason: null,
  };
}
