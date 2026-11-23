/**
 * The wording of a client's credit and financial analysis: the result in a sentence, what is missing
 * or unconfirmed, and what to do next with its reason. The engine returns codes and numbers; this
 * file turns them into Arabic.
 */
import type { AnalysisVerdict, ClientAnalysis, Commitment, Fit, FitCheck, Gap, Income, IncomeBasis, KindFit, Mark, Reading, Step } from "@/domain/analysis";
import type { Capacity } from "@/domain/eligibility";
import { actionText, actionTitle, blockerText, findingText } from "./credit";
import { capRuleText, checkText, FINANCE_TYPE, pointText } from "./eligibility";
import { counted, ltr, money, months, type CountForms } from "./format";
import { routeCheckText } from "./funding";

export const ANALYSIS_VERDICT: Record<AnalysisVerdict, string> = {
  eligible: "مؤهل مبدئياً",
  conditional: "مؤهل بشروط",
  not_eligible: "غير مؤهل الآن",
  pending: "بحاجة إلى تحقق",
};

/** What every page and every printed copy of the analysis says about itself. */
export const DECISION_SUPPORT = "هذا التحليل يدعم قرار الموظف، وليس موافقة تمويلية. القرار النهائي للجهة الممولة.";

const TAKE: CountForms = { one: "جهة واحدة تقبله", two: "جهتان تقبلانه", few: "جهات تقبله", many: "جهة تقبله" };
const TAKE_ON_TERMS: CountForms = { one: "جهة واحدة تقبله بشروط", two: "جهتان تقبلانه بشروط", few: "جهات تقبله بشروط", many: "جهة تقبله بشروط" };

/** How many lenders, not products, answer one way in a reading of every kind studied. */
function lendersIn(readings: readonly Reading[], status: Fit["status"]): number {
  return new Set(readings.flatMap((r) => r.fits.filter((fit) => fit.status === status).map((fit) => fit.product.lenderId))).size;
}

function takers(readings: readonly Reading[]): string | null {
  const open = lendersIn(readings, "pass");
  if (open) return counted(open, TAKE);
  const onTerms = lendersIn(readings, "warn");
  return onTerms ? counted(onTerms, TAKE_ON_TERMS) : null;
}

/**
 * The result in a sentence or two, under the verdict. `toClear` is what has to be paid before any
 * lender looks at the client. A pending analysis says the first thing it waits for.
 */
export function verdictSay(a: Pick<ClientAnalysis, "verdict" | "afterClearing" | "income" | "kinds" | "steps">, toClear: number): string {
  const today = a.kinds.map((k) => k.today);
  if (a.verdict === "pending") {
    if (a.steps.some((step) => step.code === "RECORD_CONSENT")) return "موافقة العميل على معالجة بياناته وتقريره غير مسجلة. سجّلها قبل الاعتماد على ما هنا.";
    if (a.income.basis === "missing") return "الراتب غير مدخل في الملف، فلا نسبة تُحسب ولا جهة تُقاس قبل إدخاله.";
    if (!a.kinds.length) return "لا جهات في القائمة نقيس عليها. أضف الجهات وشروطها أولاً.";
    return "قراءة التقرير ضعيفة الثقة. طابقها على التقرير الأصلي قبل الاعتماد على ما هنا.";
  }
  if (a.afterClearing == null) return `${takers(today) ?? "لا جهة في القائمة تقبله بشروطها المسجلة"}.`;
  const cleared = takers(a.kinds.flatMap((k) => (k.cleared ? [k.cleared] : [])));
  const first = toClear > 0 ? `لا جهة تقبله قبل سداد ${money(toClear)}.` : "لا جهة تقبله قبل رفع ما يمنع.";
  if (!cleared) return `${first} وبعده لا جهة في القائمة تقبله بشروطها المسجلة.`;
  return `${first} بعده ${cleared}، والسداد لا يضمن القبول.`;
}

export const INCOME_BASIS: Record<IncomeBasis, string> = {
  verified: "عليه مستند دخل موثّق",
  stated: "كما كُتب في الملف، بلا مستند موثّق",
  missing: "غير مدخل",
};

/** How the income was made up, when it is more than the total salary alone. */
export function incomeHow(income: Income): string | null {
  if (income.basis === "missing") return null;
  const salary = income.basicOnly ? `الراتب الأساسي ${money(income.salary)}` : `الراتب ${money(income.salary)}`;
  if (income.other > 0) return `${salary} ونصف الدخل الإضافي ${money(income.other)}.`;
  return income.basicOnly ? `${salary}. الإجمالي غير مدخل.` : null;
}

