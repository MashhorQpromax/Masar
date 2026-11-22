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
};

export const accountError = (code: string): string => ACCOUNT_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";
