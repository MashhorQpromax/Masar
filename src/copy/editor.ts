/** Wording of the deal editor: what a person chooses from, and what they are told when saving fails. */
import type { FinanceBase, ItemKind, LenderKind, PaidBy, Sector } from "@/domain/deal";

/** Also the default title of an obligation of that kind. */
export const ITEM_KIND: Record<ItemKind, string> = {
  execution: "قرار تنفيذ",
  default: "تعثر",
  mortgage_payoff: "مخالصة العقاري",
  personal_payoff: "مخالصة الشخصي",
  card: "بطاقة ائتمانية",
  other: "التزام آخر",
};

export const PAID_BY: Record<PaidBy, string> = {
  company: "نسدده نحن",
  bank: "يشتريه البنك",
  out: "يبقى كما هو",
};

export const SECTOR: Record<Sector, string> = {
  gov: "حكومي",
  semi_gov: "شبه حكومي",
  military: "عسكري",
  private_approved: "خاص معتمد",
  private: "خاص",
  retired: "متقاعد",
  self: "عمل حر",
};

export const FINANCE_BASE: Record<FinanceBase, string> = {
  total: "كامل التمويل",
  personal: "الشخصي فقط",
  mortgage: "العقاري فقط",
};

export const LENDER_KIND: Record<LenderKind, string> = {
  bank: "بنك",
  finance_co: "شركة تمويل",
};

const SAVE_ERROR: Record<string, string> = {
  INVALID_INPUT: "في الأرقام قيمة غير مقبولة. راجعها ثم احفظ.",
  NOT_FOUND: "هذه الصفقة لم تعد موجودة.",
  DEAL_ENDED: "الصفقة انتهت، وأرقامها لا تُعدَّل.",
  DEAL_ALREADY_OPEN: "لهذا العميل صفقة مفتوحة. عدّلها بدل فتح صفقة جديدة.",
  FORBIDDEN: "لا تملك صلاحية هذا التعديل.",
};

/** What to tell a person when saving failed with this code. */
export const saveError = (code: string): string => SAVE_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";
