/** Wording of sign-in and of who may do what. */
import type { Role, SignInRefusal } from "@/domain/auth";

export const ROLE: Record<Role, string> = {
  admin: "مدير النظام",
  analyst: "محلل ائتماني",
  officer: "مسؤول علاقة",
  viewer: "مطّلع",
};

const REFUSAL: Record<SignInRefusal, string> = {
  BAD_CREDENTIALS: "البريد أو كلمة المرور غير صحيحة.",
  BAD_CODE: "الرمز غير صحيح أو انتهى وقته.",
  LOCKED: "الحساب مقفل ربع ساعة بعد محاولات متكررة.",
  TOO_MANY: "محاولات كثيرة من هذا الاتصال. حاول بعد ربع ساعة.",
  STEP_EXPIRED: "انتهت المهلة. ادخل بكلمة المرور من جديد.",
  BAD_PASSKEY: "لم نتعرف على هذا المفتاح. ادخل بكلمة المرور.",
};

/** Signing in by code alone stops after five wrong codes, so the person is told the way back in. */
const CODE_ONLY = "الرمز غير صحيح أو انتهى وقته. بعد خمس محاولات خاطئة يتوقف الدخول بالرمز إلى أن تدخل بكلمة المرور.";

export function signInError(code: string, way: "password" | "second" | "code" = "password"): string {
  if (code === "BAD_CODE" && way === "code") return CODE_ONLY;
  return REFUSAL[code as SignInRefusal] ?? "تعذر الدخول. حاول مرة أخرى.";
}

const ACCOUNT_ERROR: Record<string, string> = {
  EMAIL_TAKEN: "هذا البريد مسجل لحساب آخر.",
  WRONG_PASSWORD: "كلمة المرور الحالية غير صحيحة.",
  PASSWORD_SHORT: "كلمة المرور عشر خانات على الأقل.",
  PASSWORD_LONG: "كلمة المرور أطول من المسموح.",
  INVALID_INPUT: "في البيانات قيمة غير مقبولة.",
  LOCKED: "الحساب مقفل ربع ساعة بعد محاولات متكررة.",
  BAD_CODE: "الرمز غير صحيح. انتظر رمزاً جديداً من التطبيق ثم أعد المحاولة.",
  STEP_EXPIRED: "انتهت المهلة. أعد المحاولة.",
  CONFIRM_FIRST: "أكّد كلمة المرور أولاً.",
  AUTHENTICATOR_ON: "تطبيق المصادقة مفعّل من قبل.",
  PASSKEY_REFUSED: "لم يكتمل إنشاء المفتاح على هذا الجهاز.",
  PASSKEY_KNOWN: "هذا المفتاح مسجل من قبل.",
  PASSKEY_OFF: "مفاتيح المرور غير متاحة على هذا العنوان.",
  NOT_FOUND: "لم يعد موجوداً.",
  DEMO: "هذا عرض تجريبي. لا حساب هنا لتغييره.",
};

export const accountError = (code: string): string => ACCOUNT_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";

/** How a session was opened, as it reads after "دخل". */
const METHOD: Record<string, string> = {
  password: "بكلمة المرور",
  "password+totp": "بكلمة المرور ورمز التطبيق",
  passkey: "بالبصمة",
  totp: "برمز التطبيق",
  whatsapp: "برمز واتساب",
};

export const methodText = (method: string): string => METHOD[method] ?? "";

/** How well the account is guarded, by how many ways in are switched on. */
export const GUARD: Record<1 | 2 | 3, { level: string; say: string }> = {
  1: { level: "أساسية", say: "كلمة المرور وحدها. أضف طريقة ثانية ليصعب الدخول على غيرك." },
  2: { level: "جيدة", say: "طريقتان تحميان حسابك." },
  3: { level: "قوية", say: "كل طرق الحماية تعمل." },
};

/** What the browser said when a passkey could not be made or used. Null when the person simply closed the prompt. */
export function passkeyProblem(error: unknown, doing: "add" | "enter"): string | null {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "AbortError") return null;
  if (name === "InvalidStateError") return "هذا الجهاز مسجل من قبل.";
  return doing === "add" ? "تعذر إنشاء المفتاح على هذا الجهاز." : "تعذر استخدام البصمة على هذا الجهاز.";
}
