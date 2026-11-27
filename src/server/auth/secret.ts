import "server-only";
import crypto from "node:crypto";
import { applicationSecret } from "../site";
import { sameText } from "./totp";

/**
 * The application secret. It seals authenticator secrets at rest and keys the hashes of one-time codes.
 * It is `MASAR_SECRET` when that is set; the production site that has none works one out
 * (`src/server/site.ts`). Anywhere else there is no fallback: without it, sign-in refuses to work.
 */
export function appSecret(): string {
  const secret = applicationSecret();
  if (!secret) throw new Error("MASAR_SECRET is not set");
  return secret;
}

const sealKey = () => crypto.createHash("sha256").update(`masar-totp:${appSecret()}`).digest();

/** Encrypts a short secret for storage (AES-256-GCM). Same format as the old system, so its rows open here. */
export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sealKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Opens what `seal` wrote. Null when it was written with another secret or was altered. */
export function unseal(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const bytes = Buffer.from(sealed, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", sealKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** A random token for a cookie. Only its hash is stored, so a copy of the database opens no session. */
export const newToken = (): string => crypto.randomBytes(32).toString("base64url");

export const tokenHash = (token: string): string => crypto.createHash("sha256").update(token).digest("base64url");

/** The stored form of a one-time code sent to a person. Keyed, so six digits cannot be searched offline. */
export const loginCodeHash = (userId: number, code: string): string =>
  crypto.createHmac("sha256", appSecret()).update(`login-code:${userId}:${code}`).digest("base64url");

export const sameHash = sameText;
