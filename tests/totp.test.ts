import { test } from "node:test";
import assert from "node:assert/strict";
import { b32decode, b32encode, hotp, totpMatch, totpNow } from "../lib/totp.ts";

// متجهات الاختبار الرسمية من RFC 6238 (SHA1، السر "12345678901234567890")، آخر ستة أرقام
const KEY = Buffer.from("12345678901234567890");
const SECRET = b32encode(KEY);

test("ترميز Base32 عكسي", () => {
  assert.equal(SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(b32decode(SECRET), KEY);
});

test("رموز RFC 6238", () => {
  for (const [sec, code] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"]] as const) {
    assert.equal(hotp(KEY, Math.floor(sec / 30)), code);
    assert.equal(totpNow(SECRET, sec * 1000), code);
  }
});

test("يقبل الفترة الحالية والمجاورة فقط", () => {
  const now = 1234567890 * 1000;
  const step = Math.floor(1234567890 / 30);
  assert.equal(totpMatch(SECRET, "005924", 0, now), step);
  assert.equal(totpMatch(SECRET, totpNow(SECRET, now - 30_000), 0, now), step - 1);
  assert.equal(totpMatch(SECRET, totpNow(SECRET, now + 30_000), 0, now), step + 1);
  assert.equal(totpMatch(SECRET, totpNow(SECRET, now - 90_000), 0, now), null);
  assert.equal(totpMatch(SECRET, "000000", 0, now), null);
  assert.equal(totpMatch(SECRET, "12345", 0, now), null);
});

test("يرفض إعادة استخدام الرمز", () => {
  const now = 1234567890 * 1000;
  const step = Math.floor(1234567890 / 30);
  assert.equal(totpMatch(SECRET, "005924", step, now), null);
  assert.equal(totpMatch(SECRET, "005924", step - 1, now), step);
});
