import "server-only";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { all, get, run } from "./db";
import { appSecret, clientIp, signToken, verifyToken, type User } from "./auth";
import { WA, sendLoginCodeMessage } from "./wa-cloud";
import { normalizePhone } from "./whatsapp";
import { b32encode, safeEq, totpMatch } from "./totp";

// طرق الدخول الإضافية: مفتاح المرور (WebAuthn)، تطبيق المصادقة (TOTP)، ورمز واتساب.
// القاعدة: لا يُحفظ أي سر بصيغته الصريحة. سر التطبيق مشفّر، والرموز المرسلة تُحفظ بصمتها فقط.

// ===== تطبيق المصادقة =====
const sealKey = () => crypto.createHash("sha256").update("masar-totp:" + appSecret()).digest();
function seal(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", sealKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
function unseal(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const b = Buffer.from(sealed, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", sealKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch { return null; }
}

/** يبدأ ربط تطبيق المصادقة: سر جديد غير مفعّل حتى يؤكده المستخدم برمز */
export async function totpBegin(u: User) {
  const secret = b32encode(crypto.randomBytes(20));
  await run("UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_step = 0 WHERE id = ?", seal(secret), u.id);
  const label = encodeURIComponent(`مسار:${u.email}`);
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("مسار")}&algorithm=SHA1&digits=6&period=30` };
}
/** يتحقق من رمز التطبيق للمستخدم ويسجل الفترة حتى لا يُعاد استخدام الرمز */
export async function totpVerify(uid: number, code: string, opts: { requireEnabled?: boolean } = {}) {
  const r = await get<{ totp_secret: string | null; totp_enabled: number; totp_last_step: number }>("SELECT totp_secret, totp_enabled, totp_last_step FROM users WHERE id = ?", uid);
  if (!r?.totp_secret || (opts.requireEnabled !== false && !r.totp_enabled)) return false;
  const secret = unseal(r.totp_secret);
  if (!secret) return false;
  const step = totpMatch(secret, code.trim(), Number(r.totp_last_step) || 0);
  if (step == null) return false;
  await run("UPDATE users SET totp_last_step = ? WHERE id = ?", step, uid);
  return true;
}
export async function totpConfirm(u: User, code: string) {
  if (!(await totpVerify(u.id, code, { requireEnabled: false }))) return false;
  await run("UPDATE users SET totp_enabled = 1 WHERE id = ?", u.id);
  return true;
}
export async function totpDisable(uid: number) {
  await run("UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?", uid);
}

// ===== رمز واتساب =====
const CODE_MINUTES = 5;
const codeHash = (uid: number, code: string) => crypto.createHmac("sha256", appSecret()).update(`login-code:${uid}:${code}`).digest("base64url");
export const waOtpReady = () => WA.configured;

/** يرسل رمز دخول للمستخدم على واتساب من رقم الشركة. لا يكشف هل الحساب موجود */
export async function sendLoginCode(email: string): Promise<void> {
  if (!WA.configured) return;
  const u = await get<{ id: number; phone: string | null }>("SELECT id, phone FROM users WHERE email = ? AND active = 1", email.trim().toLowerCase());
  const to = normalizePhone(u?.phone);
  if (!u || !to) return;
  const recent = await get<{ n: number }>("SELECT COUNT(*) n FROM login_codes WHERE user_id = ? AND created_at > datetime('now','-15 minutes')", u.id);
  if ((recent?.n ?? 0) >= 3) return;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await run("UPDATE login_codes SET used = 1 WHERE user_id = ? AND used = 0", u.id);
  await run(`INSERT INTO login_codes (user_id, code_hash, expires_at) VALUES (?, ?, datetime('now','+${CODE_MINUTES} minutes'))`, u.id, codeHash(u.id, code));
  const r = await sendLoginCodeMessage(to, code);
  await run("INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, 'login_code_sent', ?, ?)", u.id, r.ok ? "whatsapp" : `فشل: ${r.error}`.slice(0, 300), await clientIp());
}
async function loginCodeVerify(uid: number, code: string) {
  const row = await get<{ id: number; code_hash: string; attempts: number }>(
    "SELECT id, code_hash, attempts FROM login_codes WHERE user_id = ? AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1", uid);
  if (!row || row.attempts >= 5) return false;
  if (!safeEq(row.code_hash, codeHash(uid, code))) {
    await run("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?", row.id);
    return false;
  }
  await run("UPDATE login_codes SET used = 1 WHERE id = ?", row.id);
  return true;
}

export const OTP_MAX_FAILS = 5;
/** الدخول برمز فقط: رمز واتساب أو رمز تطبيق المصادقة. بعد 5 محاولات خاطئة يتوقف حتى يدخل المستخدم بكلمة المرور أو مفتاح المرور */
export async function codeLogin(email: string, code: string): Promise<{ uid: number; method: "whatsapp" | "totp" } | null> {
  const ip = await clientIp();
  const c = code.replace(/\D/g, "");
  const u = await get<{ id: number; otp_fails: number }>("SELECT id, otp_fails FROM users WHERE email = ? AND active = 1", email.trim().toLowerCase());
  if (!u || c.length !== 6) {
    await run("INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, 'login_failed', ?, ?)", u?.id ?? null, u ? "code" : email.slice(0, 120), ip);
    return null;
  }
  if (Number(u.otp_fails) >= OTP_MAX_FAILS) {
    await run("INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, 'login_failed', 'code-locked', ?)", u.id, ip);
    return null;
  }
  const method = (await loginCodeVerify(u.id, c)) ? "whatsapp" as const : (await totpVerify(u.id, c)) ? "totp" as const : null;
  if (!method) {
    await run("UPDATE users SET otp_fails = otp_fails + 1 WHERE id = ?", u.id);
    await run("INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, 'login_failed', 'code', ?)", u.id, ip);
    return null;
  }
  await run("UPDATE users SET otp_fails = 0 WHERE id = ?", u.id);
  return { uid: u.id, method };
}

// ===== مفاتيح المرور (WebAuthn) =====
const CH = "masar_wa_ch";
const PROD_HOSTS = ["masarfin.com", "www.masarfin.com", ...(process.env.MASAR_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean)];
async function rp() {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase();
  const name = host.split(":")[0];
  const prod = process.env.NODE_ENV === "production";
  if (prod && !PROD_HOSTS.includes(name)) throw new Error("مفاتيح المرور غير متاحة على هذا النطاق");
  const proto = h.get("x-forwarded-proto") ?? (name === "localhost" || name === "127.0.0.1" ? "http" : "https");
  return { id: name.endsWith("masarfin.com") ? "masarfin.com" : name, origin: `${proto}://${host}` };
}
async function setChallenge(kind: "reg" | "auth", challenge: string, uid?: number) {
  (await cookies()).set(CH, signToken(`wa-${kind}`, { challenge, uid }, 300), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" && process.env.MASAR_INSECURE_COOKIE !== "1", path: "/", maxAge: 300 });
}
async function takeChallenge(kind: "reg" | "auth") {
  const c = await cookies();
  const t = c.get(CH)?.value;
  c.delete(CH);
  return t ? verifyToken<{ challenge: string; uid?: number }>(`wa-${kind}`, t) : null;
}
type PK = { id: number; user_id: number; credential_id: string; public_key: string; counter: number; transports: string | null; name: string | null; created_at: string; last_used_at: string | null };
export const listPasskeys = (uid: number) => all<Pick<PK, "id" | "name" | "created_at" | "last_used_at">>("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY id", uid);

function deviceName(ua: string) {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "أندرويد" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "جهاز";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

export async function passkeyRegisterOptions(u: User) {
  const { id } = await rp();
  const existing = await all<Pick<PK, "credential_id" | "transports">>("SELECT credential_id, transports FROM passkeys WHERE user_id = ?", u.id);
  const opts = await generateRegistrationOptions({
    rpName: "مسار", rpID: id, userName: u.email, userDisplayName: u.name, userID: new TextEncoder().encode(`masar-user-${u.id}`) as Uint8Array<ArrayBuffer>,
    attestationType: "none",
    excludeCredentials: existing.map((e) => ({ id: e.credential_id, transports: e.transports ? (JSON.parse(e.transports) as AuthenticatorTransportFuture[]) : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await setChallenge("reg", opts.challenge, u.id);
  return opts;
}
export async function passkeyRegisterVerify(u: User, response: RegistrationResponseJSON): Promise<string | null> {
  const ch = await takeChallenge("reg");
  if (!ch || ch.uid !== u.id) return "انتهت المهلة. حاول مرة أخرى.";
  const { id, origin } = await rp();
  let v;
  try { v = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: id, requireUserVerification: true }); }
  catch { return "تعذر التحقق من المفتاح."; }
  if (!v.verified || !v.registrationInfo) return "تعذر التحقق من المفتاح.";
  const c = v.registrationInfo.credential;
  if (await get("SELECT id FROM passkeys WHERE credential_id = ?", c.id)) return "هذا المفتاح مسجل من قبل.";
  const ua = (await headers()).get("user-agent") ?? "";
  await run("INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, name) VALUES (?, ?, ?, ?, ?, ?)",
    u.id, c.id, Buffer.from(c.publicKey).toString("base64url"), c.counter, JSON.stringify(c.transports ?? response.response.transports ?? []), deviceName(ua));
  return null;
}
export async function passkeyDelete(uid: number, id: number) {
  await run("DELETE FROM passkeys WHERE id = ? AND user_id = ?", id, uid);
}

export async function passkeyLoginOptions() {
  const { id } = await rp();
  const opts = await generateAuthenticationOptions({ rpID: id, userVerification: "required" });
  await setChallenge("auth", opts.challenge);
  return opts;
}
/** يعيد رقم المستخدم عند نجاح التحقق */
export async function passkeyLoginVerify(response: AuthenticationResponseJSON): Promise<number | null> {
  const ch = await takeChallenge("auth");
  const ip = await clientIp();
  const fail = async (uid: number | null) => { await run("INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, 'login_failed', 'passkey', ?)", uid, ip); return null; };
  if (!ch || typeof response?.id !== "string") return fail(null);
  const pk = await get<PK & { active: number }>("SELECT p.*, u.active FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.credential_id = ?", response.id);
  if (!pk || !pk.active) return fail(pk?.user_id ?? null);
  const { id, origin } = await rp();
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: id, requireUserVerification: true,
      credential: { id: pk.credential_id, publicKey: new Uint8Array(Buffer.from(pk.public_key, "base64url")), counter: Number(pk.counter), transports: pk.transports ? (JSON.parse(pk.transports) as AuthenticatorTransportFuture[]) : undefined },
    });
  } catch { return fail(pk.user_id); }
  if (!v.verified) return fail(pk.user_id);
  await run("UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE id = ?", v.authenticationInfo.newCounter, pk.id);
  return pk.user_id;
}

/** حالة أمان الحساب لصفحة «حسابي» */
export async function securityState(uid: number) {
  const r = await get<{ phone: string | null; totp_enabled: number; otp_fails: number }>("SELECT phone, totp_enabled, otp_fails FROM users WHERE id = ?", uid);
  return { phone: r?.phone ?? null, totp: !!r?.totp_enabled, codeLocked: Number(r?.otp_fails ?? 0) >= OTP_MAX_FAILS, passkeys: await listPasskeys(uid), waReady: WA.configured };
}
/** يحذف كل طرق الدخول الإضافية ويفك الأقفال (للمدير عند فقدان الجهاز) */
export async function resetSecurity(uid: number) {
  await run("DELETE FROM passkeys WHERE user_id = ?", uid);
  await run("DELETE FROM login_codes WHERE user_id = ?", uid);
  await run("UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0, otp_fails = 0, failed_logins = 0, locked_until = NULL WHERE id = ?", uid);
}
