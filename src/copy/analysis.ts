/**
 * The wording of a client's credit and financial analysis: the result in a sentence, what is missing
 * or unconfirmed, and what to do next with its reason. The engine returns codes and numbers; this
 * file turns them into Arabic.
 */
import type { AnalysisVerdict, ClientAnalysis, Commitment, Fit, FitCheck, Gap, Income, IncomeBasis, KindFit, Mark, Reading, Step } from "@/domain/analysis";
import type { Capacity } from "@/domain/eligibility";
import { actionText, actionTitle, blockerText, findingText } from "./credit";
import { askedLabel, capRuleText, checkText, FINANCE_TYPE, pointText } from "./eligibility";
import { counted, ltr, money, months, type CountForms } from "./format";
import { ELIGIBILITY, routeCheckText, strictDoubtLines, strictLines, strictRefusalLines } from "./funding";
import { TERM_NAME } from "./lenders";

/**
 * The four results, in the words every page uses for them. An analysis that cannot be read yet is in
 * need of checking like any other: its sentence says what to check.
 */
export const ANALYSIS_VERDICT: Record<AnalysisVerdict, string> = {
  eligible: ELIGIBILITY.eligible,
  conditional: ELIGIBILITY.conditional,
  not_eligible: "غير مؤهل الآن",
  needs_verification: ELIGIBILITY.needs_verification,
  pending: ELIGIBILITY.needs_verification,
};

/** What every page and every printed copy of the analysis says about itself. */
export const DECISION_SUPPORT = "هذا التحليل يدعم قرار الموظف، وليس موافقة تمويلية. القرار النهائي للجهة الممولة.";

const TAKE: CountForms = { one: "جهة واحدة تقبله وشروطها مؤكدة", two: "جهتان تقبلانه وشروطهما مؤكدة", few: "جهات تقبله وشروطها مؤكدة", many: "جهة تقبله وشروطها مؤكدة" };
const TAKE_ON_TERMS: CountForms = {
  one: "جهة واحدة تقبله إذا أكمل ما تشترطه",
  two: "جهتان تقبلانه إذا أكمل ما تشترطانه",
  few: "جهات تقبله إذا أكمل ما تشترطه",
  many: "جهة تقبله إذا أكمل ما تشترطه",
};
const MAY_TAKE: CountForms = {
  one: "جهة واحدة قد تقبله بشروطها المسجلة",
  two: "جهتان قد تقبلانه بشروطهما المسجلة",
  few: "جهات قد تقبله بشروطها المسجلة",
  many: "جهة قد تقبله بشروطها المسجلة",
};

/** How many lenders, not products, answer one way in a reading of every kind studied. A lender that would lend nothing takes nobody. */
function lendersIn(readings: readonly Reading[], is: (fit: Fit) => boolean): number {
  return new Set(readings.flatMap((r) => r.fits.filter((fit) => fit.amount > 0 && is(fit)).map((fit) => fit.product.lenderId))).size;
}

/** Said after the lenders that take the client when none of them has anything in writing behind its answer. */
const BY_WORD = "، على إفادة موظف لا على مستند";

/** Who takes the client, by the best result any lender gives. `sure` is false when nobody confirmed the terms it rests on. */
function takers(readings: readonly Reading[]): { say: string; sure: boolean } | null {
  for (const [result, forms] of [
    ["eligible", TAKE],
    ["conditional", TAKE_ON_TERMS],
  ] as const) {
    const all = lendersIn(readings, (fit) => fit.eligibility === result);
    const written = lendersIn(readings, (fit) => fit.eligibility === result && fit.strength !== "verbal");
    if (all) return { say: `${counted(all, forms)}${written ? "" : BY_WORD}`, sure: true };
  }
  const maybe = lendersIn(readings, (fit) => fit.eligibility === "needs_verification" && !fit.blockedAsWritten);
  return maybe ? { say: counted(maybe, MAY_TAKE), sure: false } : null;
}

