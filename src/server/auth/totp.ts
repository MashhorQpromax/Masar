import crypto from "node:crypto";

/**
 * Authenticator app codes (RFC 6238, SHA-1, six digits, thirty seconds).
 * Pure functions: the time comes in as an argument, so they are tested against the RFC's own vectors.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, "").toUpperCase()) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(key: Uint8Array, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const value = (((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!) % 1_000_000;
  return String(value).padStart(6, "0");
}

/** Compares two strings in a time that does not depend on where they differ. */
export function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export const totpStep = (now: Date): number => Math.floor(now.getTime() / 1000 / STEP_SECONDS);

export const totpAt = (secret: string, now: Date): string => hotp(base32Decode(secret), totpStep(now));

/**
 * The step a code belongs to, or null when it is wrong. The step before and the step after the current
 * one are accepted, because phone clocks drift. A step at or before `lastStep` is refused, so a code
 * that was already used, or one older than it, cannot be used again.
 */
export function totpMatch(secret: string, code: string, lastStep: number, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const current = totpStep(now);
  let hit: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (sameText(hotp(key, step), code) && step > lastStep) hit = step;
  }
  return hit;
}

export const newTotpSecret = (): string => base32Encode(crypto.randomBytes(20));

/** The address an authenticator app reads from a QR code. */
export function totpUri(secret: string, email: string): string {
  const label = encodeURIComponent(`مسار:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("مسار")}&algorithm=SHA1&digits=6&period=30`;
}