/** What stands in the installment column of a commitment the record gives none for. */
export const noInstallment = (c: Pick<Commitment, "kind">): string => (c.kind === "card" ? "بلا قسط في التقرير" : "القسط غير مذكور");

const UNCOUNTED: CountForms = { one: "التزام واحد", two: "التزامان", few: "التزامات", many: "التزاماً" };

/** Why the share is a floor. */
export const floorText = (uncounted: number): string => `${counted(uncounted, UNCOUNTED)} بلا قسط في التقرير، فالنسبة حد أدنى والقسط المتاح حد أعلى.`;

/** The rule that holds the room for a new installment, said under its figure. */
export const roomRule = (room: Pick<Capacity, "rule" | "capUsed" | "retired" | "mortgage">): string => `يحكمه ${capRuleText(room.rule, room.capUsed, room)}`;

/** Over the lenders of a client nobody takes today: what follows is the reading after the record is cleared. */
export const AFTER_CLEARING = "لا جهة تقبله اليوم. هذه قراءة الجهات بعد رفع ما يمنع، ورفعه لا يضمن القبول.";

/** In place of the lenders of a kind of finance none of them gives the client, today or once the record is cleared. */
export const noTaker = (afterClearing: boolean): string =>
  afterClearing ? "لا جهة في القائمة تقبله لهذا التمويل بشروطها المسجلة، حتى بعد رفع ما يمنع." : "لا جهة في القائمة تقبله لهذا التمويل بشروطها المسجلة.";

/** What a kind of finance is called when its room and its lenders are shown. */
export const kindTitle = (k: Pick<KindFit, "kind">): string => `تمويل ${FINANCE_TYPE[k.kind]}`;

/** One thing a lender asks or holds against the client. The lender is the subject of the sentence. */
export function fitCheckText(check: FitCheck): string {
  if (check.key === "retire" || check.key === "ltv" || check.key === "dbr") return checkText(check);
  if (check.code === "RECORD_OPEN") return "في السجل تعثر أو قرار تنفيذ قائم، ولا تقبله قبل سداده.";
  return routeCheckText(check);
}

export const FIT_STATUS: Record<Fit["status"], string> = {
  pass: "تقبل",
  warn: "تقبل بشروط",
  fail: "لا تقبل",
};

export const MARK_SOURCE: Record<Mark["source"], string> = { file: "من الملف", record: "من سمة" };

/** Something that helps or hurts, in a sentence. */
export function markText(mark: Mark): string {
  if (mark.source === "file") return pointText(mark.point);
  return "blocker" in mark ? blockerText(mark.blocker) : findingText(mark.finding);
}

export const GAP_KIND: Record<Gap["kind"], string> = { missing: "ناقص", unconfirmed: "غير مؤكد" };

const READING_NOTES: CountForms = { one: "ملاحظة واحدة", two: "ملاحظتان", few: "ملاحظات", many: "ملاحظة" };

/** Something the analysis could not stand on. */
export function gapText(gap: Gap): string {
  switch (gap.code) {
    case "INCOME":
      return "الراتب غير مدخل في الملف.";
    case "TOTAL_SALARY":
      return "الراتب الإجمالي غير مدخل، فحسبنا على الأساسي. التقدير متحفظ.";
    case "INCOME_PROOF":
      return "الدخل كما كُتب في الملف. لم يوثَّق تعريف راتب ولا كشف تأمينات بعد.";
    case "AGE":
      return "سنة الميلاد غير مدخلة، فلم نقس حد العمر عند الجهات.";
    case "SERVICE":
      return "مدة الخدمة غير مدخلة، فلم نقس شرطها عند الجهات.";
    case "SALARY_BANK":
      return "بنك الراتب غير محدد، فكل جهة تشترط تحويله تبقى شرطاً.";
    case "INSTALLMENT":
      return `${gap.lender}، ${gap.product}: القسط غير مذكور في التقرير${gap.balance ? `، والرصيد ${money(gap.balance)}` : ""}. لم يدخل في النسبة.`;
    case "CARD_SHARE":
      return `بطاقة ${gap.lender}${gap.limit ? ` بحد ${money(gap.limit)}` : ""}: لا قسط لها في التقرير، فلم تدخل في النسبة. بعض الجهات تحتسب نسبة من حدّها.`;
    case "REPORT_AGE":
      return `مضى على التقرير ${months(gap.months)}، وقد تغيّر ما فيه.`;
    case "READING":
      if (gap.confidence === "low") return "قراءة التقرير ضعيفة الثقة. طابقها على التقرير الأصلي.";
      return gap.warnings ? `في قراءة التقرير ${counted(gap.warnings, READING_NOTES)} تحتاج مطابقة على الأصل.` : "قراءة التقرير متوسطة الثقة. طابقها على الأصل.";
    case "SUSPENSION":
      return "إيقاف الخدمات مفترض من قرار التنفيذ، ولم يؤكَّد من أبشر أو ناجز.";
    case "TERMS":
      return gap.unverified === gap.of ? "شروط الجهات استرشادية، ولم تؤكَّد مع أي جهة بعد." : `شروط ${ltr(gap.unverified)} من ${ltr(gap.of)} منتجاً استرشادية، ولم تؤكَّد مع جهاتها.`;
    case "CONSENT":
      return "موافقة العميل على معالجة بياناته وتقريره غير مسجلة.";
  }
}

