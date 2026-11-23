/** Wording of the deal editor: what a person chooses from, and what they are told when saving fails. */
import type { DraftGap, FeeRefusal, FinanceBase, ItemKind, LenderKind, PaidBy, Sector } from "@/domain/deal";
import { FEE_REASON_MIN, splitLabel } from "@/domain/deal";
import { counted, dayOfRecord, ltr, money, percent } from "./format";

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

/** Under a field the credit report left empty, on an item that came from the report. */
export const DRAFT_GAP: Record<DraftGap, string> = {
  amount: "لم يذكره التقرير. اكتبه من خطاب الجهة.",
  monthly: "لم يذكره التقرير.",
};

/** Under the payoff of a loan that came from the report, until a person writes the real figure. */
export const PAYOFF_ESTIMATED = "تقدير للسداد المبكر. يؤكده خطاب المخالصة.";

const NOT_IN_DEAL = { one: "التزام واحد ليس في الصفقة", two: "التزامان ليسا في الصفقة", few: "التزامات ليست في الصفقة", many: "التزاماً ليست في الصفقة" };

/** The day a credit report was issued, as the editor says where its suggestions come from. */
export const reportDay = (day: string | null): string => (day ? `تقرير سمة، ${dayOfRecord(day)}` : "تقرير سمة");

/** How many of the report's commitments the deal does not hold yet. */
export const notInDeal = (count: number): string => counted(count, NOT_IN_DEAL);

const RECORD_DIFFERS = { one: "مبلغ واحد يخالف تقرير سمة", two: "مبلغان يخالفان تقرير سمة", few: "مبالغ تخالف تقرير سمة", many: "مبلغاً تخالف تقرير سمة" };

/** How many court orders and defaults the deal holds at another amount than the credit report. */
export const recordDiffers = (count: number): string => counted(count, RECORD_DIFFERS);

/** On the credit page, when every debt of the record is in the deal and some at another amount. */
export const DIFFERS_DUE = "في الصفقة قرار أو تعثر بمبلغ غير الذي في التقرير. صحّح المبلغ أو أكّده من الدائن.";

/** On the credit page, after what the deal does not hold yet. */
export const alsoDiffers = (count: number): string => `وفي الصفقة ${recordDiffers(count)}.`;

/** Under the amount of a court order or default the deal holds at another figure than the report. */
export const onRecord = (amount: number): string => `في تقرير سمة ${money(amount)}`;

/** Beside a court order or default whose amount a paper from the creditor confirmed. */
export const CONFIRMED_BY_CREDITOR = "المبلغ مؤكد من الدائن";

/** A court order or default the deal holds at another amount than the credit report, as a note on the deal. */
export function differenceText(difference: { label: string; deal: number; record: number }): string {
  const { title, party } = splitLabel(difference.label);
  return `${title}${party ? ` (${party})` : ""}: في الصفقة ${money(difference.deal)}، وفي تقرير سمة ${money(difference.record)}. صحّح المبلغ أو أكّده من الدائن.`;
}

/** Said once the report's commitments were put in a new deal for the person to review. */
export const REPORT_FILLED = "وضعنا ما في التقرير. راجع كل رقم قبل الحفظ.";

const FEE_REFUSAL: Record<FeeRefusal, (params: Record<string, string>) => string> = {
  NOT_ALLOWED: () => "تعديل الأتعاب لمن يملك صلاحيتها. أرجعها كما كانت ثم احفظ.",
  OUT_OF_RANGE: (p) => `نسبة الأتعاب خارج سياسة المكتب، من ${percent(Number(p.min))} إلى ${percent(Number(p.max))}.`,
  REASON_NEEDED: () => `اكتب سبب تعديل الأتعاب، ${ltr(FEE_REASON_MIN)} أحرف على الأقل.`,
};

export const FEE_REFUSALS = Object.keys(FEE_REFUSAL) as FeeRefusal[];

const SAVE_ERROR: Record<string, (params: Record<string, string>) => string> = {
  FEE_REFUSED: (p) => (p.reason && p.reason in FEE_REFUSAL ? FEE_REFUSAL[p.reason as FeeRefusal](p) : "تعذر حفظ الأتعاب. حاول مرة أخرى."),
  INVALID_INPUT: () => "في الأرقام قيمة غير مقبولة. راجعها ثم احفظ.",
  NOT_FOUND: () => "هذه الصفقة لم تعد موجودة.",
  DEAL_ENDED: () => "الصفقة انتهت، وأرقامها لا تُعدَّل.",
  DEAL_ALREADY_OPEN: () => "لهذا العميل صفقة مفتوحة. عدّلها بدل فتح صفقة جديدة.",
  BAD_PHONE: () => "رقم الجوال غير صحيح. اكتبه بعشرة أرقام تبدأ بـ 05، أو اتركه فارغاً.",
  PHONE_TAKEN: (p) => `هذا الجوال مسجل في الملف ${ltr(p.fileNo ?? "")}. افتح ذلك الملف بدل ملف جديد.`,
  FORBIDDEN: () => "لا تملك صلاحية هذا التعديل.",
};

/** What to tell a person when saving failed with this code. */
export const saveError = (code: string, params: Record<string, string> = {}): string => SAVE_ERROR[code]?.(params) ?? "تعذر الحفظ. حاول مرة أخرى.";

export const SAVE_ERROR_CODES = Object.keys(SAVE_ERROR);
