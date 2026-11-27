"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { run } from "@/lib/db";
import {
  audit, clearPendingSecondFactor, clientIp, confirmIdentity, hasSudo, ipBlocked, isLocked, login, noteFailure, pendingSecondFactor, requireUser, startSession,
} from "@/lib/auth";
import * as M from "@/lib/auth-methods";
import { normalizePhone } from "@/lib/whatsapp";
import { get } from "@/lib/db";

export type LoginState = { error?: string; step?: "totp"; sent?: boolean } | undefined;
const TOO_MANY = "محاولات كثيرة. حاول بعد ربع ساعة.";

// ===== شاشة الدخول =====
export async function loginAction(_: LoginState, fd: FormData): Promise<LoginState> {
  const r = await login(String(fd.get("email") || ""), String(fd.get("password") || ""), fd.get("remember") === "1");
  if (r.ok) redirect("/");
  return "step" in r ? { step: "totp" } : { error: r.error };
}

/** الخطوة الثانية بعد كلمة المرور: رمز تطبيق المصادقة */
export async function secondFactorAction(_: LoginState, fd: FormData): Promise<LoginState> {
  const p = await pendingSecondFactor();
  if (!p) return { error: "انتهت المهلة. أدخل كلمة المرور من جديد." };
  if (await ipBlocked(await clientIp())) return { step: "totp", error: TOO_MANY };
  if (await isLocked(p.uid)) return { step: "totp", error: "الحساب مقفل مؤقتاً. حاول بعد 15 دقيقة." };
  if (!(await M.totpVerify(p.uid, String(fd.get("code") || "").replace(/\D/g, "")))) {
    await noteFailure(p.uid, "totp");
    return { step: "totp", error: "الرمز غير صحيح" };
  }
  await clearPendingSecondFactor();
  await startSession(p.uid, p.remember, "password+totp");
  redirect("/");
}

/** الدخول برمز فقط: رمز واتساب أو رمز تطبيق المصادقة */
export async function codeLoginAction(_: LoginState, fd: FormData): Promise<LoginState> {
  if (await ipBlocked(await clientIp())) return { error: TOO_MANY };
  const r = await M.codeLogin(String(fd.get("email") || ""), String(fd.get("code") || ""));
  if (!r) return { error: "الرمز غير صحيح أو منتهي. بعد 5 محاولات خاطئة يتوقف الدخول بالرمز حتى تدخل بكلمة المرور." };
  await startSession(r.uid, fd.get("remember") === "1", r.method);
  redirect("/");
}

/** يرسل رمز الدخول على واتساب. الرد واحد دائماً حتى لا يُعرف هل الحساب موجود */
export async function sendCodeAction(email: string): Promise<{ sent: boolean }> {
  const ip = await clientIp();
  if (!M.waOtpReady() || (await ipBlocked(ip))) return { sent: false };
  const n = await get<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action = 'login_code_sent' AND ip = ? AND created_at > datetime('now','-15 minutes')", ip);
  if ((n?.n ?? 0) < 5) await M.sendLoginCode(String(email || "").slice(0, 200));
  return { sent: true };
}

export async function passkeyLoginOptionsAction() {
  try { return { options: await M.passkeyLoginOptions() }; } catch (e) { return { error: (e as Error).message }; }
}
export async function passkeyLoginVerifyAction(response: AuthenticationResponseJSON, remember: boolean): Promise<{ ok?: true; error?: string }> {
  if (await ipBlocked(await clientIp())) return { error: TOO_MANY };
  let uid: number | null = null;
  try { uid = await M.passkeyLoginVerify(response); } catch { uid = null; }
  if (!uid) return { error: "لم نتعرف على هذا المفتاح." };
  await startSession(uid, !!remember, "passkey");
  return { ok: true };
}

// ===== حسابي والأمان =====
type Res = { ok?: string; error?: string };
const NEED_SUDO = "أكّد هويتك بكلمة المرور أولاً.";

export async function confirmIdentityAction(_: Res | undefined, fd: FormData): Promise<Res> {
  const u = await requireUser();
  const err = await confirmIdentity(u, String(fd.get("password") || ""));
  if (err) return { error: err };
  await audit(u, "sudo", "user", u.id);
  revalidatePath("/account");
  return { ok: "تم" };
}

export async function passkeyRegisterOptionsAction() {
  const u = await requireUser();
  if (!(await hasSudo(u))) return { error: NEED_SUDO };
  try { return { options: await M.passkeyRegisterOptions(u) }; } catch (e) { return { error: (e as Error).message }; }
}
export async function passkeyRegisterVerifyAction(response: RegistrationResponseJSON): Promise<Res> {
  const u = await requireUser();
  if (!(await hasSudo(u))) return { error: NEED_SUDO };
  const err = await M.passkeyRegisterVerify(u, response);
  if (err) return { error: err };
  await audit(u, "passkey_add", "user", u.id);
  revalidatePath("/account");
  return { ok: "أُضيف مفتاح المرور" };
}
export async function passkeyDeleteAction(id: number): Promise<Res> {
  const u = await requireUser();
  if (!(await hasSudo(u))) return { error: NEED_SUDO };
  await M.passkeyDelete(u.id, Number(id));
  await audit(u, "passkey_delete", "user", u.id);
  revalidatePath("/account");
  return { ok: "حُذف" };
}

export async function totpBeginAction(): Promise<{ secret?: string; qr?: string; error?: string }> {
  const u = await requireUser();
  if (!(await hasSudo(u))) return { error: NEED_SUDO };
  const { secret, uri } = await M.totpBegin(u);
  const qr = await QRCode.toString(uri, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#141c18", light: "#00000000" } });
  return { secret, qr };
}
export async function totpConfirmAction(code: string): Promise<Res> {
  const u = await requireUser();
  if (!(await hasSudo(u))) return { error: NEED_SUDO };
  if (!(await M.totpConfirm(u, String(code || "").replace(/\D/g, "")))) return { error: "الرمز غير صحيح. تأكد من وقت الجوال وحاول." };
  await audit(u, "totp_enable", "user", u.id);
  revalidatePath("/account");
  return { ok: "تم التفعيل" };
}
export async function totpDisableAction(): Promise<Res> {
  const u = await requireUser();
  if (!(await hasSudo(u))) return { error: NEED_SUDO };
  await M.totpDisable(u.id);
  await audit(u, "totp_disable", "user", u.id);
  revalidatePath("/account");
  return { ok: "أُوقف" };
}

export async function savePhoneAction(_: Res | undefined, fd: FormData): Promise<Res> {
  const u = await requireUser();
  if (!(await hasSudo(u))) return { error: NEED_SUDO };
  const phone = String(fd.get("phone") || "").trim();
  if (phone !== "" && !normalizePhone(phone)) return { error: "اكتب الرقم بصيغة 05xxxxxxxx" };
  await run("UPDATE users SET phone = ? WHERE id = ?", phone === "" ? null : phone.slice(0, 20), u.id);
  await audit(u, "phone_update", "user", u.id);
  revalidatePath("/account");
  return { ok: "حُفظ" };
}
