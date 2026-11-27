import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { get, run } from "./db";

export type Role = "admin" | "analyst" | "officer" | "viewer";
export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

const COOKIE = "masar_session";
const SESSION_HOURS = 12; // بدون «تذكرني»
const REMEMBER_HOURS = 24 * 30; // مع «تذكرني»: 30 يوماً

export const ROLE_LABEL: Record<Role, string> = {
  admin: "مدير النظام",
  analyst: "محلل ائتماني",
  officer: "مسؤول علاقة",
  viewer: "مطّلع",
};

// صلاحيات مبنية على الدور
const PERMS = {
  "client.create": ["admin", "analyst", "officer"],
  "client.edit": ["admin", "analyst", "officer"],
  "client.delete": ["admin"],
  "client.view_pii": ["admin", "analyst", "officer"],
  "study.approve": ["admin", "analyst"],
  "doc.upload": ["admin", "analyst", "officer"],
  "doc.verify": ["admin", "analyst"],
  "app.manage": ["admin", "analyst", "officer"],
  "lender.manage": ["admin", "analyst"],
  "user.manage": ["admin"],
  "audit.view": ["admin"],
} as const satisfies Record<string, readonly Role[]>;
export type Perm = keyof typeof PERMS;

export function can(user: User | null | undefined, perm: Perm) {
  return !!user && (PERMS[perm] as readonly Role[]).includes(user.role);
}


export async function hashPassword(p: string) {
  return bcrypt.hash(p, 12);
}

export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
}

export const MIN_PASSWORD = 6;
export function passwordProblem(p: string) {
  return p.length < MIN_PASSWORD ? `كلمة المرور ${MIN_PASSWORD} خانات على الأقل` : null;
}

/** تغيير المستخدم لكلمة مروره بنفسه */
export async function changeOwnPassword(uid: number, current: string, next: string): Promise<string | null> {
  const u = await get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", uid);
  if (!u || !(await bcrypt.compare(current, u.password_hash))) return "كلمة المرور الحالية غير صحيحة";
  const bad = passwordProblem(next);
  if (bad) return bad;
  await run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(next), uid);
  return null;
}

/** حد عام: محاولات فاشلة كثيرة من نفس العنوان خلال ربع ساعة توقف كل طرق الدخول منه مؤقتاً */
export async function ipBlocked(ip: string) {
  if (!ip || ip === "local") return false;
  const r = await get<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action = 'login_failed' AND ip = ? AND created_at > datetime('now','-15 minutes')", ip);
  return (r?.n ?? 0) >= 20;
}
const TOO_MANY = "محاولات كثيرة. حاول بعد ربع ساعة.";
const BAD_LOGIN = "البريد أو كلمة المرور غير صحيحة";

/** يفتح الجلسة بعد نجاح أي طريقة دخول */
export async function startSession(uid: number, remember: boolean, method: "password" | "password+totp" | "passkey" | "whatsapp" | "totp") {
  const hours = remember ? REMEMBER_HOURS : SESSION_HOURS;
  await run("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?", uid);
  // الدخول بعامل قوي (كلمة مرور أو مفتاح مرور) يعيد فتح الدخول بالرمز
  if (method !== "whatsapp" && method !== "totp") await run("UPDATE users SET otp_fails = 0 WHERE id = ?", uid);
  await run("INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, 'login', ?, ?)", uid, method, await clientIp());
  (await cookies()).set(COOKIE, signSession(uid, hours), { ...COOKIE_OPTS(), maxAge: hours * 3600 });
}
const COOKIE_OPTS = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.MASAR_INSECURE_COOKIE !== "1",
  path: "/",
});

export type LoginResult = { ok: true } | { ok: false; error: string } | { ok: false; step: "totp" };
export async function login(email: string, password: string, remember = true): Promise<LoginResult> {
  const ip = await clientIp();
  if (await ipBlocked(ip)) return { ok: false, error: TOO_MANY };
  const u = await get<{ id: number; password_hash: string; active: number; failed_logins: number; locked_until: string | null; totp_enabled: number | null }>(
    "SELECT id, password_hash, active, failed_logins, locked_until, totp_enabled FROM users WHERE email = ?",
    email.trim().toLowerCase(),
  );
  if (!u || !u.active) {
    await bcrypt.compare(password, "$2a$12$0000000000000000000000000000000000000000000000000000"); // توقيت ثابت
    await run("INSERT INTO audit_log (action, details, ip) VALUES ('login_failed', ?, ?)", email.slice(0, 120), ip);
    return { ok: false, error: BAD_LOGIN };
  }
  if (u.locked_until && new Date(u.locked_until.replace(" ", "T") + "Z") > new Date()) {
    return { ok: false, error: "الحساب مقفل مؤقتاً بسبب محاولات متكررة. حاول بعد 15 دقيقة." };
  }
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    const fails = u.failed_logins + 1;
    await run(
      "UPDATE users SET failed_logins = ?, locked_until = CASE WHEN ? >= 5 THEN datetime('now','+15 minutes') ELSE NULL END WHERE id = ?",
      fails >= 5 ? 0 : fails,
      fails,
      u.id,
    );
    await run("INSERT INTO audit_log (user_id, action, ip) VALUES (?, 'login_failed', ?)", u.id, ip);
    return { ok: false, error: BAD_LOGIN };
  }
  if (u.totp_enabled) {
    // كلمة المرور صحيحة لكن الحساب محمي بتطبيق المصادقة: ننتظر الرمز
    (await cookies()).set(PENDING, signToken("2fa", { uid: u.id, remember }, 300), { ...COOKIE_OPTS(), maxAge: 300 });
    return { ok: false, step: "totp" };
  }
  await startSession(u.id, remember, "password");
  return { ok: true };
}

