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
const SESSION_HOURS = 10;

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

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = await get<{ id: number; password_hash: string; active: number; failed_logins: number; locked_until: string | null }>(
    "SELECT id, password_hash, active, failed_logins, locked_until FROM users WHERE email = ?",
    email.trim().toLowerCase(),
  );
  const ip = await clientIp();
  if (!u || !u.active) {
    await bcrypt.compare(password, "$2a$12$0000000000000000000000000000000000000000000000000000"); // توقيت ثابت
    await run("INSERT INTO audit_log (action, details, ip) VALUES ('login_failed', ?, ?)", email, ip);
    return { ok: false, error: "البريد أو كلمة المرور غير صحيحة" };
  }
  if (u.locked_until && new Date(u.locked_until + "Z") > new Date()) {
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
    return { ok: false, error: "البريد أو كلمة المرور غير صحيحة" };
  }
  const token = signSession(u.id);
  await run("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?", u.id);
  await run("INSERT INTO audit_log (user_id, action, ip) VALUES (?, 'login', ?)", u.id, ip);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.MASAR_INSECURE_COOKIE !== "1",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return { ok: true };
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
function signSession(uid: number) {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
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
