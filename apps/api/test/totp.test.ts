import { describe, expect, it } from "vitest";
import { base32Encode, decryptSecret, encryptSecret, hotp, verifyTotp } from "../src/common/totp.js";

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890", last 6 of the 8-digit codes.
const SECRET = Buffer.from("12345678901234567890");
const VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

describe("totp", () => {
  it("matches the RFC 6238 test vectors", () => {
    for (const [t, code] of VECTORS) {
      expect(hotp(SECRET, BigInt(Math.floor(t / 30)))).toBe(code);
      expect(verifyTotp(base32Encode(SECRET), code, t)).toBe(BigInt(Math.floor(t / 30)));
    }
  });

  it("rejects codes outside ±1 step", () => {
    expect(verifyTotp(base32Encode(SECRET), "287082", 59 + 90)).toBeNull();
  });

  it("round-trips the encrypted secret and detects tampering", () => {
    const key = "11".repeat(32);
    const enc = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(decryptSecret(enc, key)).toBe("JBSWY3DPEHPK3PXP");
    const [iv, tag, ct] = enc.split(".");
    const flipped = Buffer.from(ct!, "base64");
    flipped[0]! ^= 1;
    expect(() => decryptSecret([iv, tag, flipped.toString("base64")].join("."), key)).toThrow();
  });
});
