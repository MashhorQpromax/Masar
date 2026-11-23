/** The wording of the lender catalogue: who the lenders are and what each one's terms say. */
import type { LenderType, Nationality, ProductKind } from "@/domain/eligibility";
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

/** Who a product is given to by nationality, in the word a choice has room for. */
export const NATIONALITY_CHOICE: Record<Nationality, string> = {
  saudi: "سعودي",
  non_saudi: "مقيم",
};

/** What a product of each kind is usually called, offered as a start when one is added. */
export const PRODUCT_NAME: Record<ProductKind, string> = {
  personal: "التمويل الشخصي",
  mortgage: "التمويل العقاري",
  auto: "تمويل السيارات",
  sme: "تمويل المنشآت",
};

const SAVE_ERROR: Record<string, (params: Record<string, string>) => string> = {
  INVALID_INPUT: () => "في المكتوب قيمة خارج الحدود المقبولة. راجعها ثم احفظ.",
  NOT_FOUND: () => "لم يعد هذا في القائمة.",
  LENDER_KNOWN: (p) => (p.name ? `«${p.name}» في القائمة من قبل.` : "هذه الجهة في القائمة من قبل."),
  FORBIDDEN: () => "لا تملك صلاحية تعديل قائمة الجهات.",
};

/** Why a change to the catalogue was not kept. */
export const lenderError = (code: string, params: Record<string, string> = {}): string => SAVE_ERROR[code]?.(params) ?? "تعذر الحفظ. حاول مرة أخرى.";

export const LENDER_ERROR_CODES = Object.keys(SAVE_ERROR);
