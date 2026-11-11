import "server-only";
import crypto from "crypto";
import { getCodeEncryptionKeyRaw } from "./env";

const CIPHER_PREFIX = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export function parseEncryptionKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const b64 = Buffer.from(trimmed, "base64");
  if (b64.length === 32) {
    return b64;
  }
  throw new Error(
    "CODE_ENCRYPTION_KEY must be a 64-character hex string or a 32-byte base64 key."
  );
}

/**
 * Encrypts a digital gift card code or PIN using AES-256-GCM with a fresh 96-bit IV.
 */
export function encryptCode(
  plaintext: string,
  overrideKey?: string
): string {
  const normalized = plaintext.trim();
  if (!normalized) {
    throw new Error("Cannot encrypt an empty digital code.");
  }
  const key = parseEncryptionKey(overrideKey ?? getCodeEncryptionKeyRaw());
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    CIPHER_PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a `v1:iv:tag:ciphertext` payload produced by `encryptCode`.
 * Throws on tampering, truncated tag, or wrong key.
 */
export function decryptCode(
  payload: string,
  overrideKey?: string
): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== CIPHER_PREFIX) {
    throw new Error("Invalid encrypted code envelope format.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const key = parseEncryptionKey(overrideKey ?? getCodeEncryptionKeyRaw());
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  if (iv.length !== IV_LENGTH || tag.length !== 16) {
    throw new Error("Corrupted AES-GCM nonce or authentication tag.");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Deterministic SHA-256 hash for duplicate code detection without storing plaintext.
 */
export function sha256CodeHash(code: string): string {
  return crypto.createHash("sha256").update(code.trim(), "utf8").digest("hex");
}

/**
 * Safe suffix for customer history & admin verification views (never exposes full PIN).
 */
export function extractLast4(code: string): string {
  const clean = code.trim().replace(/\s+/g, "");
  if (clean.length <= 4) return clean;
  return clean.slice(-4);
}