const FILE_FACT: Record<Extract<Step, { code: "COMPLETE_FILE" }>["missing"][number], string> = {
  INCOME: "الراتب",
  AGE: "سنة الميلاد",
  SERVICE: "مدة الخدمة",
  SALARY_BANK: "بنك الراتب",
};

/** A step of the plan in a few words. */
export function stepTitle(step: Step): string {
  switch (step.code) {
    case "RECORD_CONSENT":
      return "سجّل موافقة العميل";
    case "COMPLETE_FILE":
      return "أكمل الملف";
    case "REVIEW_READING":
      return "طابق قراءة التقرير";
    case "CONFIRM_SUSPENSION":
      return "تحقق من إيقاف الخدمات";
    case "CREDIT":
      return actionTitle(step.action);
    case "REFRESH_REPORT":
      return "اطلب تقريراً أحدث";
    case "FREE_ROOM":
      return "افتح هامشاً للقسط";
    case "VERIFY_INCOME":
      return "وثّق الدخل";
    case "APPLY":
      return step.afterClearing ? `بعد السداد: ${step.lender}` : `قدّم إلى ${step.lender}`;
  }
}

/** Why the step, and what it takes. */
export function stepText(step: Step): string {
  switch (step.code) {
    case "RECORD_CONSENT":
      return "التحليل يعالج بيانات العميل وتقريره الائتماني. سجّل موافقته قبل الاعتماد عليه أو التقديم لأي جهة.";
    case "COMPLETE_FILE":
      return `ينقصه: ${step.missing.map((fact) => FILE_FACT[fact]).join("، ")}. ما ينقص يبقى شرطاً عند كل جهة ولا يُحسب قبولاً.`;
    case "REVIEW_READING":
      return "قارن ما قُرئ بالتقرير الأصلي قبل الاعتماد على الأرقام.";
    case "CONFIRM_SUSPENSION":
      return "افترضناه من قرار تنفيذ قائم. أكّده أو انفه من أبشر أو ناجز.";
    case "CREDIT":
      return actionText(step.action);
    case "REFRESH_REPORT":
      return `مضى على التقرير ${months(step.months)}، والجهة تقرأ السجل يوم التقديم.`;
    case "FREE_ROOM":
      return `لا قسط متاح اليوم. سداد ${step.lender} يحرر ${money(step.monthly)} في الشهر، وهو أصغر التزام رصيداً.`;
    case "VERIFY_INCOME":
      return "اطلب تعريف الراتب أو كشف التأمينات وراجعه قبل التقديم. المبالغ هنا محسوبة على الراتب المكتوب في الملف.";
    case "APPLY": {
      const offer = `${kindTitle(step)} حتى ${money(step.amount)} بقسط ${money(step.installment)} لمدة ${months(step.months)}.`;
      const notes = [
        step.conditional ? "تقبل بشروط مذكورة عندها." : null,
        step.afterClearing ? "سداد التعثر لا يضمن القبول." : null,
        step.verified ? null : "شروطها استرشادية، فأكّدها معها قبل وعد العميل.",
      ].filter(Boolean);
      return [offer, ...notes].join(" ");
    }
  }
}
