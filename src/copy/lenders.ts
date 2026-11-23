/** The wording of the lender catalogue: who the lenders are and what each one's terms say. */
import type { LenderType } from "@/domain/eligibility";
import type { RateType } from "@/domain/finance";
import { months } from "./format";

export const LENDER_TYPE: Record<LenderType, string> = {
  bank: "بنك",
  finance_company: "شركة تمويل",
};

export const RATE_TYPE: Record<RateType, string> = {
  flat: "ثابت",
  reducing: "متناقص",
};

/** What a lender does with a client who paid off a default. */
export function afterDefaultText(waitMonths: number | null | undefined): string {
  if (waitMonths == null) return "بعد سداد التعثر: لم نؤكد";
  return waitMonths === 0 ? "بعد سداد التعثر: تقبل فوراً" : `بعد سداد التعثر: تنتظر ${months(waitMonths)}`;
}

export const LENDERS = { one: "جهة واحدة", two: "جهتان", few: "جهات", many: "جهة" };
export const PRODUCTS = { one: "منتج واحد", two: "منتجان", few: "منتجات", many: "منتجاً" };

const SAVE_ERROR: Record<string, string> = {
  INVALID_INPUT: "في الشروط قيمة خارج الحدود المقبولة. راجعها ثم احفظ.",
  NOT_FOUND: "هذا المنتج لم يعد في القائمة.",
  FORBIDDEN: "لا تملك صلاحية تعديل شروط الجهات.",
};

export const lenderError = (code: string): string => SAVE_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";