/** Why nobody takes the client: every lender is certain, or the record says so and nobody confirmed it. */
function noTakers(readings: readonly Reading[]): string {
  return readings.some((r) => r.unsure > 0) ? "لا جهة تقبله بشروطها المسجلة، وهذه الشروط لم تؤكَّد" : "لا جهة في القائمة تقبله، والمانع مؤكد";
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
  if (a.afterClearing == null) {
    const now = takers(today);
    if (!now) return `${noTakers(today)}.`;
    return now.sure ? `${now.say}.` : `${now.say}. لم يتأكد ذلك بعد.`;
  }
  const after = a.kinds.flatMap((k) => (k.cleared ? [k.cleared] : []));
  const cleared = takers(after);
  const first = toClear > 0 ? `لا جهة تقبله قبل سداد ${money(toClear)}.` : "لا جهة تقبله قبل رفع ما يمنع.";
  if (!cleared) return `${first} وبعده ${noTakers(after)}.`;
  return cleared.sure ? `${first} بعده ${cleared.say}، والسداد لا يضمن القبول.` : `${first} بعده ${cleared.say}. لم يتأكد ذلك بعد، والسداد لا يضمن القبول.`;
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

/** What stands between a lender and a reliable answer: the missing facts, then its open and expired terms by name. */
export const fitDoubtLines = (fit: Pick<Fit, "doubts">): string[] => strictDoubtLines(fit, fitCheckText);

/** What a lender's row says under its figures. */
export const fitLines = (fit: Pick<Fit, "doubts" | "leans" | "actions" | "remarks" | "eligibility" | "estimated" | "strength">): string[] => strictLines(fit, fitCheckText);

/** Why a lender does not take the client. With no condition against them, nothing is left of the income for it. */
export function fitRefusalLines(fit: Pick<Fit, "blockers" | "leans">): string[] {
  const lines = strictRefusalLines(fit, fitCheckText);
  return lines.length ? lines : ["لا يبقى في دخله قسط لها."];
}

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
    case "CONTRACT":
      return "نوع عقد العميل غير مدخل، وفي الجهات من تشترط نوعاً منه.";
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
      return gap.unverified === gap.of ? "شروط الجهات استرشادية، ولم تؤكَّد مع أي جهة بعد." : `شروط ${ltr(gap.unverified)} من ${ltr(gap.of)} منتجاً لم تؤكَّد كلها مع جهاتها.`;
    case "CONSENT":
      return "موافقة العميل على معالجة بياناته وتقريره غير مسجلة.";
  }
}

const FILE_FACT: Record<Extract<Step, { code: "COMPLETE_FILE" }>["missing"][number], string> = {
  INCOME: "الراتب",
  AGE: "سنة الميلاد",
  SERVICE: "مدة الخدمة",
  SALARY_BANK: "بنك الراتب",
  CONTRACT: "نوع العقد",
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
    case "CONFIRM_TERMS":
      return step.beforePaying ? `قبل أي سداد: أكّد شروط ${step.lender}` : `أكّد شروط ${step.lender}`;
    case "ASK_CLIENT":
      return step.beforePaying ? `قبل أي سداد: اسأل العميل عن شروط ${step.lender}` : `اسأل العميل عن شروط ${step.lender}`;
    case "APPLY":
      if (step.afterClearing) return `بعد السداد: ${step.lender}`;
      return step.eligibility === "needs_verification" ? `بعد التأكيد: ${step.lender}` : `قدّم إلى ${step.lender}`;
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
    case "CONFIRM_TERMS": {
      const what = `${step.kinds.map((kind) => kindTitle({ kind })).join(" و")}. لم يؤكَّد: ${step.terms.map((term) => TERM_NAME[term]).join("، ")}.`;
      return step.beforePaying ? `${what} اسأل الجهة واحفظ مصدر جوابها قبل أن يُسدَّد عن العميل شيء: السداد لا يضمن القبول.` : `${what} اسأل الجهة واحفظ مصدر جوابها قبل وعد العميل أو التقديم.`;
    }
    case "ASK_CLIENT":
      return `تشترط: ${step.questions.map(askedLabel).join("، ")}. سجّل جواب العميل عن كل شرط: ما لم يُجب عنه لا يُحسب مستوفى.`;
    case "APPLY": {
      const offer = `${kindTitle(step)} حتى ${money(step.amount)} بقسط ${money(step.installment)} لمدة ${months(step.months)}.`;
      const notes = [
        step.eligibility === "conditional" ? "تقبل بشروط مذكورة عندها." : null,
        step.eligibility === "needs_verification" ? "الأرقام على شروطها المسجلة، ولم تؤكَّد." : null,
        step.afterClearing ? "سداد التعثر لا يضمن القبول." : null,
        step.estimated ? "المبلغ والهامش استرشاديان حتى يؤكَّدا." : null,
      ].filter(Boolean);
      return [offer, ...notes].join(" ");
    }
  }
}
