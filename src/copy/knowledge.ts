/**
 * The wording of what the office knows about lenders: the notes people wrote down, and what lenders
 * actually decided. The engine returns codes and counts; this file turns them into Arabic.
 */
import type { Ask, Decision, Experience, Refusal, RuleKind } from "@/domain/knowledge";
import { counted, ltr, percent, type CountForms } from "./format";

export const RULE_KIND: Record<RuleKind, string> = {
  condition: "اشتراط",
  exception: "استثناء",
  tip: "طريقة",
  warning: "تحذير",
};

/** What each kind of note is for, said under the choice. */
export const RULE_KIND_HINT: Record<RuleKind, string> = {
  condition: "شيء تطلبه الجهة ولا تكتبه في شروطها.",
  exception: "حالة قبلتها الجهة خارج شروطها.",
  tip: "ما نجح معها ويُعاد.",
  warning: "ما يُتجنب معها.",
};

export const DECISION: Record<Decision, string> = {
  approved: "موافقة",
  approved_modified: "موافقة معدّلة",
  rejected: "رفض",
};

const ASK: Record<Ask, string> = {
  medical: "فحص طبي",
  guarantor: "كفيل أو متضامن",
  salary_transfer: "تحويل الراتب",
  employer_letter: "خطاب جهة العمل",
  gosi_match: "مطابقة التأمينات",
  extra_statements: "كشوف حساب إضافية",
  down_payment: "دفعة أولى أعلى",
  insurance: "تأمين إضافي",
  buyout: "سداد مديونية",
  simah_letter: "خطاب مخالصة",
  lower_amount: "خفض المبلغ",
  shorter_tenor: "تقصير المدة",
  valuation: "إعادة تقييم العقار",
  employer_classification: "تصنيف جهة العمل",
  other: "شرط آخر",
};

const REFUSAL: Record<Refusal, string> = {
  dbr: "نسبة الاستقطاع",
  simah: "السجل الائتماني",
  employer: "جهة العمل",
  service: "مدة الخدمة",
  age: "العمر",
  nationality: "الجنسية",
  income_verification: "تعذر التحقق من الدخل",
  property: "العقار أو تقييمه",
  policy: "سياسة داخلية",
  documents: "نقص مستندات",
  other: "سبب آخر",
};

/** What a lender asked for. A code from another build still reads as words. */
export const askText = (code: string): string => ASK[code as Ask] ?? ASK.other;
/** Why a lender refused. */
export const refusalText = (code: string): string => REFUSAL[code as Refusal] ?? REFUSAL.other;

export const PART: Record<"mortgage" | "personal", string> = {
  mortgage: "العقاري",
  personal: "الشخصي",
};

export const NOTES: CountForms = { one: "ملاحظة واحدة", two: "ملاحظتان", few: "ملاحظات", many: "ملاحظة" };
export const DECISIONS_COUNT: CountForms = { one: "قرار واحد", two: "قراران", few: "قرارات", many: "قراراً" };
const REQUESTS: CountForms = { one: "طلب واحد", two: "طلبين", few: "طلبات", many: "طلباً" };

/** How often a lender said yes: "قبلت 4 من 5 طلبات". */
export function acceptedText(e: Pick<Experience, "n" | "approved">): string {
  if (e.n === 1) return e.approved ? "قبلت الطلب الوحيد المسجل" : "رفضت الطلب الوحيد المسجل";
  if (!e.approved) return `لم تقبل أياً من ${counted(e.n, REQUESTS)}`;
  if (e.approved === e.n) return e.n === 2 ? "قبلت الطلبين المسجلين" : `قبلت كل الطلبات، وهي ${ltr(e.n)}`;
  return `قبلت ${ltr(e.approved)} من ${counted(e.n, REQUESTS)}`;
}

/** Every lender together: "وافقت الجهات على 8 من 11 طلباً". */
export function allAcceptedText(e: Pick<Experience, "n" | "approved">): string {
  if (e.n === 1) return e.approved ? "وافقت الجهة على الطلب الوحيد المسجل" : "رُفض الطلب الوحيد المسجل";
  if (!e.approved) return `لم توافق جهة على أي من ${counted(e.n, REQUESTS)}`;
  return `وافقت الجهات على ${ltr(e.approved)} من ${counted(e.n, REQUESTS)}`;
}

/** The same for clients like the one on screen. Empty when nothing like them was recorded. */
export function similarText(e: Pick<Experience, "similarN" | "similarApproved">): string {
  if (!e.similarN) return "";
  return `لعملاء مثله: ${acceptedText({ n: e.similarN, approved: e.similarApproved })}`;
}

/** What a lender gave against what the engine expected: "تعتمد 90% من تقديرنا". */
export function ratioText(ratio: number): string {
  return `تعتمد ${percent(Math.round(ratio * 100))} من تقديرنا`;
}

const SAVE_ERROR: Record<string, string> = {
  INVALID_INPUT: "في المكتوب ما لا يصح. راجعه ثم احفظ.",
  NOT_FOUND: "لم يعد هذا موجوداً. حدّث الصفحة.",
  DEAL_ENDED: "الصفقة انتهت، وأرقامها لا تُعدَّل. احفظ القرار بلا حساب الصفقة عليه.",
  FORBIDDEN: "لا تملك صلاحية هذا.",
  REPLY_PAPER: "الرد المكتوب يُختار من مستندات الملف التي فيها ملف ولم تُرد.",
};

export const knowledgeError = (code: string): string => SAVE_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";