/** يسجل محاولة فاشلة على الحساب ويقفله ربع ساعة بعد خمس */
export async function noteFailure(uid: number, detail: string) {
  const r = await get<{ failed_logins: number }>("SELECT failed_logins FROM users WHERE id = ?", uid);
  const fails = (r?.failed_logins ?? 0) + 1;
  await run("UPDATE users SET failed_logins = ?, locked_until = CASE WHEN ? >= 5 THEN datetime('now','+15 minutes') ELSE locked_until END WHERE id = ?", fails >= 5 ? 0 : fails, fails, uid);
  await run("INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, 'login_failed', ?, ?)", uid, detail, await clientIp());
}
export async function isLocked(uid: number) {
  const r = await get<{ locked_until: string | null }>("SELECT locked_until FROM users WHERE id = ?", uid);
  return !!r?.locked_until && new Date(r.locked_until.replace(" ", "T") + "Z") > new Date();
}

// تأكيد الهوية قبل تعديل طرق الدخول: يمنع من يجد الجهاز مفتوحاً من إضافة بصمته
const SUDO = "masar_sudo";
export async function confirmIdentity(u: User, password: string): Promise<string | null> {
  if (await isLocked(u.id)) return "الحساب مقفل مؤقتاً. حاول بعد 15 دقيقة.";
  const r = await get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", u.id);
  if (!r || !(await bcrypt.compare(password, r.password_hash))) {
    await noteFailure(u.id, "sudo");
    return "كلمة المرور غير صحيحة";
  }
  (await cookies()).set(SUDO, signToken("sudo", { uid: u.id }, 600), { ...COOKIE_OPTS(), sameSite: "strict", maxAge: 600 });
  return null;
}
export async function hasSudo(u: User) {
  const t = (await cookies()).get(SUDO)?.value;
  return !!t && verifyToken<{ uid: number }>("sudo", t)?.uid === u.id;
}

const PENDING = "masar_2fa";
/** المستخدم الذي أدخل كلمة المرور وينتظر رمز المصادقة */
export async function pendingSecondFactor(): Promise<{ uid: number; remember: boolean } | null> {
  const t = (await cookies()).get(PENDING)?.value;
  return t ? verifyToken<{ uid: number; remember: boolean }>("2fa", t) : null;
}
export async function clearPendingSecondFactor() {
  (await cookies()).delete(PENDING);
}

export async function logout() {
  const c = await cookies();
  c.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  const uid = t ? verifySession(t) : null;
  if (!uid) return null;
  return await get<User>("SELECT id, name, email, role FROM users WHERE id = ? AND active = 1", uid) ?? null;
}

// جلسة موقعة HMAC (لا تعتمد على حالة الخادم — تعمل مع عدة نسخ على Vercel)
let cachedSecret: string | undefined;
function secret() {
  if (cachedSecret) return cachedSecret;
  let s = process.env.MASAR_SECRET;
  if (!s) {
    try { s = fs.readFileSync(path.join(process.cwd(), "seed", ".secret"), "utf8").trim(); } catch {}
  }
  if (s) cachedSecret = s;
  if (!s && process.env.NODE_ENV === "production" && process.env.VERCEL) throw new Error("MASAR_SECRET مطلوب");
  return s || "dev-only-secret-change-me";
}
export const appSecret = () => secret();
/** رمز قصير العمر موقّع (تحدي مفتاح المرور، انتظار العامل الثاني) */
export function signToken(kind: string, data: unknown, ttlSec: number) {
  const body = `${kind}.${Buffer.from(JSON.stringify(data)).toString("base64url")}.${Date.now() + ttlSec * 1000}`;
  return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function verifyToken<T>(kind: string, t: string): T | null {
  const i = t.lastIndexOf(".");
  if (i < 0) return null;
  const body = t.slice(0, i);
  const mac = Buffer.from(t.slice(i + 1));
  const want = Buffer.from(crypto.createHmac("sha256", secret()).update(body).digest("base64url"));
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return null;
  const [k, data, exp] = body.split(".");
  if (k !== kind || Number(exp) < Date.now()) return null;
  try { return JSON.parse(Buffer.from(data, "base64url").toString()) as T; } catch { return null; }
}
function signSession(uid: number, hours = SESSION_HOURS) {
  const exp = Date.now() + hours * 3600_000;
  const body = `${uid}.${exp}.${crypto.randomBytes(12).toString("base64url")}`;
  return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
function verifySession(t: string): number | null {
  const i = t.lastIndexOf(".");
  if (i < 0) return null;
  const body = t.slice(0, i);
  const mac = Buffer.from(t.slice(i + 1));
  const want = Buffer.from(crypto.createHmac("sha256", secret()).update(body).digest("base64url"));
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return null;
  const [uid, exp] = body.split(".");
  if (Number(exp) < Date.now()) return null;
  return Number(uid);
}

export async function requireUser(perm?: Perm): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (perm && !can(u, perm)) throw new Error("ليست لديك صلاحية لهذا الإجراء");
  return u;
}

/** للصفحات: يعيد التوجيه بدلاً من رمي خطأ */
export async function requirePage(perm: Perm): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (!can(u, perm)) redirect("/?denied=1");
  return u;
}

export async function audit(user: User | null, action: string, entity?: string, entityId?: number | bigint | null, details?: unknown) {
  await run(
    "INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)",
    user?.id ?? null,
    action,
    entity ?? null,
    entityId != null ? Number(entityId) : null,
    details == null ? null : typeof details === "string" ? details : JSON.stringify(details),
    await clientIp(),
  );
}

export function maskId(id: string | null | undefined) {
  if (!id) return "—";
  return id.length <= 4 ? "****" : "•".repeat(id.length - 4) + id.slice(-4);
}
