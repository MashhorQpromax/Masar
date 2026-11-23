/** The wording of the lender catalogue: who the lenders are and what each one's terms say. */
import { TERM_VALIDITY_MONTHS, type LenderType, type Nationality, type ProductKind, type SourceKind, type SourceProblem, type Term, type TermStanding } from "@/domain/eligibility";
import type { RateType } from "@/domain/finance";
import { dayOfIso, ltr, months } from "./format";

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

/** A term of a product, as the office names it when it says where the term comes from. */
export const TERM_NAME: Record<Term, string> = {
  salary: "أدنى راتب",
  sector: "لمن يُعطى",
  nationality: "الجنسية",
  age: "حدود العمر",
  service: "مدة الخدمة",
  transfer: "تحويل الراتب",
  late: "تأخر السداد",
  settled: "بعد سداد التعثر",
  amount: "أقصى مبلغ",
  tenor: "أقصى مدة",
  ltv: "نسبة التمويل من العقار",
  rate: "الهامش",
};

/** What can confirm a lender's term. */
export const SOURCE_KIND: Record<SourceKind, string> = {
  lender_document: "مستند من الجهة",
  lender_website: "موقع الجهة",
  lender_staff: "موظف في الجهة",
};

/** What names a source of each kind, asked of whoever confirms. */
export const SOURCE_REFERENCE: Record<SourceKind, string> = {
  lender_document: "اسم المستند وتاريخه",
  lender_website: "رابط الصفحة",
  lender_staff: "اسم الموظف ومنصبه",
};

/** How long a confirmation stays good, said once where terms are confirmed. */
export const VALIDITY_SAY = `التأكيد يصلح ${months(TERM_VALIDITY_MONTHS)}، ثم تُسأل الجهة من جديد.`;

/** How far a term can be relied on today. */
export function standingText(standing: TermStanding | undefined): string {
  if (!standing || standing.state === "unconfirmed") return "غير مؤكد";
  return standing.state === "confirmed" ? `مؤكد حتى ${dayOfIso(standing.validUntil)}` : `انتهى تأكيده في ${dayOfIso(standing.validUntil)}`;
}

/** How much of a product can be relied on: every term, some of them, or none. */
export function confirmedText(confirmed: number, of: number): string {
  if (confirmed <= 0) return "استرشادية";
  return confirmed >= of ? "مؤكدة" : `مؤكد ${ltr(confirmed)} من ${ltr(of)}`;
}

const SOURCE_PROBLEM: Record<SourceProblem, string> = {
  REFERENCE_SHORT: "اكتب ما يدل على المصدر: اسم المستند وتاريخه، أو رابط الصفحة، أو اسم الموظف ومنصبه.",
  LINK_NEEDED: "تأكيد من موقع الجهة يحتاج رابط الصفحة كاملاً.",
  DAY_INVALID: "تاريخ التأكد ليس يوماً صحيحاً.",
  DAY_AHEAD: "تاريخ التأكد لا يكون بعد اليوم.",
  DAY_OLD: `مضى على هذا التأكد أكثر من ${months(TERM_VALIDITY_MONTHS)}. اسأل الجهة من جديد.`,
};

const SAVE_ERROR: Record<string, (params: Record<string, string>) => string> = {
  INVALID_INPUT: () => "في المكتوب قيمة خارج الحدود المقبولة. راجعها ثم احفظ.",
  NOT_FOUND: () => "لم يعد هذا في القائمة.",
  LENDER_KNOWN: (p) => (p.name ? `«${p.name}» في القائمة من قبل.` : "هذه الجهة في القائمة من قبل."),
  FORBIDDEN: () => "لا تملك صلاحية تعديل قائمة الجهات.",
  SOURCE_REFUSED: (p) => SOURCE_PROBLEM[p.problem as SourceProblem] ?? "هذا المصدر لا يكفي لتأكيد الشرط.",
  TERM_VALUE_MISSING: () => "اكتب أولاً ما تفعله الجهة بمن سدّد تعثره واحفظه، ثم أكّده.",
};

export const SOURCE_PROBLEMS = Object.keys(SOURCE_PROBLEM) as SourceProblem[];

/** Why a change to the catalogue was not kept. */
export const lenderError = (code: string, params: Record<string, string> = {}): string => SAVE_ERROR[code]?.(params) ?? "تعذر الحفظ. حاول مرة أخرى.";

export const LENDER_ERROR_CODES = Object.keys(SAVE_ERROR);
