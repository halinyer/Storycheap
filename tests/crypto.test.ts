import { describe, expect, it } from "vitest";
import {
  decryptCode,
  encryptCode,
  extractLast4,
  sha256CodeHash,
} from "@/lib/server/crypto";

const KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_KEY_HEX =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("AES-256-GCM Digital Code Vault Crypto", () => {
  it("encrypts and decrypts codes cleanly with unique IV per call", () => {
    const plain = "PSN-9X2K-L8P4-7712";
    const c1 = encryptCode(plain, KEY_HEX);
    const c2 = encryptCode(plain, KEY_HEX);

    expect(c1).not.toEqual(plain);
    expect(c1).not.toEqual(c2);
    expect(decryptCode(c1, KEY_HEX)).toBe(plain);
    expect(decryptCode(c2, KEY_HEX)).toBe(plain);
  });

  it("rejects tampered ciphertext, tampered auth tag, or wrong key", () => {
    const encrypted = encryptCode("STEAM-AAAA-BBBB-CCCC", KEY_HEX);
    const parts = encrypted.split(":");
    const tamperedData = Buffer.from(parts[3], "base64");
    tamperedData[0] ^= 0xff;
    const tamperedPayload = [
      parts[0],
      parts[1],
      parts[2],
      tamperedData.toString("base64"),
    ].join(":");

    expect(() => decryptCode(tamperedPayload, KEY_HEX)).toThrow();
    expect(() => decryptCode(encrypted, OTHER_KEY_HEX)).toThrow();
    expect(() => decryptCode("corrupted", KEY_HEX)).toThrow();
  });

  it("produces deterministic SHA-256 hashes and safe last-4 masks", () => {
    expect(sha256CodeHash("  NIN-1111-2222  ")).toBe(
      sha256CodeHash("NIN-1111-2222")
    );
    expect(extractLast4("ROBLOX-8899-AB12")).toBe("AB12");
  });
});
