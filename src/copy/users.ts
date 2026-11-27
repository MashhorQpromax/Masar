/** Wording of the accounts of the office: who may do what, how each person enters, and what is said when a change is refused. */
import type { Role } from "@/domain/auth";
import { counted, dayOf, timeText, type CountForms } from "./format";

/** What a role is for, in one line. A test holds each line to what the role may really do. */
export const ROLE_SAY: Record<Role, string> = {
  admin: "كل شيء، ومعه الحسابات وسجل التدقيق.",
  analyst: "يعمل على الملفات، ويتحقق من المستندات ويصحح شروط الجهات.",
  officer: "يفتح الملفات ويعدّل الصفقات ويرفع المستندات ويراسل العملاء.",
  viewer: "يطّلع فقط، ولا يرى جوالاً ولا هوية ولا ملفاً مرفوعاً.",
};

const ACCOUNTS: CountForms = { one: "حساب واحد", two: "حسابان", few: "حسابات", many: "حساباً" };

/** The head of the accounts screen: "5 حسابات، واحد منها موقوف." One and two are said the way Arabic says them. */
export function accountsText(total: number, stopped: number): string {
  if (total === 0) return "لا حسابات بعد.";
  if (total === 1) return stopped ? "حساب واحد، وهو موقوف." : "حساب واحد يعمل.";
  const all = counted(total, ACCOUNTS);
  const pair = total === 2;
  if (stopped === 0) return `${all}، ${pair ? "كلاهما يعمل" : "كلها تعمل"}.`;
  if (stopped === total) return `${all}، ${pair ? "كلاهما موقوف" : "كلها موقوفة"}.`;
  const of = pair ? "منهما" : "منها";
  return `${all}، ${stopped === 1 ? `واحد ${of} موقوف` : stopped === 2 ? `اثنان ${of} موقوفان` : `${stopped} ${of} موقوفة`}.`;
}

export type UserStanding = "working" | "stopped" | "locked";

/** Where an account stands: it works, it was stopped, or wrong attempts locked it for a while. */
export const standingOf = (user: { active: boolean; lockedUntil: Date | null }): UserStanding => (!user.active ? "stopped" : user.lockedUntil ? "locked" : "working");

export function standingText(user: { active: boolean; lockedUntil: Date | null }): string {
  const standing = standingOf(user);
  if (standing === "stopped") return "موقوف";
  if (standing === "locked") return `مقفل حتى ${timeText(user.lockedUntil!)}`;
  return "يعمل";
}

const KEYS: CountForms = { one: "مفتاح مرور", two: "مفتاحا مرور", few: "مفاتيح مرور", many: "مفتاح مرور" };

/** The ways a person has into their account, beyond the password everyone has. */
export function waysText(user: { authenticator: boolean; passkeys: number }): string {
  const ways = [user.passkeys > 0 && counted(user.passkeys, KEYS), user.authenticator && "تطبيق المصادقة"].filter(Boolean);
  return ways.length ? ways.join("، ") : "كلمة المرور فقط";
}

/** When a person last came in. */
export const lastSeenText = (at: Date | null, now: Date): string => (at ? `آخر دخول ${dayOf(at, now)}` : "لم يدخل بعد");

const DEVICES: CountForms = { one: "جهاز واحد", two: "جهازان", few: "أجهزة", many: "جهازاً" };

/** "داخل الآن من جهازين", or nothing when the person is signed in nowhere. */
export const signedInText = (sessions: number): string => (sessions > 0 ? `داخل الآن من ${sessions === 1 ? "جهاز واحد" : sessions === 2 ? "جهازين" : counted(sessions, DEVICES)}` : "");

const USERS_ERROR: Record<string, string> = {
  EMAIL_TAKEN: "هذا البريد مسجل لحساب آخر.",
  PASSWORD_SHORT: "كلمة المرور عشر خانات على الأقل.",
  PASSWORD_LONG: "كلمة المرور أطول من المسموح.",
  BAD_PHONE: "رقم الجوال غير صحيح. اكتبه بعشرة أرقام تبدأ بـ 05، أو اتركه فارغاً.",
  INVALID_INPUT: "تحقق من الاسم والبريد ثم حاول مرة أخرى.",
  OWN_ACCOUNT: "هذا حسابك أنت. غيّره من صفحة حسابي.",
  NOT_FOUND: "هذا الحساب لم يعد موجوداً. حدّث الصفحة.",
  FORBIDDEN: "إدارة الحسابات لمدير النظام فقط.",
  CONFIRM_FIRST: "أكّد كلمة المرور أولاً.",
  DEMO: "هذا عرض تجريبي. الحسابات هنا لا تتغير.",
};

/** What to tell a person when a change to an account was refused. */
export const usersError = (code: string): string => USERS_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";

export const USERS_ERROR_CODES = Object.keys(USERS_ERROR);
