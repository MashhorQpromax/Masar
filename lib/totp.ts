// رمز تطبيق المصادقة (RFC 6238): دوال حسابية بحتة بلا اعتماد على الخادم، حتى تُختبر مباشرة.
import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function b32encode(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function b32decode(s: string) {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function hotp(key: Buffer, counter: number) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(b).digest();
  const o = h[h.length - 1] & 0xf;
  const v = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return String(v).padStart(6, "0");
}
const STEP = 30;
export const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** يعيد رقم الفترة المطابقة أو null. يقبل الفترة الحالية وما قبلها وما بعدها (فرق ساعة الجوال) ويرفض إعادة استخدام رمز */
export function totpMatch(secretB32: string, code: string, lastStep = 0, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = b32decode(secretB32);
  const cur = Math.floor(now / 1000 / STEP);
  let hit: number | null = null;
  for (const s of [cur - 1, cur, cur + 1]) if (safeEq(hotp(key, s), code) && s > lastStep) hit = s;
  return hit;
}
export const totpNow = (secretB32: string, now = Date.now()) => hotp(b32decode(secretB32), Math.floor(now / 1000 / STEP));

