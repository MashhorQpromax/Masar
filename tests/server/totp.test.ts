import { afterEach, describe, expect, it } from "vitest";
import { loginCodeHash, newToken, seal, tokenHash, unseal } from "@/server/auth/secret";
import { base32Decode, base32Encode, hotp, newTotpSecret, sameText, totpAt, totpMatch, totpStep, totpUri } from "@/server/auth/totp";

// The official test vectors of RFC 6238 (SHA-1, secret "12345678901234567890"), last six digits.
const KEY = Buffer.from("12345678901234567890");
const SECRET = base32Encode(KEY);
const at = (seconds: number) => new Date(seconds * 1000);

describe("authenticator codes", () => {
  it("encodes Base32 both ways", () => {
    expect(SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(SECRET)).toEqual(KEY);
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq")).toEqual(KEY);
    expect(base32Decode(base32Encode(Buffer.from([1, 2, 3])))).toEqual(Buffer.from([1, 2, 3]));
  });

  it("matches the RFC 6238 vectors", () => {
    for (const [seconds, code] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"]] as const) {
      expect(hotp(KEY, Math.floor(seconds / 30))).toBe(code);
      expect(totpAt(SECRET, at(seconds))).toBe(code);
    }
  });

  it("accepts the current step and its two neighbours only", () => {
    const now = at(1234567890);
    const step = totpStep(now);
    expect(totpMatch(SECRET, "005924", 0, now)).toBe(step);
    expect(totpMatch(SECRET, totpAt(SECRET, at(1234567890 - 30)), 0, now)).toBe(step - 1);
    expect(totpMatch(SECRET, totpAt(SECRET, at(1234567890 + 30)), 0, now)).toBe(step + 1);
    expect(totpMatch(SECRET, totpAt(SECRET, at(1234567890 - 90)), 0, now)).toBeNull();
    expect(totpMatch(SECRET, totpAt(SECRET, at(1234567890 + 90)), 0, now)).toBeNull();
    expect(totpMatch(SECRET, "000000", 0, now)).toBeNull();
    expect(totpMatch(SECRET, "12345", 0, now)).toBeNull();
    expect(totpMatch(SECRET, "0059240", 0, now)).toBeNull();
    expect(totpMatch(SECRET, " 05924", 0, now)).toBeNull();
  });

  it("refuses a code that was already used, and any code older than it", () => {
    const now = at(1234567890);
    const step = totpStep(now);
    expect(totpMatch(SECRET, "005924", step, now)).toBeNull();
    expect(totpMatch(SECRET, "005924", step - 1, now)).toBe(step);
    expect(totpMatch(SECRET, totpAt(SECRET, at(1234567890 - 30)), step, now)).toBeNull();
  });

  it("makes a fresh secret an authenticator app can read", () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(newTotpSecret()).not.toBe(secret);
    const uri = new URL(totpUri(secret, "someone@example.com"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.searchParams.get("secret")).toBe(secret);
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
    expect(decodeURIComponent(uri.pathname)).toContain("someone@example.com");
  });

  it("compares text without caring where it differs", () => {
    expect(sameText("123456", "123456")).toBe(true);
    expect(sameText("123456", "123457")).toBe(false);
    expect(sameText("123456", "12345")).toBe(false);
  });
});

describe("secrets at rest", () => {
  const before = process.env.MASAR_SECRET;
  afterEach(() => {
    process.env.MASAR_SECRET = before;
  });

  it("seals and opens an authenticator secret", () => {
    process.env.MASAR_SECRET = "a-secret-for-these-tests";
    const sealed = seal(SECRET);
    expect(sealed).not.toContain(SECRET);
    expect(seal(SECRET)).not.toBe(sealed);
    expect(unseal(sealed)).toBe(SECRET);
  });

  it("opens what the old system sealed with the same secret", () => {
    // Produced with the old system's formula: AES-256-GCM, key SHA-256("masar-totp:" + secret), iv | tag | text.
    process.env.MASAR_SECRET = "legacy-secret-for-tests";
    expect(unseal("AAECAwQFBgcICQoLwgXmGjNBEH2-9WLVlqDRzZWN9Gw3BSteycoBkMgMABzDTu-qk2KRXsc5m1RfR19a")).toBe(SECRET);
  });

  it("opens nothing with another secret, and nothing that was altered", () => {
    process.env.MASAR_SECRET = "a-secret-for-these-tests";
    const sealed = seal(SECRET);
    const altered = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    expect(unseal(altered)).toBeNull();
    expect(unseal("")).toBeNull();
    expect(unseal(null)).toBeNull();
    expect(unseal("not-a-sealed-value")).toBeNull();
    process.env.MASAR_SECRET = "another-secret-entirely";
    expect(unseal(sealed)).toBeNull();
  });

  it("refuses to work without a secret", () => {
    delete process.env.MASAR_SECRET;
    expect(() => seal(SECRET)).toThrow("MASAR_SECRET");
    process.env.MASAR_SECRET = "short";
    expect(() => loginCodeHash(1, "123456")).toThrow("MASAR_SECRET");
  });

  it("hashes tokens and codes so the stored form opens nothing", () => {
    process.env.MASAR_SECRET = "a-secret-for-these-tests";
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    expect(tokenHash(token)).not.toBe(token);
    expect(tokenHash(token)).toBe(tokenHash(token));
    expect(loginCodeHash(1, "123456")).not.toBe(loginCodeHash(2, "123456"));
    expect(loginCodeHash(1, "123456")).not.toBe(loginCodeHash(1, "123457"));
    process.env.MASAR_SECRET = "another-secret-entirely";
    const other = loginCodeHash(1, "123456");
    process.env.MASAR_SECRET = "a-secret-for-these-tests";
    expect(loginCodeHash(1, "123456")).not.toBe(other);
  });
});
